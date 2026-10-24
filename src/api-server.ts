/**
 * RDOL 自建 HTTP 服务（接管原生产环境的 3004 端口 + 123 云盘）
 *
 * 客户端原本依赖线上已失效的 rdonlineapi.rhythmdoctor.top，并且谱面走
 * 123 云盘（open-api.123pan.com）四步上传。这里把两者都收回到本机：
 *
 *   GET  /checkupdate?platform=win|android|ios   版本检查 + mod 热更新清单
 *   GET  /mods/<release>/<layer>/<path>          mod 文件真实下载（流式）
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
 *   MOD_DIR       mod 发布根目录，默认 ./mod-releases
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { pino } from 'pino';
import { initSchema } from './db/schema';
import { publishLevel, searchLevels, countLevels, upstreamDownloadUrl, UPSTREAM } from './services/level.service';
// CHART_DIR 由 config/chart.ts 统一导出：上传落盘、下载读取、孤儿清理三处
// 必须看同一个目录，否则清理会去别的地方找文件。
import {
  CHART_DIR,
  CHART_BASE_URL,
  MAX_UPLOAD_BYTES,
  baseUrlFrom,
  safeChartName,
  uniqueChartName
} from './config/chart';
// mod 热更新：清单只取发布目录下的 CacheAssets，详见 config/mod-releases.ts 的说明。
import {
  MOD_ROOT,
  readCurrentRelease,
  writeCurrentRelease,
  readReleaseMeta,
  listReleases,
  buildHotManifest,
  describeRelease,
  releaseDir
} from './config/mod-releases';
import type { ModFileEntry } from './config/mod-releases';
// 整包分拣/元数据/失败清理三合一，与管理端共用同一套实现
import { publishModPackage } from './services/mod-publish.service';

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

const API_PORT = Number(process.env.API_PORT || 3004);
const API_VERSION = process.env.API_VERSION || '2.0.0';
const API_TOKEN = process.env.API_TOKEN || '';
// 整包 mod 比单个谱面大得多（含 AssetBundle），上限单独给
const MAX_MOD_BYTES = Number(process.env.MAX_MOD_MB || 256) * 1024 * 1024;

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

/**
 * 下载地址前缀：优先用 CHART_BASE_URL，否则按请求 Host 推断。
 * 实际逻辑在 config/chart.ts，管理端也要拼同样的地址，共用一份实现。
 */
function baseUrlFor(req: http.IncomingMessage): string {
  return baseUrlFrom(req.headers.host, API_PORT);
}

/**
 * 计算文件哈希，格式必须与客户端 ComputeFileHash 一致：`sha256:<64位小写hex>`。
 * 客户端是逐字节比对字符串，前缀或大小写错了会导致每次启动都重下全部文件。
 */
