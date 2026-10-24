/**
 * 社区谱面库
 *
 * 背景：客户端 Assets/Scripts/Cafe/ScrLevelList.cs 把 caf 列表当成 Typesense 端点调用，
 * 原来的两个源都已失效（cafe.rhythmdoctor.top 502、orchardb.fly.dev DNS 消失）。
 *
 * 这里不是「自建一个空库」，而是：官方上游 Rhythm Cafe（rhythm.cafe）仍然存活，
 * 实测 5320 条真实谱面、rdzip 走 c2.rhythm.cafe（支持 Range）。参考仓库
 * memsys-lizi/RhythmCafe-Web 证明它就是个纯代理，所以我们做同一件事，另外：
 *
 *   1. 把上游字段转换成客户端 LevelDocument 认识的形状（见 toDocument）
 *   2. 把本服务自己发布的谱面（POST /charts/publish）并进同一个列表，排在最前
 *   3. 上游不可用时只返回本地谱面，列表不会变成空白
 *
 * 客户端解析逻辑因此零改动（LevelSearchResponse → {found, hits[{document}], page, out_of}）。
 */
import dns from 'node:dns';
import { randomBytes } from 'node:crypto';
import { query } from '../db/sqlite';

// 本机只有 IPv4 出口；rhythm.cafe 解析出 AAAA 时会先试 IPv6 并卡到超时
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // 老版本 Node 没有该方法，忽略
}

const UPSTREAM_BASE = (process.env.RHYTHM_CAFE_BASE_URL || 'https://rhythm.cafe').replace(/\/$/, '');

/** 上游每页固定 20 条；客户端默认请求 15 条，这里按需多取 */
const UPSTREAM_PAGE_SIZE = 20;

/** 数据库中本地发布的 levels 行 */
interface LevelRow {
  id: string;
  song: string;
  artist: string | null;
  authors: string | null;
  difficulty: number;
  image: string | null;
  min_bpm: number;
  max_bpm: number;
  tags: string | null;
  url: string;
  url2: string | null;
  description: string | null;
  approval: number;
  source: string | null;
  uploader: string | null;
  created_at: string;
}

/** 客户端 LevelDocument：ScrLevelList / ScrLevelCard / SelectedLevel 直接读这些字段 */
export interface LevelDocument {
  id: string;
  song: string;
  artist: string;
  authors: string[];
  difficulty: number;
  image: string;
  min_bpm: number;
  max_bpm: number;
  tags: string[];
  url: string;
  url2: string;
  description: string;
  approval: number;
  source: string;
}

export interface PublishInput {
  url?: string | null;
  url2?: string | null;
  name?: string | null;
  song?: string | null;
  artist?: string | null;
  authors?: string[] | string | null;
  difficulty?: number | null;
  image?: string | null;
  minBpm?: number | null;
  maxBpm?: number | null;
  tags?: string[] | string | null;
  description?: string | null;
  source?: string | null;
  uploader?: string | null;
  approval?: number | null;
}

function toJsonArray(value: string[] | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? JSON.stringify(parsed.map(String)) : JSON.stringify([text]);
      } catch {
        return JSON.stringify([text]);
      }
    }
    return JSON.stringify(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  return JSON.stringify(value.map((s) => String(s).trim()).filter(Boolean));
}

function fromJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // 兼容尽早期的逗号分隔写法
  }
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/** 上游 song/artist 可能带 Unity 颜色标签，客户端用的是 TMP，去掉更保险 */
function stripTags(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampDifficulty(value: unknown): number {
  return Math.min(3, Math.max(0, Math.trunc(toNumber(value, 1))));
}

/**
 * 上游 hit（Rhythm Cafe 原生字段）→ 客户端 LevelDocument。
 *
 * 下载地址策略：url2 = 上游 CDN 直链（c2.rhythm.cafe，Cloudflare，测过支持 Range 206），
 * url  = 本服务的反代（GET /api/levels/:id/download）。客户端 ChartUrl 取 url2 ?? url，
 * 所以优先走 CDN 直连，CDN 不通时还有反代兜底；也不会把 25MB 的流量压到本机 1Mbps 出口。
 */
function upstreamToDocument(hit: Record<string, unknown>, selfBase: string): LevelDocument {
  const id = String(hit.id ?? '');
  return {
    id,
    song: stripTags(hit.song) || stripTags(hit.song_raw) || id,
    artist: stripTags(hit.artist) || stripTags(hit.artist_raw),
    authors: Array.isArray(hit.authors) ? hit.authors.map((a) => stripTags(a)).filter(Boolean) : [],
    difficulty: clampDifficulty(hit.difficulty),
    image: String(hit.thumb_url || hit.image_url || ''),
    min_bpm: toNumber(hit.min_bpm, 0),
    max_bpm: toNumber(hit.max_bpm, 0),
    tags: Array.isArray(hit.tags) ? hit.tags.map((t) => String(t)) : [],
    url: `${selfBase}/api/levels/${encodeURIComponent(id)}/download`,
    url2: String(hit.rdzip_url || ''),
    description: stripTags(hit.description),
    approval: Math.trunc(toNumber(hit.approval, 0)),
    source: 'rhythm.cafe'
  };
}

function rowToDocument(row: LevelRow): LevelDocument {
  return {
    id: row.id,
    song: row.song || '',
    artist: row.artist || '',
    authors: fromJsonArray(row.authors),
    difficulty: row.difficulty,
    image: row.image || '',
    min_bpm: row.min_bpm,
    max_bpm: row.max_bpm,
    tags: fromJsonArray(row.tags),
    url: row.url,
    url2: row.url2 || '',
    description: row.description || '',
    approval: row.approval,
    source: row.source || 'rdol'
  };
}

/** 拉上游搜索页；失败抛异常，由调用方降级 */
async function fetchUpstream(q: string, page: number, perPage: number) {
  const url = new URL(`${UPSTREAM_BASE}/api/levels/`);
  url.searchParams.set('q', q);
  url.searchParams.set('page', String(page));

  const response = await fetch(url, {
    headers: {
      // 上游对 UA 没有要求，但带一个明确来源便于它们统计
      'User-Agent': 'RDOL-Server/2.0 (+self-hosted)',
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`上游返回 ${response.status}`);
  }

  const body = (await response.json()) as {
    props?: { results?: any };
    results?: any;
  };
  // 实测现在是 {results:...}，参考仓库文档写的是 {props:{results:...}}，两种都认
  const results = body?.props?.results ?? body?.results;
  if (!results || !Array.isArray(results.hits)) {
    throw new Error('上游返回结构无法识别');
  }

  return {
    hits: results.hits as Record<string, unknown>[],
    total: Math.trunc(toNumber(results.estimatedTotalHits, results.hits.length)),
    limit: Math.trunc(toNumber(results.limit, UPSTREAM_PAGE_SIZE)) || UPSTREAM_PAGE_SIZE
  };
}

/** 本地已发布谱面的检索（同样的关键词语义，简单子串匹配） */
async function searchLocal(q: string, limit: number): Promise<LevelDocument[]> {
  const where: string[] = ['approval >= -1'];
  const params: unknown[] = [];
  if (q) {
    const like = `%${q}%`;
    where.push('(song LIKE ? OR artist LIKE ? OR authors LIKE ? OR tags LIKE ? OR description LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const rows = await query<LevelRow[]>(
    `SELECT * FROM levels WHERE ${where.join(' AND ')} ORDER BY datetime(created_at) DESC, rowid DESC LIMIT ?`,
    [...params, limit]
  );
  return rows.map(rowToDocument);
}

export interface SearchInput {
  q?: string;
  page?: number;
  perPage?: number;
  /** 用于拼本地地址；一般是请求的 origin */
  selfBase: string;
}

/**
 * 客户端列表接口：Typesense 兼容外形，内容 = 本地发布 + 上游官方。
 *
 * 分页语义：客户端按 page 递增请求。本地条目只在第 1 页合并（它们数量少且置顶），
 * 上游照它的 offset/limit 取，第 1 页做一次去重避免本地条目挤掉上游条数。
 */
export async function searchLevels(input: SearchInput) {
  const q = (input.q || '').trim();
  const page = Math.max(1, Math.trunc(toNumber(input.page, 1)));
  const perPage = Math.min(100, Math.max(1, Math.trunc(toNumber(input.perPage, 15))));

  // 本地条目整体置顶，后面接上游，当成一条连续序列按全局偏移切片。
  // 不能按「第 1 页塞本地 + 上游裁到 perPage」来做：那样第 1 页被裁掉的上游条目
  // 在第 2 页也不会再出现，翻页等于丢数据。
  let local: LevelDocument[] = [];
  try {
    // 本地条目数远小于上游总量，一次取全，好算偏移
    local = await searchLocal(q, Math.min(1000, perPage * 20));
  } catch {
    local = [];
  }

  const localCount = local.length;
  const start = (page - 1) * perPage;
  const end = start + perPage;

  const pageHits: LevelDocument[] = [];
  // 1) 落在本页窗口内的本地条目
  for (let i = start; i < Math.min(end, localCount); i++) {
    pageHits.push(local[i]);
  }

  // 2) 剩余名额由上游补，按本地条目之后的全局位置换算上游页号。
  //    上游页大小 20，可能和客户端要的 15 不对齐，所以会跨上游两页取。
  let total = 0;
  let upstreamOk = true;
  const remaining = perPage - pageHits.length;

  if (remaining > 0) {
    const upstreamStart = Math.max(0, start - localCount);
    const upstreamEnd = upstreamStart + remaining;
    const seen = new Set<string>();

    try {
      const firstPage = Math.floor(upstreamStart / UPSTREAM_PAGE_SIZE) + 1;
      const lastPage = Math.floor((upstreamEnd - 1) / UPSTREAM_PAGE_SIZE) + 1;

      for (let up = firstPage; up <= lastPage; up++) {
        const upstream = await fetchUpstream(q, up, UPSTREAM_PAGE_SIZE);
        if (up === firstPage) total = upstream.total;

        const offsetInPage = (up - 1) * UPSTREAM_PAGE_SIZE;
        upstream.hits.forEach((hit, index) => {
          const globalPos = offsetInPage + index;
          if (globalPos < upstreamStart || globalPos >= upstreamEnd) return;

          const doc = upstreamToDocument(hit, input.selfBase);
          const key = doc.id || doc.url;
          if (seen.has(key)) return;
          seen.add(key);
          pageHits.push(doc);
        });
      }
    } catch {
      upstreamOk = false;
    }
  } else {
    // 本页已被本地条目填满，仍要知道上游总量才能报 found
    try {
      total = (await fetchUpstream(q, 1, UPSTREAM_PAGE_SIZE)).total;
    } catch {
      upstreamOk = false;
    }
  }

  const found = total + localCount;

  return {
    found,
    page,
    out_of: found,
    hits: pageHits.slice(0, perPage).map((document) => ({ document })),
    // 自检用，不属于客户端契约
    upstreamOk
  };
}

/** 发布（或更新）本地谱面元数据，以 url 为幂等键 */
export async function publishLevel(input: PublishInput, selfBase: string): Promise<LevelDocument> {
  const name = input.name ? String(input.name).replace(/[^A-Za-z0-9._-]/g, '') : '';
  let url = (input.url || '').trim();
  if (!url && name) url = `${selfBase}/charts/${encodeURIComponent(name)}`;
  if (!url) throw new Error('缺少谱面地址（url 或 name）');

  const existing = await query<LevelRow[]>('SELECT * FROM levels WHERE url = ?', [url]);
  const id = existing.length > 0 ? existing[0].id : `lv_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;

  const maxBpm = toNumber(input.maxBpm, 0);
  const minBpm = input.minBpm == null ? maxBpm : toNumber(input.minBpm, maxBpm);
  const song = (input.song || '').trim();

  await query(
    `INSERT INTO levels (id, song, artist, authors, difficulty, image, min_bpm, max_bpm, tags,
                         url, url2, description, approval, source, uploader)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       song = excluded.song, artist = excluded.artist, authors = excluded.authors,
       difficulty = excluded.difficulty, image = excluded.image,
       min_bpm = excluded.min_bpm, max_bpm = excluded.max_bpm, tags = excluded.tags,
       url2 = excluded.url2, description = excluded.description,
       approval = excluded.approval, source = excluded.source, uploader = excluded.uploader`,
    [
      id,
      song || name || id,
      stripTags(input.artist) || null,
      toJsonArray(input.authors),
      clampDifficulty(input.difficulty),
      input.image || null,
      minBpm,
      maxBpm,
      toJsonArray(input.tags),
      url,
      input.url2 || null,
      input.description || null,
      Math.trunc(toNumber(input.approval, 1)),
      input.source || 'rdol',
      input.uploader || null
    ]
  );

  const rows = await query<LevelRow[]>('SELECT * FROM levels WHERE url = ?', [url]);
  return rowToDocument(rows[0]);
}

/** 上游关卡下载地址（/api/levels/:id/download 反代用） */
export function upstreamDownloadUrl(id: string): string | null {
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) return null;
  return `${UPSTREAM_BASE}/levels/${id}/download/`;
}

export async function countLevels(): Promise<number> {
  const rows = await query<{ total: number }[]>('SELECT COUNT(*) AS total FROM levels');
  return rows.length > 0 ? Number(rows[0].total) || 0 : 0;
}

export const UPSTREAM = UPSTREAM_BASE;

/**
 * 只查上游（不含本地已发布条目），供管理端「社区库」页分开呈现。
 *
 * 游戏客户端走 searchLevels（本地+上游合并）；管理端需要能确认「这条到底
 * 是上游来的还是我们自己发的」，所以给一个只返回上游的口子，并把原始字段
 * （ruzip 直链、sha1、上传时间等）一并带出来，方便判断要不要收录到本机。
 */
export async function searchUpstreamOnly(input: {
  q?: string;
  page?: number;
  perPage?: number;
  selfBase: string;
}) {
  const q = (input.q || '').trim();
  const page = Math.max(1, Math.trunc(toNumber(input.page, 1)));
  const perPage = Math.min(UPSTREAM_PAGE_SIZE, Math.max(1, Math.trunc(toNumber(input.perPage, UPSTREAM_PAGE_SIZE))));

  const upstream = await fetchUpstream(q, page, perPage);
  return {
    found: upstream.total,
    page,
    perPage,
    hits: upstream.hits.map((hit) => {
      const doc = upstreamToDocument(hit, input.selfBase);
      return {
        ...doc,
        // 上游原始字段：管理端展示用，客户端契约里没有这些
        rdzipUrl: String(hit.rdzip_url || ''),
        imageUrl: String(hit.image_url || ''),
        thumbUrl: String(hit.thumb_url || ''),
        sha1: String(hit.sha1 || ''),
        lastUpdated: String(hit.last_updated || ''),
        singlePlayer: Boolean(hit.single_player),
        twoPlayer: Boolean(hit.two_player),
        seizureWarning: Boolean(hit.seizure_warning)
      };
    })
  };
}

/**
 * 把上游某个关卡包抓回本机谱面目录，返回落盘后的文件名。
 *
 * 为什么要抓回来而不是让客户端直连 CDN：客户端 url2 走 c2.rhythm.cafe，
 * 在部分网络下不通；管理端先把包收进本机，游戏端就只依赖本服务器。
 * 下载走上游 /levels/<id>/download/ 的 302 到 CDN，Node fetch 自动跟随。
 */
export async function fetchUpstreamPackage(
  id: string,
  chartDir: string,
  maxBytes: number
): Promise<{ name: string; size: number }> {
  const url = upstreamDownloadUrl(id);
  if (!url) throw new Error('关卡 ID 非法');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'RDOL-Server/2.0 (+self-hosted)', Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(180000)
  });
  if (!response.ok) throw new Error(`上游返回 ${response.status}`);
  if (!response.body) throw new Error('上游没有返回内容');

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 0 && declared > maxBytes) {
    throw new Error(`上游包 ${Math.round(declared / 1048576)}MB 超过上限 ${Math.round(maxBytes / 1048576)}MB`);
  }

  // 边收边写，避免把整包读进内存（2 核 2G 的机器上大包会直接把进程打死）
  const fs = await import('fs');
  const path = await import('path');
  const crypto = await import('crypto');

  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const name = `${stamp}_${crypto.randomBytes(3).toString('hex')}_${id}.rdzip`;
  const target = path.join(chartDir, name);

  const handle = fs.createWriteStream(target);
  let size = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) throw new Error('上游包超过大小上限');
      if (!handle.write(chunk)) {
        await new Promise<void>((resolve) => handle.once('drain', () => resolve()));
      }
    }
  } catch (err) {
    handle.destroy();
    try {
      fs.rmSync(target, { force: true });
    } catch {
      /* 清理失败不掩盖原始错误 */
    }
    throw err;
  }

  await new Promise<void>((resolve, reject) => {
    handle.end(() => resolve());
    handle.on('error', reject);
  });

  return { name, size };
}

