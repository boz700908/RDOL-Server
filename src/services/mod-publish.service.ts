/**
 * mod 整包发布的落地逻辑（api-server 与管理端共用）
 *
 * 为什么单独抽出来：发布入口有两个——命令行 scripts/publish-mod.sh 打 3004 的
 * /mods/admin/publish，管理页打 3005 的 /api/mods/publish。两边必须做完全一样的
 * 分拣、校验和失败清理，否则同一个 zip 走不同入口会得到不同的目录结构。
 *
 * 分层依据来自客户端代码，不是猜的（见 Assets/CheckUpdate/ScnCheckUpdate.cs 与
 * BepInModEntry.Start()）：
 *   boot 层：BepInModEntry.Start() 在检查更新之前就按 basename 从 modPath 根目录
 *           加载，进程内换不掉 —— RDOL.Entry.dll / CheckUpdate.dll /
 *           checkupdate.scene.assets / checkupdate.resources.assets / rdol.config.json
 *   hot 层：ScnCheckUpdate 只会下载进 modPath/CacheAssets —— RDOL.dll /
 *           rdol.scenes.assets / rdol.resources.assets
 *
 * zip 内的路径一律不信任：只用 unzip -Z1 列名，再按 basename 白名单逐个 -j 解压，
 * 包里的 ../ 或绝对路径落不到目录外。
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { MOD_ROOT, releaseDir, readCurrentRelease, writeCurrentRelease, writeReleaseMeta } from '../config/mod-releases';
import type { ReleaseMeta } from '../config/mod-releases';

/** 热更新层：客户端只会下载到 CacheAssets，清单必须完整覆盖，缺一个就会被删 */
export const HOT_FILES = ['RDOL.dll', 'rdol.scenes.assets', 'rdol.resources.assets'] as const;

/** 重启层：BepInModEntry 在检查更新之前就从 modPath 根加载，热更新换不掉 */
export const BOOT_FILES = [
  'RDOL.Entry.dll',
  'CheckUpdate.dll',
  'checkupdate.scene.assets',
  'checkupdate.resources.assets',
  'rdol.config.json'
] as const;

const HOT_SET = new Set<string>(HOT_FILES);
const BOOT_SET = new Set<string>(BOOT_FILES);

export interface IngestResult {
  hot: string[];
  boot: string[];
  warnings: string[];
}

/**
 * 把一个整包 zip 分拣进 <release>/CacheAssets 与 <release>/boot。
 *
 * 调用前 releaseId 必须已通过 SAFE_ID 校验（releaseDir 内部还会再校验一次）。
 * 出错时会抛出，调用方负责清理目录 —— 用一个叫 publishModPackage 的封装即可。
 */
export function ingestPackage(zipBuf: Buffer, releaseId: string): IngestResult {
  const dir = releaseDir(releaseId);
  const hotDir = path.join(dir, 'CacheAssets');
  const bootDir = path.join(dir, 'boot');

  // 重新发布同号版本时先清空，避免上一版残留文件混进清单
  fs.rmSync(hotDir, { recursive: true, force: true });
  fs.rmSync(bootDir, { recursive: true, force: true });
  fs.mkdirSync(hotDir, { recursive: true });
  fs.mkdirSync(bootDir, { recursive: true });

  const tmpZip = path.join(dir, '.upload.zip');
  fs.writeFileSync(tmpZip, zipBuf);

  // 先只列内容，确认是合法 zip 并拿到文件名清单
  const listing = execFileSync('unzip', ['-Z1', tmpZip], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const warnings: string[] = [];
  const hot: string[] = [];
  const boot: string[] = [];

  try {
    for (const entry of listing) {
      if (entry.endsWith('/')) continue;
      const base = path.basename(entry);
      const isHot = HOT_SET.has(base);
      const isBoot = BOOT_SET.has(base);
      if (!isHot && !isBoot) {
        // winhttp.dll / BepInEx 框架文件 / 游戏本体不该混进来，但要告知
        if (/\.(assets|dll|json|ini|txt|md|exe)$/i.test(base)) warnings.push(`跳过未知文件 ${entry}`);
        continue;
      }
      const destDir = isHot ? hotDir : bootDir;
      // -j 扁平化 + 只解这一个成员，杜绝路径穿越
      execFileSync('unzip', ['-o', '-j', tmpZip, entry, '-d', destDir], {
        stdio: 'ignore',
        maxBuffer: 16 * 1024 * 1024
      });
      const out = path.join(destDir, base);
      if (!fs.existsSync(out)) {
        warnings.push(`解压后未找到 ${base}`);
        continue;
      }
      (isHot ? hot : boot).push(base);
    }
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }

  // 热更新层缺文件会让客户端反复重下甚至删掉本地好文件，
  // 宁可发布失败也不要发一个半成品清单。
  const missingHot = HOT_FILES.filter((f) => !hot.includes(f));
  if (missingHot.length > 0) {
    throw new Error(`整包缺少热更新文件: ${missingHot.join(', ')}`);
  }

  hot.sort();
  boot.sort();
  return { hot, boot, warnings };
}

export interface PublishOptions {
  releaseId: string;
  clientVersion: string;
  announcement?: string;
  force?: boolean;
  /** 发布后是否设为当前生效版本，默认 true */
  activate?: boolean;
}

export interface PublishResult extends IngestResult {
  releaseId: string;
  clientVersion: string;
  activated: boolean;
}

/**
 * 发布整包并落地元数据；任何环节失败都会把版本目录整个删掉。
 *
 * 为什么要删整个目录：分拣一开始就清空了 hot/boot，失败后这个版本目录里
 * 只剩半截内容。留着它可能被 activate 或被误切，客户端会拿到不完整清单，
 * 而空清单是安全的（客户端 hasManifest 保护，不删任何本地文件）。
 */
export function publishModPackage(zipBuf: Buffer, opts: PublishOptions): PublishResult {
  const { releaseId, clientVersion } = opts;
  const activate = opts.activate !== false;

  try {
    const result = ingestPackage(zipBuf, releaseId);
    const meta: ReleaseMeta = {
      version: releaseId,
      clientVersion,
      announcement: opts.announcement || '',
      force: Boolean(opts.force)
    };
    writeReleaseMeta(releaseId, meta);
    if (activate) writeCurrentRelease(releaseId);
    return { ...result, releaseId, clientVersion, activated: activate };
  } catch (err) {
    try {
      fs.rmSync(releaseDir(releaseId), { recursive: true, force: true });
    } catch {
      /* 清理失败不掩盖原始错误 */
    }
    // current 若正指向这个版本，一并清掉，让 /checkupdate 走空清单分支
    try {
      if (readCurrentRelease() === releaseId) {
        fs.rmSync(path.join(MOD_ROOT, 'current'), { force: true });
      }
    } catch {
      /* 同上 */
    }
    throw err;
  }
}