function sha256Tag(absPath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return 'sha256:' + hash.digest('hex');
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

  // ---------- 版本检查 + mod 热更新清单 ----------
  // 客户端 ScnCheckUpdate 的行为（见 Assets/CheckUpdate/ScnCheckUpdate.cs）：
  //   version 与自身 BuiltInVersion 比，server 更大就拒绝进游戏（要求整包更新）；
  //   相等则按 files[] 的 sha256 比对 CacheAssets，缺失/不一致的下载，清单外的删除。
  // 因此这里 version 报「客户端该有的版本」，不是我们自己的 API_VERSION，
  // 否则客户端每次都被判定为旧版而进不去。
  if (pathname === '/checkupdate' || pathname === '/checkupdate/') {
    const platform = url.searchParams.get('platform') || '';
    const releaseId = readCurrentRelease();
    const meta = releaseId ? readReleaseMeta(releaseId) : null;

    // 没有任何发布时退回旧行为：只报版本、空清单（客户端不会删任何文件）
    if (!releaseId || !meta) {
      logger.info(`[checkupdate] platform=${platform} -> ${API_VERSION}（无 mod 发布）`);
      return sendJson(res, 200, {
        version: API_VERSION,
        announcement: '',
        platform,
        url: '',
        force: false,
        files: []
      });
    }

    let files: ModFileEntry[] = [];
    try {
      files = buildHotManifest(releaseId, baseUrlFor(req), (abs) => sha256Tag(abs));
    } catch (err) {
      // 清单本身有问题时宁可空清单（客户端不会删文件），也不要下发半截清单
      logger.error(`[checkupdate] 生成 mod 清单失败: ${(err as Error).message}`);
      files = [];
    }

    logger.info(
      `[checkupdate] platform=${platform} release=${releaseId} ` +
        `clientVersion=${meta.clientVersion} files=${files.length}`
    );
    return sendJson(res, 200, {
      version: meta.clientVersion,
      announcement: meta.announcement,
      platform,
      url: '',
      force: meta.force,
      files
    });
  }

  // ---------- mod 文件下载 ----------
  // 路径形如 /mods/<release>/CacheAssets/<file>，只读发布目录，且限定两层：
  // 第一段是发布目录名，第二段是层（CacheAssets / boot）。
  // 用 basename 白名单之外的所有段都必须逐段编码校验，挡住目录穿越。
  const modMatch = pathname.match(/^\/mods\/([^/]+)\/(CacheAssets|boot)(\/.*)$/);
  if (modMatch) {
    if (method !== 'GET' && method !== 'HEAD') {
      return sendJson(res, 405, { success: false, message: '请用 GET' });
    }
    const releaseId = decodeURIComponent(modMatch[1]);
    const layer = modMatch[2];
    const relPath = modMatch[3];

    let target: string;
    try {
      const base = path.join(releaseDir(releaseId), layer);
      target = path.resolve(base, '.' + relPath);
      // resolve 之后必须仍在 base 目录内，防止 ../ 穿越
      if (!target.startsWith(path.resolve(base) + path.sep)) {
        return sendJson(res, 400, { success: false, message: '路径非法' });
      }
    } catch {
      return sendJson(res, 400, { success: false, message: '发布目录名非法' });
    }

    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return sendJson(res, 404, { success: false, message: '文件不存在' });
    }

    const stat = fs.statSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*'
    });
    if (method === 'HEAD') return res.end();
    return fs.createReadStream(target).pipe(res);
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
    const name = safeChartName(rawName);
    if (!name) {
      return sendJson(res, 400, { success: false, message: '文件名非法，只允许 .rdzip / .zip / .rdlevel' });
    }

    // 同名覆盖会让旧 URL 指向新内容，加时间戳前缀保证 URL 唯一
    const finalName = uniqueChartName(name);
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
    // 下载侧同样走共享校验：只认裸文件名，挡住 /charts/../ 之类的穿越
    const name = safeChartName(decodeURIComponent(pathname.slice('/charts/'.length)));
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

  // ---------- mod 发布管理 ----------
  // 管理员把本机编译出的整包 zip 直接 PUT 上来，服务端按客户端真实的加载路径
  // 分拣成两层：能热更新的进 CacheAssets，必须重启的进 boot。
  // 客户端不会也不该看到这个端点，靠 X-Api-Token 挡住。
  if (pathname === '/mods/admin/publish') {
    if (method !== 'POST') {
      return sendJson(res, 405, { success: false, message: '请用 POST' });
    }
    if (!API_TOKEN) {
      return sendJson(res, 403, { success: false, message: '服务端未配置 API_TOKEN，拒绝发布' });
    }
    if (req.headers['x-api-token'] !== API_TOKEN) {
      return sendJson(res, 401, { success: false, message: '凭证无效' });
    }

    const releaseId = (url.searchParams.get('release') || '').trim();
    const clientVersion = (url.searchParams.get('clientVersion') || '').trim();
    const announcement = url.searchParams.get('announcement') || '';
    const force = url.searchParams.get('force') === '1';
    const activate = url.searchParams.get('activate') !== '0';

    if (!/^[0-9A-Za-z._-]+$/.test(releaseId)) {
      return sendJson(res, 400, { success: false, message: 'release 参数非法' });
    }
    if (!/^[0-9A-Za-z._-]+$/.test(clientVersion)) {
      return sendJson(res, 400, { success: false, message: 'clientVersion 参数非法' });
    }

    readBody(req, MAX_MOD_BYTES)
      .then((buf) => {
        // 分拣失败时服务内部已把整个版本目录和 current 清掉，不留半截版本
        const result = publishModPackage(buf, {
          releaseId,
          clientVersion,
          announcement,
          force,
          activate
        });
        logger.info(
          `[mods] 发布 ${releaseId}（clientVersion=${clientVersion}）` +
            ` 热更新 ${result.hot.length} 个、重启层 ${result.boot.length} 个` +
            `${result.activated ? '，已设为 current' : ''}`
        );
        sendJson(res, 200, {
          success: true,
          release: releaseId,
          clientVersion,
          activated: result.activated,
          hot: result.hot,
          boot: result.boot,
          warnings: result.warnings
        });
      })
      .catch((err: Error) => {
        logger.error(`[mods] 发布失败（已清理 ${releaseId}）: ${err.message}`);
        sendJson(res, 400, { success: false, message: err.message });
      });
    return;
  }

  // 查看发布列表与当前生效版本
  if (pathname === '/mods/admin/releases') {
    if (req.headers['x-api-token'] !== API_TOKEN || !API_TOKEN) {
      return sendJson(res, 401, { success: false, message: '凭证无效' });
    }
    const current = readCurrentRelease();
    return sendJson(res, 200, {
      success: true,
      current: current || null,
      releases: listReleases().map((id) => {
        const meta = readReleaseMeta(id);
        const desc = describeRelease(id);
        return {
          id,
          clientVersion: meta?.clientVersion ?? null,
          force: meta?.force ?? false,
          hot: desc.hot.length,
          boot: desc.boot.length
        };
      })
    });
  }

  // 切换生效版本（回滚也走这里）
  if (pathname === '/mods/admin/activate') {
    if (method !== 'POST') {
      return sendJson(res, 405, { success: false, message: '请用 POST' });
    }
    if (!API_TOKEN || req.headers['x-api-token'] !== API_TOKEN) {
      return sendJson(res, 401, { success: false, message: '凭证无效' });
    }
    const releaseId = (url.searchParams.get('release') || '').trim();
    if (!/^[0-9A-Za-z._-]+$/.test(releaseId) || !readReleaseMeta(releaseId)) {
      return sendJson(res, 404, { success: false, message: '发布不存在' });
    }
    writeCurrentRelease(releaseId);
    logger.info(`[mods] 切换生效版本 -> ${releaseId}`);
    return sendJson(res, 200, { success: true, current: releaseId });
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
      modRoot: MOD_ROOT,
      modRelease: readCurrentRelease() || null,
      modReleases: listReleases(),
      endpoints: [
        'GET /checkupdate?platform=',
        'GET /mods/<release>/CacheAssets/<file>',
        'POST /mods/admin/publish?release=&clientVersion=',
        'GET /mods/admin/releases',
        'POST /mods/admin/activate?release=',
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
