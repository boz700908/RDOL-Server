/**
 * mod 发布目录配置。
 *
 * 关键约束（来自客户端 Assets/CheckUpdate/ScnCheckUpdate.cs，不能违背）：
 *   1. 清单里每个文件都只会被下载到 <modPath>/CacheAssets/<basename>，
 *      所以「热更新层」只能是 CacheAssets 里的东西。
 *   2. <modPath> 根目录下的 RDOL.Entry.dll / CheckUpdate.dll / checkupdate.*.assets
 *      由 BepInModEntry 在检查更新「之前」加载，本进程内换不掉，
 *      只能靠整包替换，对应「重启层」。
 *   3. 客户端拿服务器 version 与自身 BuiltInVersion 比，server > builtIn 就拒绝进入游戏。
 *      所以热更新时 version 必须与客户端一致；要换重启层才抬 clientVersion。
 *
 * 目录布局（一个发布 = 一个目录）：
 *   mod-releases/
 *     current                     <- 当前生效的发布目录名
 *     2.0.0-1/
 *       release.json              <- {version, clientVersion, announcement, force}
 *       CacheAssets/...           <- 热更新层，进 /checkupdate 的 files[]
 *       boot/...                  <- 重启层，供手动整包替换
 */
import fs from 'fs';
import path from 'path';

/** mod 发布根目录，默认 ./mod-releases */
export const MOD_ROOT = path.resolve(process.env.MOD_DIR || './mod-releases');

export const CURRENT_FILE = path.join(MOD_ROOT, 'current');

export interface ReleaseMeta {
  /** 本发布自己的版本号，仅用于排序与展示 */
  version: string;
  /** 客户端必须匹配的版本号，对应客户端 BuiltInVersion */
  clientVersion: string;
  announcement: string;
  /** true 表示即便版本一致也提示整包更新 */
  force: boolean;
}

const SAFE_ID = /^[0-9A-Za-z._-]+$/;

export function readCurrentRelease(): string {
  try {
    const id = fs.readFileSync(CURRENT_FILE, 'utf8').trim();
    return SAFE_ID.test(id) ? id : '';
  } catch {
    return '';
  }
}

export function writeCurrentRelease(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error('发布目录名非法');
  fs.mkdirSync(MOD_ROOT, { recursive: true });
  fs.writeFileSync(CURRENT_FILE, id + '\n', 'utf8');
}

export function releaseDir(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error('发布目录名非法');
  return path.join(MOD_ROOT, id);
}

export function readReleaseMeta(id: string): ReleaseMeta | null {
  try {
    const raw = fs.readFileSync(path.join(releaseDir(id), 'release.json'), 'utf8');
    const jo = JSON.parse(raw);
    return {
      version: String(jo.version || id),
      clientVersion: String(jo.clientVersion || jo.version || id),
      announcement: String(jo.announcement || ''),
      force: Boolean(jo.force)
    };
  } catch {
    return null;
  }
}

export function writeReleaseMeta(id: string, meta: ReleaseMeta): void {
  const dir = releaseDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

/** 已发布的目录名列表，按版本号升序 */
export function listReleases(): string[] {
  try {
    return fs
      .readdirSync(MOD_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && SAFE_ID.test(d.name))
      .map((d) => d.name)
      .sort(compareVersion);
  } catch {
    return [];
  }
}

/** 版本号比较：数字段按数值比，非数字段按字符串比 */
export function compareVersion(a: string, b: string): number {
  const pa = String(a).split(/[.\-_+]/);
  const pb = String(b).split(/[.\-_+]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export interface ModFileEntry {
  /** 客户端按 basename 存进 CacheAssets，这里给文件名即可 */
  name: string;
  hash: string;
  size: number;
  url: string;
}

/** 递归收集目录下的相对路径，跳过隐藏文件 */
function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full, base));
    else if (ent.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/**
 * 生成「热更新层」清单：只取 <release>/CacheAssets 下的文件。
 * 客户端会把它们全部存进 CacheAssets/，并删除清单外的本地文件，
 * 所以这个清单必须完整覆盖 CacheAssets 的内容，缺一个就会被删掉。
 */
export function buildHotManifest(
  releaseId: string,
  baseUrl: string,
  hashOf: (abs: string) => string
): ModFileEntry[] {
  const hotDir = path.join(releaseDir(releaseId), 'CacheAssets');
  const files = walkFiles(hotDir);
  if (files.length === 0) return [];

  const seen = new Set<string>();
  return files.map((rel) => {
    const abs = path.join(hotDir, rel);
    const stat = fs.statSync(abs);
    const base = path.basename(rel);
    // 客户端按 basename 落地，重名会互相覆盖，先到先得并提醒调用方
    if (seen.has(base)) throw new Error(`CacheAssets 内 basename 重名: ${base}`);
    seen.add(base);
    return {
      name: base,
      hash: hashOf(abs),
      size: stat.size,
      url: `${baseUrl}/mods/${encodeURIComponent(releaseId)}/CacheAssets/${rel
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    };
  });
}

/** 列出某个发布里各层的文件，供管理端/自检展示 */
export function describeRelease(releaseId: string): {
  hot: string[];
  boot: string[];
} {
  const dir = releaseDir(releaseId);
  return {
    hot: walkFiles(path.join(dir, 'CacheAssets')),
    boot: walkFiles(path.join(dir, 'boot'))
  };
}
