/**
 * 谱面文件目录的唯一来源。
 *
 * api-server.ts（HTTP 落盘/下载）与 chart-cleanup.service.ts（孤儿清理）必须
 * 看同一个目录，否则清理逻辑会去错误的路径里找文件。此前 CHART_DIR 只在
 * api-server.ts 里定义过一次，这里抽出来共享。
 */
import path from 'path';

/** 谱面存放目录，默认 ./charts（相对服务进程工作目录） */
export const CHART_DIR = path.resolve(process.env.CHART_DIR || './charts');

/** 被视为谱面包的扩展名 */
export const CHART_EXT = /\.(rdzip|zip|rdlevel)$/i;

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
