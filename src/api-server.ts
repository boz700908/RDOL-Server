/**
 * RDOL 自建 HTTP 服务（接管原生产环境的 3004 端口 + 123 云盘）
 *
 * 客户端原本依赖线上已失效的 rdonlineapi.rhythmdoctor.top，并且谱面走
 * 123 云盘（open-api.123pan.com）四步上传。这里把两者都收回到本机：
 *
 *   GET  /checkupdate?platform=win|android|ios   版本检查（LoginUI 读 version 字段）
 *   GET  /pan123/token                          兼容保留，返回本服务的上传凭证
 *   POST /charts/upload?name=xxx.zip            真实上传谱面 zip（请求体即字节流）
 *   GET  /charts/<file>                         真实下载谱面（流式，任意客户端可取）
 *   GET  /charts                                已上传谱面清单
 *   GET  /api/get_chartlist.php                 社区谱面检索（Typesense 兼容，替代已失效的 Cafe 源）
 *   POST /charts/publish                        发布谱面元数据到社区库（body 为 JSON）
 *   GET  /health                                自检
 *
 * 为什么不用 multipart：客户端本来就是内存里的 zip 字节数组，直接把 body
 * 整段写盘最简单，Node 也不需要额外依赖解析 multipart。
 *
 * 环境变量：
 *   API_PORT      监听端口，默认 3004
 *   API_VERSION   上报版本号，默认 2.0.0
 *   CHART_DIR     谱面存放目录，默认 ./charts
 *   CHART_BASE_URL 生成下载地址的前缀；不设则按请求的 Host 自动拼
 *   API_TOKEN     若设置，上传必须带 X-Api-Token 头
 *   MAX_UPLOAD_MB 单次上传上限，默认 64
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pino } from 'pino';
import { initSchema } from './db/schema';
import { publishLevel, searchLevels, countLevels, upstreamDownloadUrl, UPSTREAM } from './services/level.service';
// CHART_DIR 由 config/chart.ts 统一导出：上传落盘、下载读取、孤儿清理三处
// 必须看同一个目录，否则清理会去别的地方找文件。
import { CHART_DIR } from './config/chart';

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

const API_PORT = Number(process.env.API_PORT || 3004);
const API_VERSION = process.env.API_VERSION || '2.0.0';
const CHART_BASE_URL = (process.env.CHART_BASE_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.API_TOKEN || '';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 64) * 1024 * 1024;

// 上传凭证：客户端 Map123TokenUrlU 拿到的就是它
const UPLOAD_TOKEN = crypto.randomBytes(16).toString('hex');

// 建表（幂等）。放在服务启动阶段，避免请求进来时表还没建好
initSchema();

fs.mkdirSync(CHART_DIR, { recursive: true });

const MIME: Record<string, string> = {
  '.rdzip': 'application/zip',
  '.zip': 'application/zip',
  '.rdlevel': 'application/octet-stream',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
};

/** 读取请求体（带大小上限，超限直接断开） */
function readBody(req: http.IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error(`请求体超过 ${limitBytes} 字节`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(text);
}

/** 下载地址前缀：优先用配置，否则按请求 Host 自动推断 */
function baseUrlFor(req: http.IncomingMessage): string {
  if (CHART_BASE_URL) return CHART_BASE_URL;
  const host = req.headers.host || `127.0.0.1:${API_PORT}`;
  return `http://${host}`;
}

/** 只允许安全文件名，挡住目录穿越 */
function safeName(raw: string): string | null {
  const name = path.basename(raw).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  if (!name || name === '.' || name === '..') return null;
  if (!/\.(rdzip|zip|rdlevel)$/i.test(name)) return null;
  return name;
}

function listCharts(req: http.IncomingMessage) {
  const base = baseUrlFor(req);
  return fs
    .readdirSync(CHART_DIR)
    .filter((f) => /\.(rdzip|zip|rdlevel)$/i.test(f))
    .map((f) => {
      const stat = fs.statSync(path.join(CHART_DIR, f));
      return {
        name: f,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
        url: `${base}/charts/${encodeURIComponent(f)}`
      };
    })
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = (req.method || 'GET').toUpperCase();

  // ---------- 版本检查 ----------
  if (pathname === '/checkupdate' || pathname === '/checkupdate/') {
    const platform = url.searchParams.get('platform') || '';
    logger.info(`[checkupdate] platform=${platform} -> ${API_VERSION}`);
    return sendJson(res, 200, {
      version: API_VERSION,
      platform,
      url: '',
      force: false
    });
  }

  // ---------- 上传凭证 ----------
  if (pathname === '/pan123/token') {
    logger.info('[token] 下发上传凭证');
    return sendJson(res, 200, { token: UPLOAD_TOKEN, expiresIn: 86400 });
  }

  // ---------- 真实上传 ----------
  if (pathname === '/charts/upload') {
    if (method !== 'POST') {
      return sendJson(res, 405, { success: false, message: '请用 POST' });
    }
    if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) {
      return sendJson(res, 401, { success: false, message: '凭证无效' });
    }

    const rawName = url.searchParams.get('name') || '';
    const name = safeName(rawName);
    if (!name) {
      return sendJson(res, 400, { success: false, message: '文件名非法，只允许 .rdzip / .zip / .rdlevel' });
    }

    // 同名覆盖会让旧 URL 指向新内容，加时间戳前缀保证 URL 唯一
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const finalName = `${stamp}_${crypto.randomBytes(3).toString('hex')}_${name}`;
    const target = path.join(CHART_DIR, finalName);

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        aborted = true;
        logger.warn(`[upload] 超过上限 ${MAX_UPLOAD_BYTES} 字节，拒绝 ${name}`);
        sendJson(res, 413, { success: false, message: '文件过大' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      if (size === 0) {
        return sendJson(res, 400, { success: false, message: '文件为空' });
      }
      const body = Buffer.concat(chunks);
      // zip 必须能通过魔数校验，挡掉误传
      // .rdzip 是官方关卡包格式，本质仍是 zip 容器
      if (/\.(rdzip|zip)$/i.test(name) && !(body[0] === 0x50 && body[1] === 0x4b)) {
        return sendJson(res, 400, { success: false, message: '不是有效的 rdzip 包（zip 魔数校验失败）' });
      }
      fs.writeFileSync(target, body);
      const downloadUrl = `${baseUrlFor(req)}/charts/${encodeURIComponent(finalName)}`;
      logger.info(`[upload] ${finalName} (${size} 字节) -> ${downloadUrl}`);
      return sendJson(res, 200, {
        success: true,
        name: finalName,
        size,
        url: downloadUrl
      });
    });

    req.on('error', (err) => {
      logger.error(`[upload] 接收失败: ${err.message}`);
      if (!res.headersSent) sendJson(res, 500, { success: false, message: '接收失败' });
    });
    return;
  }

  // ---------- 清单 ----------
  if (pathname === '/charts' || pathname === '/charts/') {
    return sendJson(res, 200, { charts: listCharts(req) });
  }

  // ---------- 社区谱面库：发布 ----------
  // 文件本体仍走 /charts/upload，这里只登记元数据；两者用同一个 url 关联，
  // 保证社区列表里点开的就是真实上传的那个包。
  if (pathname === '/charts/publish' || pathname === '/levels/publish') {
    if (method !== 'POST') {
      return sendJson(res, 405, { success: false, message: '请用 POST' });
    }
    if (API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) {
      return sendJson(res, 401, { success: false, message: '凭证无效' });
    }
    readBody(req, 64 * 1024)
      .then(async (buf) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(buf.toString('utf8') || '{}');
        } catch {
          return sendJson(res, 400, { success: false, message: '请求体不是合法 JSON' });
        }

        // data.url 由服务端按 name 拼（见 publishLevel），避免客户端伪造任意地址
        try {
          const doc = await publishLevel(data as any, baseUrlFor(req));
          logger.info(`[levels] 已发布 ${doc.id} <- ${doc.url}`);
          return sendJson(res, 200, { success: true, document: doc });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`[levels] 发布失败: ${message}`);
          return sendJson(res, 500, { success: false, message });
        }
      })
      .catch((err: Error) => {
        logger.error(`[levels] 读取发布请求失败: ${err.message}`);
        if (!res.headersSent) sendJson(res, 413, { success: false, message: err.message });
      });
    return;
  }

  // ---------- 真实下载 ----------
  if (pathname.startsWith('/charts/')) {
    const name = safeName(pathname.slice('/charts/'.length));
    if (!name) {
      return sendJson(res, 400, { success: false, message: '文件名非法' });
    }
    const file = path.join(CHART_DIR, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return sendJson(res, 404, { success: false, message: '谱面不存在' });
    }
    const stat = fs.statSync(file);
    logger.info(`[download] ${name} (${stat.size} 字节)`);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*'
    });
    return fs.createReadStream(file).pipe(res);
  }

  // ---------- 社区谱面库：检索 ----------
  // 客户端 ScrLevelList 把这里当成 Typesense 端点，会带上 query_by / facet_by /
  // filter_by 等参数；多出来的参数一律忽略，只认 q / page / per_page。
  if (pathname === '/api/get_chartlist.php' || pathname === '/api/get_chartlist') {
    const params = {
      q: url.searchParams.get('q') || '',
      page: Number(url.searchParams.get('page') || 1),
      perPage: Number(url.searchParams.get('per_page') || 15),
      selfBase: baseUrlFor(req)
    };
    searchLevels(params)
      .then((result) => {
        logger.info(
          `[levels] q="${params.q}" page=${params.page} -> ${result.found} 条` +
            `（本地 ${result.hits.length > 0 ? '含' : '无'}，上游${result.upstreamOk ? '正常' : '不可用'}）`
        );
        sendJson(res, 200, result);
      })
      .catch((err: Error) => {
        logger.error(`[levels] 检索失败: ${err.message}`);
        sendJson(res, 500, { found: 0, page: params.page, out_of: 0, hits: [], message: '检索失败' });
      });
    return;
  }

  // ---------- 关卡下载反代 ----------
  // 客户端拿到的 url2 是上游 CDN 直链，正常不走这里；
  // 当 c2.rhythm.cafe 在客户端网络里不通时，用这条本机地址兜底。
  const dlMatch = pathname.match(/^\/api\/levels\/([^/]+)\/download$/);
  if (dlMatch) {
    const levelId = decodeURIComponent(dlMatch[1]);
    const upstreamUrl = upstreamDownloadUrl(levelId);
    if (!upstreamUrl) {
      return sendJson(res, 400, { error: 'INVALID_LEVEL_ID', message: '无效的关卡 ID' });
    }
    forwardDownload(upstreamUrl, req, res, levelId);
    return;
  }

  // ---------- 自检 ----------
  if (pathname === '/' || pathname === '/health') {
    countLevels()
      .then((levelCount) => sendJson(res, 200, healthBody(req, levelCount)))
      .catch(() => sendJson(res, 200, healthBody(req, -1)));
    return;
  }

  sendJson(res, 404, { success: false, message: '未找到该接口' });
});

