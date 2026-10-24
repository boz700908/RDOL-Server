/**
 * 谱面文件清理。
 *
 * 语义边界：上传 ≠ 发布（见 level.service.ts 与 Pan123ChartUploader 的改造）。
 * 房主在房间里选的谱面会被真实上传到本机 charts/ 目录，只为「同一房间的人能下载」，
 * 一旦所有人都退出房间，这个包就没有任何引用了，必须删掉，否则磁盘会被一堆
 * 一次性 .rdzip 塞满（这台机器磁盘本来就紧）。
 *
 * 两条清理路径：
 *  1. 房间销毁时：roomManager.destroy() 前记下 chartUrl，延迟一会儿后删除。
 *     延迟是给最后一位退房的玩家留下载收尾的窗口。
 *  2. 周期清扫：兜住「没进过房间就上传」「房主中途换了谱面」这类没人认领的包。
 *     只删超过最小存活时长的文件，避免误删正在上传/下载的包。
 *
 * 三条不许删的判据，任何一条命中都保留：
 *  - 任何现存房间的 chartUrl 指向它
 *  - levels 表里有条目把它当 url / url2（已发布到社区库）
 *  - 文件名不像谱面包，或不在 CHART_DIR 里
 *
 * 官方谱面的 chartUrl 是 `internal://<关卡名>`，本机没有任何文件，直接跳过。
 */
import fs from 'fs';
import path from 'path';
import { CHART_DIR, CHART_EXT, chartFileNameFromUrl } from '../config/chart';
import { query } from '../db/sqlite';

/** 房间销毁后延迟删除：留出最后一位玩家退房、下载收尾的窗口 */
const ROOM_CLEANUP_DELAY_MS = Number(process.env.CHART_ROOM_CLEANUP_DELAY_MS || 60_000);

/** 周期清扫时，文件至少要比这么久更旧才算孤儿（默认 6 小时） */
const ORPHAN_MIN_AGE_MS = Number(process.env.CHART_ORPHAN_MIN_AGE_MIN || 360) * 60_000;

/** 周期清扫间隔（默认 10 分钟） */
const SWEEP_INTERVAL_MS = Number(process.env.CHART_SWEEP_INTERVAL_MIN || 10) * 60_000;

/**
 * 现存房间正在使用的谱面文件名。
 *
 * 用动态 import 取 roomManager：room.manager.ts 要在 destroy() 里调本服务，
 * 顶层互相 import 会形成循环依赖，运行时拿到的可能还是未初始化的模块对象。
 */
async function roomFileNames(): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const { roomManager } = await import('../managers/room.manager');
    for (const room of roomManager.getList()) {
      const name = chartFileNameFromUrl(room.chartUrl);
      if (name) names.add(name);
    }
  } catch {
    // 模块尚未就绪时按「没有房间引用」处理会让清理变激进，
    // 所以这里反过来：拿不到就不认领任何文件，交给下一轮清扫
  }
  return names;
}

/** 已发布到社区库（levels 表）的谱面文件名 */
async function publishedFileNames(): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const rows = await query<Array<{ url: string | null; url2: string | null }>>(
      'SELECT url, url2 FROM levels'
    );
    for (const row of rows) {
      for (const raw of [row.url, row.url2]) {
        const name = chartFileNameFromUrl(raw);
        if (name) names.add(name);
      }
    }
  } catch (err) {
    console.error('[chart-cleanup] 读取已发布谱面失败:', err);
  }
  return names;
}

/** 本机是否还有人在用这个谱面 */
async function isReferenced(name: string): Promise<boolean> {
  if ((await roomFileNames()).has(name)) return true;
  if ((await publishedFileNames()).has(name)) return true;
  return false;
}

/**
 * 删除一个无人引用的谱面文件。
 *
 * @param minAgeMs 文件必须至少这么旧才删；0 表示不设年龄门槛（房间刚销毁的场景）
 * @returns 真的删掉了就返回 true
 */
async function removeIfOrphan(name: string, minAgeMs: number): Promise<boolean> {
  const full = path.join(CHART_DIR, name);

  // 兜底：只碰 CHART_DIR 直接下级的文件，防止文件名里混进路径片段
  if (path.dirname(full) !== CHART_DIR) return false;

  try {
    const stat = await fs.promises.stat(full);
    if (!stat.isFile()) return false;
    if (minAgeMs > 0 && Date.now() - stat.mtimeMs < minAgeMs) return false;

    // 双检：等延迟、排队的时间里，文件可能已经被某个房间用上或被发布了
    if (await isReferenced(name)) return false;

    await fs.promises.unlink(full);
    console.log(`[chart-cleanup] 已清理未使用的谱面: ${name}`);
    return true;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.error(`[chart-cleanup] 清理 ${name} 失败:`, err?.message || err);
    }
    return false;
  }
}

/**
 * 房间销毁后调用：延迟删除该房间用过的谱面。
 *
 * fire-and-forget，绝不抛错——房间销毁流程不能因为磁盘问题半路中断。
 * 官方谱面（internal://）与外部地址在这里会直接返回。
 */
export function cleanupChartForRoom(chartUrl: string | null | undefined): void {
  const name = chartFileNameFromUrl(chartUrl);
  if (!name) return;

  const timer = setTimeout(() => {
    void removeIfOrphan(name, 0);
  }, ROOM_CLEANUP_DELAY_MS);

  // 不要让一个待清理的定时器把进程吊住
  timer.unref?.();
}

/**
 * 扫一遍 charts/ 目录，删掉所有没人认领且足够旧的谱面。
 * @returns 删除的数量
 */
export async function sweepOrphans(): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(CHART_DIR);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return 0; // 还没人上传过，目录不存在
    console.error('[chart-cleanup] 读取谱面目录失败:', err);
    return 0;
  }

  const referenced = new Set<string>([...(await roomFileNames()), ...(await publishedFileNames())]);

  let removed = 0;
  for (const entry of entries) {
    if (!CHART_EXT.test(entry)) continue;
    if (referenced.has(entry)) continue;
    if (await removeIfOrphan(entry, ORPHAN_MIN_AGE_MS)) removed++;
  }

  return removed;
}

let sweepTimer: NodeJS.Timeout | null = null;

/** 启动周期清扫。重复调用只有第一次生效。 */
export function startChartCleanup(): void {
  if (sweepTimer) return;

  sweepTimer = setInterval(() => {
    void sweepOrphans().then((removed) => {
      if (removed > 0) console.log(`[chart-cleanup] 本轮清理 ${removed} 个谱面文件`);
    });
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

  console.log(
    `[chart-cleanup] 已启动：目录 ${CHART_DIR}，清扫间隔 ${SWEEP_INTERVAL_MS / 60_000} 分钟，` +
      `孤儿年龄门槛 ${ORPHAN_MIN_AGE_MS / 60_000} 分钟`
  );
}

/** 停止周期清扫（测试与优雅退出用） */
export function stopChartCleanup(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
