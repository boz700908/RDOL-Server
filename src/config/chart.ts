/**
 * 谱面相关的共享配置与文件名工具。
 *
 * 为什么集中在这里：谱面会从三个入口写进 CHART_DIR——游戏内上传（3004）、
 * 管理端上传（3005）、上游收录抓取（3005）。三处必须用同一套目录、同一套
 * 文件名规则和同一个对外地址前缀，否则会出现「某个入口写出的名字在下载侧
 * 被拒绝」「数据库里存着内网地址」这类只在生产才暴露的问题。
 *
 * 另外 chart-cleanup.service.ts（孤儿清理）也必须看同一个 CHART_DIR，
 * 否则它会去错误的路径里找文件、把别人的文件当成孤儿。
 */
import path from 'path';

/** 谱面存放目录，默认 ./charts（相对服务进程工作目录） */
export const CHART_DIR = path.resolve(process.env.CHART_DIR || './charts');

/** 被视为谱面包的扩展名 */
export const CHART_EXT = /\.(rdzip|zip|rdlevel)$/i;

/**
 * 对外下载地址前缀。
 *
 * 谱面 url 会写进数据库并长期被客户端使用，必须是公网地址。不配则按请求
 * Host 推断——那只在本机自测时够用，生产务必在 .env 里配 CHART_BASE_URL。
 */
export const CHART_BASE_URL = (process.env.CHART_BASE_URL || '').replace(/\/$/, '');

/** 单个谱面包大小上限；上传与上游抓取共用同一个上限 */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 64) * 1024 * 1024;

/** 按请求 Host 推断对外前缀，CHART_BASE_URL 优先 */
export function baseUrlFrom(host: string | undefined, fallbackPort: number, proto = 'http'): string {
  if (CHART_BASE_URL) return CHART_BASE_URL;
  return `${proto}://${host || `127.0.0.1:${fallbackPort}`}`;
}

/**
 * 管理端专用：指向游戏 HTTP 端口的对外前缀。
 *
 * 管理页跑在 3005，而 Host 头带的就是 3005；直接沿用 Host 会生成客户端打不开
 * 的地址（实测 3005 的 /charts/* 返回 404，只有 3004 提供）。所以这里只取主机名，
 * 端口固定为 API_PORT。谱面与 mod 下载都由 3004 提供，两者共用这一处。
 */
export function gameBaseUrl(host: string | undefined, proto = 'http'): string {
  if (CHART_BASE_URL) return CHART_BASE_URL;
  const raw = String(host || '').split(',')[0].trim();
  const hostname = raw.split(':')[0] || '127.0.0.1';
  const port = process.env.API_PORT || '3004';
  return `${proto}://${hostname}:${port}`;
}

/**
 * 从下载地址里取出谱面文件名。
 *
 * 只认扩展名合法的裸文件名，不信任 URL 里可能带上的路径穿越片段；
 * 官方谱面的 `internal://<关卡名>` 与外部地址在这里会得到 null，
 * 调用方据此跳过清理——不是本机的文件绝不删。
 */
export function chartFileNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw || raw.startsWith('internal://')) return null;

  // 取 ? 和 # 之前的部分，再取最后一段
  let tail = raw.split('#')[0].split('?')[0];
  const slash = tail.lastIndexOf('/');
  if (slash >= 0) tail = tail.slice(slash + 1);

  try {
    tail = decodeURIComponent(tail);
  } catch {
    // 非法百分号编码就按原样处理
  }

  const name = path.basename(tail);
  if (!name || name === '.' || name === '..') return null;
  if (!CHART_EXT.test(name)) return null;
  return name;
}

/**
 * 校验并规范化上传文件名；非法返回 null 由调用方回 400。
 *
 * 只取最后一段再过滤字符，`../../etc/passwd` 这类会被压成一个普通文件名。
 */
export function safeChartName(raw: string): string | null {
  const name = path.basename(String(raw || '')).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  if (!name || name === '.' || name === '..') return null;
  if (!CHART_EXT.test(name)) return null;
  return name;
}

/** 带时间戳与随机段的新文件名：同名上传不会覆盖旧 URL */
export function uniqueChartName(name: string): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, '0');
  return `${stamp}_${rand}_${name}`;
}