/**
 * 把上游 .rdzip 流式转给客户端，透传 Range/206，不落盘、不整包进内存。
 * 25MB 级的包也不会把 1Mbps 出口打满内存。
 */
function forwardDownload(
  upstreamUrl: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  levelId: string
): void {
  const headers: Record<string, string> = { 'User-Agent': 'RDOL-Server/2.0 (+self-hosted)' };
  if (req.headers.range) headers.Range = String(req.headers.range);

  fetch(upstreamUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(120000) })
    .then(async (upstream) => {
      const out: Record<string, string> = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
      for (const h of [
        'content-type',
        'content-length',
        'content-disposition',
        'accept-ranges',
        'content-range',
        'etag',
        'last-modified'
      ]) {
        const v = upstream.headers.get(h);
        if (v) out[h] = v;
      }
      if (!upstream.body) {
        res.writeHead(upstream.status, out);
        return res.end();
      }
      res.writeHead(upstream.status, out);
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      logger.info(`[levels] 反代下载 ${levelId} -> ${upstream.status}`);
    })
    .catch((err: Error) => {
      logger.error(`[levels] 反代下载 ${levelId} 失败: ${err.message}`);
      if (!res.headersSent) sendJson(res, 502, { error: 'UPSTREAM_UNAVAILABLE', message: '下载服务暂时不可用' });
      else res.end();
    });
}

/** 自检响应体：谱面文件数与社区库条目数 */
function healthBody(req: http.IncomingMessage, levelCount: number) {
  return {
      ok: true,
      service: 'rdol-api',
      version: API_VERSION,
      chartDir: CHART_DIR,
      chartCount: listCharts(req).length,
      levelCount,
      communityUpstream: UPSTREAM,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      endpoints: [
        'GET /checkupdate?platform=',
        'GET /pan123/token',
        'POST /charts/upload?name=x.zip',
        'GET /charts',
        'GET /charts/<file>',
        'GET /api/get_chartlist.php?q=&page=&per_page=',
        'GET /api/levels/:id/download','POST /charts/publish'
      ]
  };
}

server.listen(API_PORT, () => {
  logger.info(`[rdol-api] 已启动，端口 ${API_PORT}（谱面真实上传/下载）`);
  logger.info(`[rdol-api] 谱面目录 ${CHART_DIR}，现有 ${listCharts({ headers: {} } as any).length} 个文件`);
  logger.info(`[rdol-api] 上传上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB${API_TOKEN ? '，需 X-Api-Token' : ''}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
