/**
 * 管理端 HTTP 服务：静态托管 public/ + 管理 API
 * 与 WebSocket 共用同一端口（由 index 挂载到同一 server）
 * 管理 API 除 /api/auth/login 外均需管理员 token（role >= 2）
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import * as adminWsManager from './admin-ws.manager';
import { roomManager } from './managers/room.manager';
import { sessionManager } from './managers/session.manager';
import { sceneManager } from './managers/scene.manager';
import { authService } from './services/auth.service';
import { MAX_PLAYERS_PER_ROOM } from './config/constants';
import crypto from 'crypto';
import { query } from './db/sqlite';
import {
  CHART_DIR,
  MAX_UPLOAD_BYTES,
  gameBaseUrl,
  safeChartName,
  uniqueChartName,
  chartFileNameFromUrl
} from './config/chart';
import {
  publishLevel,
  searchUpstreamOnly,
  fetchUpstreamPackage,
  upstreamDownloadUrl
} from './services/level.service';
import {
  MOD_ROOT,
  readCurrentRelease,
  listReleases,
  readReleaseMeta,
  describeRelease,
  releaseDir
} from './config/mod-releases';
import type { ModFileEntry } from './config/mod-releases';
import { publishModPackage } from './services/mod-publish.service';

/** 管理员最低角色：2=管理员 3=超级管理员 */
const ADMIN_ROLE = 2;

/**
 * 服务端令牌：.env 的 API_TOKEN。
 *
 * 用来救急——管理员密码丢了、或 make-admin.mjs 还没跑起来时，仍能进管理端。
 * 与账号密码走同一条登录接口，前端拿到的是同一个 token 值，不需要区分。
 * 未配置时这条通道整体关闭，不会退化成「空令牌直接放行」。
 */
const API_TOKEN = (process.env.API_TOKEN || '').trim();

/** 整包 mod 上传上限，与 api-server 保持一致 */
const MAX_MOD_BYTES = Number(process.env.MAX_MOD_MB || 256) * 1024 * 1024;

/** 管理端登录身份；viaToken 为 true 表示走的是 API_TOKEN 后备通道 */
interface AdminIdentity {
  id: number;
  username: string;
  role: number;
  viaToken: boolean;
}

/**
 * 常量时间比较。
 *
 * 普通 !== 会在第一个不同字节处返回，泄露前缀匹配长度；令牌比较必须避免。
 */
function tokenEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** 从请求头读取 Bearer token */
function getAuthToken(req: http.IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.trim().match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * 校验管理员：先比服务端令牌，再验用户 token 且 role >= ADMIN_ROLE。
 * 未通过则写 401/403 并返回 null。
 */
async function requireAdmin(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<AdminIdentity | null> {
  const token = getAuthToken(req);
  if (!token) {
    sendJson(res, 401, { error: '未登录', message: '请先登录' });
    return null;
  }

  // ① 后备通道：.env 的 API_TOKEN 等价超级管理员
  if (API_TOKEN && tokenEquals(token, API_TOKEN)) {
    return { id: 0, username: 'api-token', role: 3, viaToken: true };
  }

  // ② 普通通道：账号密码登录后签发的 token
  const user = await authService.verifyToken(token);
  if (!user) {
    sendJson(res, 401, { error: '登录已失效', message: 'Token 无效或已过期' });
    return null;
  }
  if (user.role < ADMIN_ROLE) {
    sendJson(res, 403, { error: '权限不足', message: '需要管理员权限' });
    return null;
  }
  return { id: user.id, username: user.username, role: user.role, viaToken: false };
}

/**
 * POST /api/auth/login
 * 管理端登录：仅管理员（role >= 2）可登录，返回 token 供后续 API 携带
 */
async function handleAuthLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = await parseBody(req) as { account?: string; password?: string; token?: string };
  const account = body.account?.toString().trim();
  const password = body.password;
  const rawToken = body.token?.toString().trim();

  // ① 后备通道：只给 token，走服务端令牌登录（管理员密码丢失时用）
  if (!account && rawToken) {
    if (!API_TOKEN) {
      sendJson(res, 200, {
        success: false,
        message: '服务端未配置 API_TOKEN，请用账号密码登录',
      });
      return;
    }
    if (!tokenEquals(rawToken, API_TOKEN)) {
      sendJson(res, 200, { success: false, message: '令牌无效' });
      return;
    }
    sendJson(res, 200, {
      success: true,
      message: '登录成功',
      data: {
        token: API_TOKEN,
        user: { id: 0, username: 'api-token', role: 3, viaToken: true },
      },
    });
    return;
  }

  // ② 普通通道：账号密码
  if (!account || !password) {
    sendJson(res, 200, { success: false, message: '请输入账号和密码' });
    return;
  }

  const result = await authService.login(account, password);

  if (!result.success) {
    sendJson(res, 200, { success: false, message: result.message });
    return;
  }

  const user = result.data?.user;
  if (!user || user.role < ADMIN_ROLE) {
    // 账号存在但不是管理员：给出可以照做的下一步，而不是干巴巴的「权限不足」
    sendJson(res, 200, {
      success: false,
      message: '该账号不是管理员，无权进入管理端',
      hint: '在服务器上执行 node --env-file=.env scripts/make-admin.mjs promote <账号> 后再登录',
    });
    return;
  }

  sendJson(res, 200, {
    success: true,
    message: result.message,
    data: { token: result.data.token, user },
  });
}

/**
 * 数一条 SELECT COUNT(*) 的结果。
 *
 * query() 对单行查询的返回形状取决于调用方式（对象或数组），这里两种都吃，
 * 数不出来时给 -1 让前端显示「—」而不是把整个概览接口打成 500。
 */
async function countRows(sql: string): Promise<number> {
  try {
    const rows: any = await query(sql);
    const row = Array.isArray(rows) ? rows[0] : rows;
    const value = Number(row?.n ?? row?.count ?? row?.['COUNT(*)']);
    return Number.isFinite(value) ? value : -1;
  } catch {
    return -1;
  }
}

/** 谱面目录里的文件数与总字节数；目录不存在按 0 处理 */
function chartDirStats(): { count: number; bytes: number } {
  try {
    const names = fs.readdirSync(CHART_DIR);
    let bytes = 0;
    let count = 0;
    for (const name of names) {
      try {
        const st = fs.statSync(path.join(CHART_DIR, name));
        if (!st.isFile()) continue;
        count += 1;
        bytes += st.size;
      } catch {
        // 单个文件读不到不影响整体统计
      }
    }
    return { count, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** mod 发布现状；读盘失败一律当「没有发布过」，概览不能因此挂掉 */
function modSummary(): {
  modCurrent: string;
  modCurrentVersion: string;
  modCurrentClientVersion: string;
  modReleaseCount: number;
} {
  try {
    const currentId = readCurrentRelease();
    const meta = currentId ? readReleaseMeta(currentId) : null;
    return {
      modCurrent: currentId,
      modCurrentVersion: meta ? meta.version : '',
      modCurrentClientVersion: meta ? meta.clientVersion : '',
      modReleaseCount: listReleases().length,
    };
  } catch {
    return { modCurrent: '', modCurrentVersion: '', modCurrentClientVersion: '', modReleaseCount: 0 };
  }
}

/**
 * GET /api/overview
 */
async function handleGetOverview(res: http.ServerResponse): Promise<void> {
  const lobby = sceneManager.getScene('lobby');
  const charts = chartDirStats();
  const [userCount, levelCount] = await Promise.all([
    countRows('SELECT COUNT(*) AS n FROM users'),
    countRows('SELECT COUNT(*) AS n FROM levels'),
  ]);

  sendJson(res, 200, {
    onlineCount: sessionManager.getOnlineCount(),
    roomCount: roomManager.getList().length,
    lobbyCount: lobby ? lobby.players.size : 0,
    userCount,
    levelCount,
    chartFileCount: charts.count,
    chartTotalBytes: charts.bytes,
    ...modSummary(),
  });
}

/** 批量把用户 ID 换成账号名，找不到的 ID 不会出现在 Map 里 */
async function usernamesById(ids: number[]): Promise<Map<number, string>> {
  const uniq = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniq.length === 0) return new Map();
  const rows = await query<any[]>(
    `SELECT id, username FROM users WHERE id IN (${uniq.map(() => '?').join(',')})`,
    uniq
  );
  return new Map(rows.map((r) => [Number(r.id), r.username]));
}

/**
 * GET /api/rooms
 */
async function handleGetRooms(res: http.ServerResponse): Promise<void> {
  const rooms = roomManager.getList();
  // 管理员建房间时指定了真实房主，列表里显示名字比显示裸 ID 有用
  const names = await usernamesById(rooms.map((r) => r.ownerId));
  sendJson(res, 200, rooms.map((r) => ({
    ...r,
    ownerUsername: names.get(r.ownerId) ?? null,
  })));
}

/**
 * POST /api/rooms — 管理员创建房间
 */
async function handleCreateRoom(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req) as {
    ownerId?: number;
    name?: string;
    maxPlayers?: number;
    password?: string | null;
    chartUrl?: string;
    chartName?: string;
  };

  // 房主必须是库里真实存在的账号：以前写死 0，建出来的房间没有房主，
  // 谁进来都不是房主，也没法转移，等于死房间。
  const ownerId = Number(body.ownerId);
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    sendJson(res, 400, { success: false, message: '请选择房主账号' });
    return;
  }
  const ownerRows = await query<any[]>('SELECT id, username FROM users WHERE id = ?', [ownerId]);
  if (ownerRows.length === 0) {
    sendJson(res, 404, { success: false, message: '房主账号不存在' });
    return;
  }
  const ownerUsername = ownerRows[0].username;

  const name = body.name?.toString().trim();
  const chartUrl = body.chartUrl?.toString().trim();
  const chartName = body.chartName?.toString().trim();
  if (!name || !chartUrl || !chartName) {
    sendJson(res, 400, { success: false, message: '房间名称、谱面 URL、谱面名称必填' });
    return;
  }
  const maxPlayers = Math.min(MAX_PLAYERS_PER_ROOM, Math.max(1, Number(body.maxPlayers) || 8));
  const password = body.password?.toString().trim() || undefined;

  const result = roomManager.create(
    ownerId,
    name,
    maxPlayers,
    chartUrl,
    chartName,
    password
  );
  if (!result.success) {
    sendJson(res, 400, { success: false, message: result.message });
    return;
  }

  const room = result.room!;
  const createdMsg = {
    type: 'room/created',
    data: {
      room: {
        id: room.id,
        name: room.name,
        maxPlayers: room.maxPlayers,
        hasPassword: !!room.password,
        chartUrl: room.chartUrl,
        chartName: room.chartName,
        ownerId: room.ownerId,
        ownerUsername,
        status: room.status,
        playerCount: 0,
      },
    },
  };
  sceneManager.broadcastToLobby(createdMsg);
  adminWsManager.broadcastToAllAdmins(createdMsg);

  sendJson(res, 201, {
    success: true,
    message: '房间已创建',
    roomId: room.id,
    room: {
      id: room.id,
      name: room.name,
      maxPlayers: room.maxPlayers,
      hasPassword: !!room.password,
      chartUrl: room.chartUrl,
      chartName: room.chartName,
      ownerId: room.ownerId,
      ownerUsername,
      status: room.status,
      playerCount: 0,
    },
  });
}

/**
 * GET /api/rooms/:id
 */
async function handleGetRoom(res: http.ServerResponse, roomId: string): Promise<void> {
  const room = roomManager.getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { error: '房间不存在', message: '房间不存在' });
    return;
  }
  const players = sceneManager.getPlayers(roomId);
  const names = await usernamesById([room.ownerId]);
  const roomWithCount = {
    ...room,
    ownerUsername: names.get(room.ownerId) ?? null,
    playerCount: players.length,
  };
  sendJson(res, 200, {
    room: roomWithCount,
    players: players.map((p) => ({
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      avatarFrame: p.avatarFrame,
      nameColor: p.nameColor,
    })),
  });
}

/**
 * DELETE /api/rooms/:id — 关闭空房间。
 *
 * 房间里有玩家时拒绝：这时候直接销毁会把玩家留在已经不存在场景里，
 * 让管理员先把人移出，最后一个人移出时既有逻辑会自动关房间。
 */
async function handleDeleteRoom(res: http.ServerResponse, roomId: string): Promise<void> {
  const room = roomManager.getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { success: false, message: '房间不存在' });
    return;
  }

  const players = sceneManager.getPlayers(roomId);
  if (players.length > 0) {
    sendJson(res, 409, {
      success: false,
      message: `房间内还有 ${players.length} 名玩家，请先移出再关闭`,
    });
    return;
  }

  roomManager.destroy(roomId);
  const destroyedMsg = { type: 'room/destroyed', data: { roomId } };
  sceneManager.broadcastToLobby(destroyedMsg);
  adminWsManager.broadcastToAllAdmins(destroyedMsg);
  sendJson(res, 200, { success: true, message: '房间已关闭' });
}

/**
 * PATCH /api/rooms/:id
 */
async function handlePatchRoom(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  roomId: string
): Promise<void> {
  const body = await parseBody(req) as {
    name?: string;
    maxPlayers?: number;
    password?: string | null;
    chartUrl?: string;
    chartName?: string;
  };
  const result = roomManager.update(
    roomId,
    {
      name: body.name,
      maxPlayers: body.maxPlayers,
      password: body.password,
      chartUrl: body.chartUrl,
      chartName: body.chartName,
    },
  );
  if (!result.success) {
    sendJson(res, 400, { success: false, message: result.message });
    return;
  }
  sendJson(res, 200, { success: true });
}

/**
 * POST /api/rooms/:id/kick — 管理员踢出玩家
 */
async function handleKickPlayer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  roomId: string
): Promise<void> {
  const body = await parseBody(req) as { userId?: number };
  const userId = body.userId;
  if (userId == null || typeof userId !== 'number') {
    sendJson(res, 400, { success: false, message: '缺少 userId' });
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { error: '房间不存在', message: '房间不存在' });
    return;
  }
  const targetSceneId = sceneManager.getPlayerScene(userId);
  if (targetSceneId !== roomId) {
    sendJson(res, 400, { success: false, message: '目标玩家不在该房间内' });
    return;
  }

  const wasPlaying = room.status === 'playing';
  const targetSession = sessionManager.getSession(userId);
  if (targetSession) {
    targetSession.ws.send(JSON.stringify({ type: 'room/kicked', data: { roomId } }));
  }
  sceneManager.leave(userId);
  roomManager.removePlayer(roomId, userId);

  const remainingPlayers = sceneManager.getPlayers(roomId);
  if (remainingPlayers.length === 0) {
    roomManager.destroy(roomId);
    const destroyedMsg = { type: 'room/destroyed', data: { roomId } };
    sceneManager.broadcastToLobby(destroyedMsg);
    adminWsManager.broadcastToAllAdmins(destroyedMsg);
    sendJson(res, 200, { success: true, message: '玩家已移出，房间已关闭' });
    return;
  }

  if (room.ownerId === userId) {
    roomManager.transferOwner(roomId, remainingPlayers[0].userId);
  }
  const updatedRoom = roomManager.getRoom(roomId);
  const newOwnerId = updatedRoom?.ownerId;
  const roomInfo = {
    roomId,
    playerCount: remainingPlayers.length,
    ownerId: newOwnerId,
  };
  sceneManager.broadcast(roomId, { type: 'room/updated', data: roomInfo });
  sceneManager.broadcastToLobby({ type: 'room/updated', data: roomInfo });
  adminWsManager.broadcastToAllAdmins({ type: 'room/updated', data: roomInfo });

  if (wasPlaying && roomManager.isAllFinished(roomId)) {
    roomManager.endGame(roomId);
    sceneManager.broadcast(roomId, { type: 'room/gameEnd', data: {} });
    sceneManager.broadcastToLobby({ type: 'room/updated', data: { roomId, status: 'waiting' } });
    adminWsManager.broadcastToAllAdmins({ type: 'room/updated', data: { roomId, status: 'waiting' } });
  }
  if (!wasPlaying && roomManager.hasCountdown(roomId) && !roomManager.isAllReady(roomId)) {
    roomManager.cancelCountdown(roomId);
    sceneManager.broadcast(roomId, { type: 'room/countdownCancel', data: {} });
  }

  sendJson(res, 200, { success: true, message: '玩家已移出' });
}

/**
 * POST /api/rooms/:id/transfer-owner — 管理员转移房主
 */
async function handleTransferOwner(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  roomId: string
): Promise<void> {
  const body = await parseBody(req) as { userId?: number };
  const newOwnerId = body.userId;
  if (newOwnerId == null || typeof newOwnerId !== 'number') {
    sendJson(res, 400, { success: false, message: '缺少 userId' });
    return;
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { error: '房间不存在', message: '房间不存在' });
    return;
  }
  const players = sceneManager.getPlayers(roomId);
  const target = players.find((p) => p.userId === newOwnerId);
  if (!target) {
    sendJson(res, 400, { success: false, message: '目标玩家不在该房间内' });
    return;
  }
  if (room.ownerId === newOwnerId) {
    sendJson(res, 400, { success: false, message: '该玩家已是房主' });
    return;
  }

  roomManager.transferOwner(roomId, newOwnerId);
  const roomInfo = {
    roomId,
    playerCount: players.length,
    ownerId: newOwnerId,
  };
  sceneManager.broadcast(roomId, { type: 'room/updated', data: roomInfo });
  sceneManager.broadcastToLobby({ type: 'room/updated', data: roomInfo });
  adminWsManager.broadcastToAllAdmins({ type: 'room/updated', data: roomInfo });

  sendJson(res, 200, { success: true, message: '房主已转移' });
}

/**
 * 路由 /api/* 并处理；除登录外均需管理员 token
 */
// ============================================================
// 谱面库：CHART_DIR 里的谱面包文件
// ============================================================

/**
 * 谱面下载地址必须指向 api-server（3004），不能指向管理端自己的端口。
 * 写进数据库的 url 会被游戏端长期使用，这里拼错就是「发布成功但下载 404」。
 */
function publicChartUrl(name: string, host: string | undefined): string {
  return `${gameBaseUrl(host)}/charts/${encodeURIComponent(name)}`;
}

/** 读原始二进制请求体；超过上限直接拒绝，避免把 2G 内存的机器打爆 */
function readBinaryBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`内容超过上限 ${Math.round(limit / 1048576)}MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * 房间正在用的谱面文件名 → 房间 id 列表。
 *
 * 房间对象里表示当前谱面的字段历史上有几种写法，这里全部兜一遍；
 * 目的是删文件前能告诉管理员「谁在用」，删错了会当场把别人踢出对局。
 */
function roomChartNames(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let rooms: any[] = [];
  try {
    rooms = roomManager.getList() as any[];
  } catch {
    return map;
  }

  for (const room of rooms) {
    const roomId = String(room?.id ?? room?.roomId ?? '');
    const candidates = [
      room?.chartUrl,
      room?.chart,
      room?.url,
      room?.chartInfo?.url,
      room?.selectedChart?.url
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const name = chartFileNameFromUrl(candidate);
      if (!name) continue;
      const list = map.get(name) || [];
      if (!list.includes(roomId)) list.push(roomId);
      map.set(name, list);
    }
  }
  return map;
}

/** 已发布谱面条目引用的文件名 → 条目 id 列表 */
async function levelChartNames(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  let rows: any[] = [];
  try {
    rows = await query<any>('SELECT id, url, url2 FROM levels');
  } catch {
    return map;
  }
  if (!Array.isArray(rows)) return map;

  for (const row of rows) {
    for (const raw of [row?.url, row?.url2]) {
      const name = chartFileNameFromUrl(typeof raw === 'string' ? raw : null);
      if (!name) continue;
      const list = map.get(name) || [];
      list.push(String(row.id));
      map.set(name, list);
    }
  }
  return map;
}

// ---------------- 账号管理 ----------------

/** 玩家当前所在房间；不在任何房间返回 null */
function roomOfUser(userId: number): { id: string; name: string } | null {
  for (const room of roomManager.getList()) {
    const players = sceneManager.getPlayers(room.id);
    if (players.some((p) => p.userId === userId)) {
      return { id: room.id, name: room.name };
    }
  }
  return null;
}

/** GET /api/users — 账号列表，含在线状态与所在房间 */
async function handleGetUsers(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: URLSearchParams
): Promise<void> {
  const page = Math.max(1, Number(params.get('page')) || 1);
  const perPage = Math.min(100, Math.max(1, Number(params.get('perPage')) || 20));
  const q = (params.get('q') || '').trim();

  // 模糊匹配账号与邮箱；q 为空就是全量
  const where = q ? 'WHERE username LIKE ? OR email LIKE ?' : '';
  const args: any[] = q ? [`%${q}%`, `%${q}%`] : [];

  const countRowsRes = await query<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM users ${where}`,
    args
  );
  const total = Number(countRowsRes[0]?.n ?? 0);

  const rows = await query<any[]>(
    `SELECT id, username, email, role, status, created_at FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...args, perPage, (page - 1) * perPage]
  );

  const list = rows.map((r) => ({
    id: r.id,
    username: r.username,
    email: r.email || '',
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
    online: sessionManager.isOnline(r.id),
    room: roomOfUser(r.id)
  }));

  sendJson(res, 200, { list, total, page, perPage });
}

/**
 * PATCH /api/users/:id — 改角色（1 普通用户 / 2 管理员）。
 *
 * 不允许把最后一个管理员降级：否则管理端就再也进不去账号通道了。
 */
async function handleSetUserRole(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawId: string
): Promise<void> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    sendJson(res, 400, { success: false, message: '账号 ID 非法' });
    return;
  }

  const body = await parseBody(req) as { role?: number };
  const role = Number(body.role);
  if (role !== 1 && role !== 2) {
    sendJson(res, 400, { success: false, message: '角色只能是 1（普通用户）或 2（管理员）' });
    return;
  }

  const rows = await query<any[]>('SELECT id, username, role FROM users WHERE id = ?', [id]);
  if (rows.length === 0) {
    sendJson(res, 404, { success: false, message: '账号不存在' });
    return;
  }

  if (rows[0].role >= 2 && role < 2) {
    const admins = await query<{ n: number }[]>('SELECT COUNT(*) AS n FROM users WHERE role >= 2');
    if (Number(admins[0]?.n ?? 0) <= 1) {
      sendJson(res, 409, { success: false, message: '这是最后一个管理员，不能降级' });
      return;
    }
  }

  await query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  sendJson(res, 200, {
    success: true,
    message: role === 2 ? `已将 ${rows[0].username} 设为管理员` : `已取消 ${rows[0].username} 的管理员`,
    role
  });
}

/**
 * POST /api/users/:id/kick — 强制下线。
 *
 * 只负责断连接，清理交给既有的断开流程（房间/大厅移除、会话注销都在那里），
 * 避免这里再走一遍导致重复广播。
 */
async function handleKickUser(res: http.ServerResponse, rawId: string): Promise<void> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    sendJson(res, 400, { success: false, message: '账号 ID 非法' });
    return;
  }

  const session = sessionManager.getSession(id);
  if (!session) {
    sendJson(res, 400, { success: false, message: '该账号当前不在线' });
    return;
  }

  try {
    session.ws.close(1000, '管理员强制下线');
  } catch {
    // 连接可能已经处于关闭中，忽略即可
  }
  sendJson(res, 200, { success: true, message: '已强制下线' });
}

/** DELETE /api/users/:id — 删号。在线时必须先踢下线，避免留下悬挂会话 */
async function handleDeleteUser(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawId: string
): Promise<void> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    sendJson(res, 400, { success: false, message: '账号 ID 非法' });
    return;
  }

  const rows = await query<any[]>('SELECT id, username FROM users WHERE id = ?', [id]);
  if (rows.length === 0) {
    sendJson(res, 404, { success: false, message: '账号不存在' });
    return;
  }

  if (sessionManager.isOnline(id)) {
    sendJson(res, 409, { success: false, message: '该账号在线，请先强制下线再删除' });
    return;
  }

  await query('DELETE FROM users WHERE id = ?', [id]);
  sendJson(res, 200, { success: true, message: `已删除账号 ${rows[0].username}` });
}

/** GET /api/charts — 谱面库文件列表（含被谁引用） */
async function handleGetCharts(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let names: string[] = [];
  try {
    names = fs.readdirSync(CHART_DIR);
  } catch {
    names = [];
  }

  const [byLevel, byRoom] = await Promise.all([levelChartNames(), Promise.resolve(roomChartNames())]);
  const files: any[] = [];
  let totalBytes = 0;

  for (const name of names) {
    const full = path.join(CHART_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    totalBytes += stat.size;
    files.push({
      name,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      url: publicChartUrl(name, req.headers.host),
      levels: byLevel.get(name) || [],
      rooms: byRoom.get(name) || []
    });
  }

  // 新的放前面：刚上传的谱面通常就是管理员要处理的那个
  files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  sendJson(res, 200, { files, total: files.length, totalBytes });
}

/** POST /api/charts/upload?name=xxx — 原始字节上传，落盘名带时间戳前缀 */
async function handleUploadChart(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: URLSearchParams
): Promise<void> {
  const safe = safeChartName(params.get('name') || '');
  if (!safe) {
    sendJson(res, 400, { success: false, message: '文件名非法（只允许 .rdzip/.zip/.rdlevel）' });
    return;
  }

  let buf: Buffer;
  try {
    buf = await readBinaryBody(req, MAX_UPLOAD_BYTES);
  } catch (err) {
    sendJson(res, 413, { success: false, message: String(err instanceof Error ? err.message : err) });
    return;
  }
  if (buf.length === 0) {
    sendJson(res, 400, { success: false, message: '请求体为空' });
    return;
  }

  const finalName = uniqueChartName(safe);
  fs.mkdirSync(CHART_DIR, { recursive: true });
  fs.writeFileSync(path.join(CHART_DIR, finalName), buf);

  sendJson(res, 200, {
    success: true,
    message: '上传成功',
    data: {
      name: finalName,
      size: buf.length,
      url: publicChartUrl(finalName, req.headers.host)
    }
  });
}

/**
 * GET /api/charts/:name/download — 从 CHART_DIR 直接下载谱面包。
 *
 * 为什么不复用 /charts/<name>：那个路径只在 3004 提供，管理页在 3005，直接指过去
 * 会 404；而浏览器 fetch 跨端口又会被同源策略挡住。所以管理端自己流式出一份。
 */
async function handleDownloadChartFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawName: string
): Promise<void> {
  const name = safeChartName(rawName);
  if (!name) {
    sendJson(res, 400, { success: false, message: '文件名非法' });
    return;
  }

  const full = path.join(CHART_DIR, name);
  if (path.dirname(full) !== CHART_DIR || !fs.existsSync(full)) {
    sendJson(res, 404, { success: false, message: '文件不存在' });
    return;
  }

  const stat = fs.statSync(full);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': String(stat.size),
    'Content-Disposition': `attachment; filename="${name}"`
  });
  fs.createReadStream(full).pipe(res);
}

/** DELETE /api/charts/:name — 被房间或已发布条目引用时拒绝 */
async function handleDeleteChart(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawName: string
): Promise<void> {
  const name = safeChartName(rawName);
  if (!name) {
    sendJson(res, 400, { success: false, message: '文件名非法' });
    return;
  }

  const byLevel = await levelChartNames();
  const byRoom = roomChartNames();
  const levelRefs = byLevel.get(name) || [];
  const roomRefs = byRoom.get(name) || [];

  if (levelRefs.length > 0) {
    sendJson(res, 409, {
      success: false,
      message: `该谱面已发布为社区条目（${levelRefs.join('、')}），请先在社区谱面页下架`,
      levels: levelRefs
    });
    return;
  }
  if (roomRefs.length > 0) {
    sendJson(res, 409, {
      success: false,
      message: `该谱面正在房间 ${roomRefs.join('、')} 中使用，不能删除`,
      rooms: roomRefs
    });
    return;
  }

  const full = path.join(CHART_DIR, name);
  // 二次确认目录：即使 name 已被 safeChartName 规范化，也不在这里做路径推断
  if (path.dirname(full) !== path.dirname(path.join(CHART_DIR, 'x'))) {
    sendJson(res, 400, { success: false, message: '路径非法' });
    return;
  }

  try {
    fs.unlinkSync(full);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      sendJson(res, 404, { success: false, message: '文件不存在' });
      return;
    }
    sendJson(res, 500, { success: false, message: String(err?.message || err) });
    return;
  }

  sendJson(res, 200, { success: true, message: '已删除' });
}

// ============================================================
// 社区谱面：本地已发布条目 + 上游 rhythm.cafe
// ============================================================

/** GET /api/levels — 只列本地已发布条目，按发布时间倒序分页 */
async function handleGetLevels(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: URLSearchParams
): Promise<void> {
  const page = Math.max(1, Number(params.get('page') || 1) || 1);
  const perPage = Math.min(100, Math.max(1, Number(params.get('perPage') || 20) || 20));
  const q = (params.get('q') || '').trim();

  const where = q ? 'WHERE song LIKE ? OR artist LIKE ? OR uploader LIKE ?' : '';
  const args = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];

  const rows: any = await query(
    `SELECT id, song, artist, authors, difficulty, image, min_bpm, max_bpm, tags,
            url, url2, description, approval, source, uploader, created_at
       FROM levels ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...args, perPage, (page - 1) * perPage]
  );
  const counted: any = await query(
    `SELECT COUNT(*) AS n FROM levels ${where}`,
    args
  );

  const list = (Array.isArray(rows) ? rows : []).map((row: any) => ({
    ...row,
    authors: parseJsonList(row?.authors),
    tags: parseJsonList(row?.tags),
    // url 里能取到本机文件就说明包在这台机器上，下载走本机流
    chartName: chartFileNameFromUrl(row?.url) || chartFileNameFromUrl(row?.url2) || ''
  }));

  sendJson(res, 200, {
    list,
    total: Number((Array.isArray(counted) ? counted[0]?.n : 0) || 0),
    page,
    perPage
  });
}

/** JSON 数组字符串转数组；坏数据不要让整个列表 500 */
function parseJsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** GET /api/levels/search — 只查上游，字段带原始直链便于判断是否收录 */
async function handleSearchUpstream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: URLSearchParams
): Promise<void> {
  const result = await searchUpstreamOnly({
    q: params.get('q') || '',
    page: Number(params.get('page') || 1) || 1,
    perPage: Number(params.get('perPage') || 20) || 20,
    selfBase: gameBaseUrl(req.headers.host)
  });
  sendJson(res, 200, result);
}

/**
 * POST /api/levels/publish — 把一条谱面发布到本服务器的社区库。
 *
 * 两种来源：
 *   ① chartName：本机 CHART_DIR 里已有的文件（先上传，再发布）
 *   ② upstreamId：直接从 rhythm.cafe 抓包进本机后发布
 * 入库的 url 一律指向 api-server（3004），否则游戏端打不开。
 */
async function handlePublishLevel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  admin: AdminIdentity
): Promise<void> {
  const body = (await parseBody(req)) as any;
  const publicBase = gameBaseUrl(req.headers.host);

  let chartName = '';
  if (body?.upstreamId) {
    const upstreamId = String(body.upstreamId).trim();
    if (!/^[A-Za-z0-9]{1,64}$/.test(upstreamId)) {
      sendJson(res, 400, { success: false, message: '上游关卡 ID 非法' });
      return;
    }
    try {
      const fetched = await fetchUpstreamPackage(upstreamId, CHART_DIR, MAX_UPLOAD_BYTES);
      chartName = fetched.name;
    } catch (err) {
      sendJson(res, 502, {
        success: false,
        message: `从上游抓取失败：${err instanceof Error ? err.message : String(err)}`
      });
      return;
    }
  } else if (body?.chartName) {
    const safe = safeChartName(String(body.chartName));
    if (!safe) {
      sendJson(res, 400, { success: false, message: '谱面文件名非法' });
      return;
    }
    if (!fs.existsSync(path.join(CHART_DIR, safe))) {
      sendJson(res, 404, { success: false, message: '本机没有这个谱面文件，请先上传' });
      return;
    }
    chartName = safe;
  }

  const explicitUrl = String(body?.url || '').trim();
  const url = explicitUrl || (chartName ? publicChartUrl(chartName, req.headers.host) : '');
  if (!url) {
    sendJson(res, 400, { success: false, message: '缺少谱面来源：请先上传/选择本机文件，或填写上游关卡 ID' });
    return;
  }

  try {
    const doc = await publishLevel(
      {
        url,
        url2: body?.url2 || null,
        song: body?.song || chartName || null,
        artist: body?.artist || null,
        authors: body?.authors ?? null,
        difficulty: body?.difficulty ?? null,
        image: body?.image || null,
        minBpm: body?.minBpm ?? null,
        maxBpm: body?.maxBpm ?? null,
        tags: body?.tags ?? null,
        description: body?.description || null,
        source: body?.source || 'admin',
        uploader: admin.username,
        approval: body?.approval ?? 1
      },
      publicBase
    );
    sendJson(res, 200, { success: true, message: '已发布', data: doc });
  } catch (err) {
    sendJson(res, 400, {
      success: false,
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * DELETE /api/levels/:id — 下架。
 *
 * 只删数据库条目；谱面文件默认保留（可能还有房间在用）。带 ?purgeFile=1
 * 时顺手删文件，但被房间引用就不删，并把原因回给前端。
 */
async function handleDeleteLevel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
  params: URLSearchParams
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    sendJson(res, 400, { success: false, message: '条目 ID 非法' });
    return;
  }

  const rows: any = await query<any>('SELECT id, url, url2 FROM levels WHERE id = ?', [id]);
  if (!Array.isArray(rows) || rows.length === 0) {
    sendJson(res, 404, { success: false, message: '条目不存在' });
    return;
  }

  await query('DELETE FROM levels WHERE id = ?', [id]);

  let purge: any = { tried: false };
  if (params.get('purgeFile') === '1') {
    const name = chartFileNameFromUrl(rows[0].url) || chartFileNameFromUrl(rows[0].url2);
    if (!name) {
      purge = { tried: true, deleted: false, reason: '条目地址不是本机文件' };
    } else {
      const roomRefs = roomChartNames().get(name) || [];
      // 别处还引用同一份文件时也不能删
      const others: any = await query<any>(
        'SELECT id FROM levels WHERE url LIKE ? OR url2 LIKE ?',
        [`%${name}%`, `%${name}%`]
      );
      if (roomRefs.length > 0) {
        purge = { tried: true, deleted: false, reason: `房间 ${roomRefs.join('、')} 正在使用` };
      } else if (Array.isArray(others) && others.length > 0) {
        purge = { tried: true, deleted: false, reason: '还有其它条目引用同一文件' };
      } else {
        try {
          fs.unlinkSync(path.join(CHART_DIR, name));
          purge = { tried: true, deleted: true, name };
        } catch (err: any) {
          purge = { tried: true, deleted: false, reason: String(err?.message || err) };
        }
      }
    }
  }

  sendJson(res, 200, { success: true, message: '已下架', purge });
}

/** GET /api/levels/:id/download — 本机文件直接流出去 */
async function handleDownloadLevel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  const rows: any = await query<any>('SELECT id, url, url2 FROM levels WHERE id = ?', [id]);
  if (!Array.isArray(rows) || rows.length === 0) {
    sendJson(res, 404, { success: false, message: '条目不存在' });
    return;
  }

  const name = chartFileNameFromUrl(rows[0].url) || chartFileNameFromUrl(rows[0].url2);
  if (!name) {
    sendJson(res, 400, { success: false, message: '该条目的谱面不在本机' });
    return;
  }

  const full = path.join(CHART_DIR, name);
  if (!fs.existsSync(full)) {
    sendJson(res, 404, { success: false, message: '本机文件已丢失' });
    return;
  }

  const stat = fs.statSync(full);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': String(stat.size),
    'Content-Disposition': `attachment; filename="${name}"`
  });
  fs.createReadStream(full).pipe(res);
}

/**
 * GET /api/levels/upstream/:id/download — 直连上游下载。
 *
 * 上游会 302 到 CDN，Node fetch 默认跟随；边收边转，不把整包读进内存。
 */
async function handleUpstreamDownload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  const url = upstreamDownloadUrl(id);
  if (!url) {
    sendJson(res, 400, { success: false, message: '上游关卡 ID 非法' });
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { 'User-Agent': 'RDOL-Server/2.0 (+self-hosted)', Accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(180000)
    });
  } catch (err) {
    sendJson(res, 502, {
      success: false,
      message: `连接上游失败：${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    sendJson(res, 502, { success: false, message: `上游返回 ${upstream.status}` });
    return;
  }

  const length = upstream.headers.get('content-length');
  const headers: Record<string, string> = {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${id}.rdzip"`
  };
  if (length) headers['Content-Length'] = length;
  res.writeHead(200, headers);

  try {
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch {
    // 客户端中途断开是常态，不当作错误
  } finally {
    res.end();
  }
}

// ============================================================
// Mod 发布：整包上传、切换生效版本、预览热更新清单
// ============================================================

/** sha256 打标签，格式与客户端 ComputeFileHash 一致 */
function sha256Tag(file: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(fd, buf, 0, buf.length, null);
      if (read <= 0) break;
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** GET /api/mods — 所有发布 + 当前生效 + 各层文件 */
function handleGetMods(req: http.IncomingMessage, res: http.ServerResponse): void {
  const current = readCurrentRelease();
  const releases = listReleases().map((id) => {
    const meta = readReleaseMeta(id);
    const files = describeRelease(id);
    return {
      id,
      current: id === current,
      version: meta ? meta.version : '',
      clientVersion: meta ? meta.clientVersion : '',
      announcement: meta ? meta.announcement : '',
      force: meta ? Boolean(meta.force) : false,
      hotCount: files.hot.length,
      bootCount: files.boot.length,
      hot: files.hot,
      boot: files.boot
    };
  });

  sendJson(res, 200, { current, root: MOD_ROOT, releases });
}

/** POST /api/mods/publish?release=&clientVersion=&announcement=&force=&activate= */
async function handlePublishMod(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: URLSearchParams
): Promise<void> {
  let buf: Buffer;
  try {
    buf = await readBinaryBody(req, MAX_MOD_BYTES);
  } catch (err) {
    sendJson(res, 413, {
      success: false,
      message: err instanceof Error ? err.message : String(err)
    });
    return;
  }
  if (buf.length === 0) {
    sendJson(res, 400, { success: false, message: '请求体为空' });
    return;
  }

  // 发布目录名留空时用时间戳，避免所有网页发布都挤进同一个目录互相覆盖
  const rawRelease = (params.get('release') || '').trim();
  if (rawRelease && !/^[0-9A-Za-z._-]+$/.test(rawRelease)) {
    sendJson(res, 400, { success: false, message: '发布目录名只能是字母数字和 . _ -' });
    return;
  }
  const releaseId = rawRelease || new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

  // 版本门禁靠 clientVersion：留空就沿用当前生效版本，绝不能让 /checkupdate 空着
  const currentId = readCurrentRelease();
  const currentMeta = currentId ? readReleaseMeta(currentId) : null;
  const clientVersion =
    (params.get('clientVersion') || '').trim() ||
    (currentMeta ? currentMeta.clientVersion : '') ||
    process.env.API_VERSION ||
    '2.0.0';

  try {
    const result = await publishModPackage(buf, {
      releaseId,
      clientVersion,
      announcement: params.get('announcement') || '',
      force: params.get('force') === '1' || params.get('force') === 'true',
      activate: params.get('activate') !== '0'
    });
    sendJson(res, 200, { success: true, message: '发布成功', data: result });
  } catch (err) {
    sendJson(res, 400, {
      success: false,
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

/** POST /api/mods/activate?release=id — /checkupdate 立即切到该版本 */
function handleActivateMod(res: http.ServerResponse, params: URLSearchParams): void {
  const releaseId = (params.get('release') || '').trim();
  if (!/^[0-9A-Za-z._-]+$/.test(releaseId)) {
    sendJson(res, 400, { success: false, message: '发布目录名非法' });
    return;
  }
  if (!readReleaseMeta(releaseId)) {
    sendJson(res, 404, { success: false, message: '该发布不存在' });
    return;
  }
  try {
    // 用写文件的方式切换，api-server 每次请求都重读 current，不需要重启
    fs.writeFileSync(path.join(MOD_ROOT, 'current'), releaseId + '\n', 'utf8');
  } catch (err) {
    sendJson(res, 500, { success: false, message: String(err) });
    return;
  }
  sendJson(res, 200, { success: true, message: '已切换生效版本', data: { current: releaseId } });
}

/** GET /api/mods/preview?release= — 按客户端格式算出 files[]，用于发布前核对 */
function handlePreviewMod(req: http.IncomingMessage, res: http.ServerResponse, params: URLSearchParams): void {
  const releaseId = (params.get('release') || '').trim() || readCurrentRelease();
  if (!releaseId) {
    sendJson(res, 404, { success: false, message: '没有可预览的发布' });
    return;
  }
  try {
    const base = gameBaseUrl(req.headers.host);
    const files: ModFileEntry[] = buildHotManifestFor(releaseId, base);
    const meta = readReleaseMeta(releaseId);
    sendJson(res, 200, {
      version: meta ? meta.clientVersion : '',
      release: releaseId,
      files,
      total: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0)
    });
  } catch (err) {
    sendJson(res, 400, {
      success: false,
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

/** 生成热更新清单；basename 重名会抛错，交给调用方回 400 */
function buildHotManifestFor(releaseId: string, base: string): ModFileEntry[] {
  const hotDir = path.join(releaseDir(releaseId), 'CacheAssets');
  const out: ModFileEntry[] = [];
  const seen = new Set<string>();

  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const base0 = entry.name;
      if (seen.has(base0)) throw new Error(`CacheAssets 内 basename 重名: ${base0}`);
      seen.add(base0);
      const abs = path.join(dir, entry.name);
      out.push({
        name: base0,
        hash: sha256Tag(abs),
        size: fs.statSync(abs).size,
        url: `${base}/mods/${encodeURIComponent(releaseId)}/CacheAssets/${rel
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`
      });
    }
  };

  walk(hotDir, '');
  return out;
}

/** DELETE /api/mods/:id — 正在生效的发布不允许删 */
function handleDeleteMod(res: http.ServerResponse, rawId: string): void {
  const releaseId = decodeURIComponent(rawId);
  if (!/^[0-9A-Za-z._-]+$/.test(releaseId)) {
    sendJson(res, 400, { success: false, message: '发布目录名非法' });
    return;
  }
  if (readCurrentRelease() === releaseId) {
    sendJson(res, 409, {
      success: false,
      message: '这是当前生效版本，请先切换到别的版本再删除'
    });
    return;
  }

  const dir = releaseDir(releaseId);
  if (!fs.existsSync(dir)) {
    sendJson(res, 404, { success: false, message: '该发布不存在' });
    return;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    sendJson(res, 500, { success: false, message: String(err) });
    return;
  }
  sendJson(res, 200, { success: true, message: '已删除发布' });
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  params: URLSearchParams
): Promise<boolean> {
  if (!pathname.startsWith('/api')) return false;

  const segments = pathname.slice(4).split('/').filter(Boolean);

  try {
    // 登录是唯一不需要 token 的接口
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      await handleAuthLogin(req, res);
      return true;
    }

    const admin = await requireAdmin(req, res);
    if (!admin) return true;

    // ---------- 概览 ----------
    if (pathname === '/api/overview' && req.method === 'GET') {
      await handleGetOverview(res);
      return true;
    }

    // ---------- 房间 ----------
    if (pathname === '/api/rooms' && req.method === 'GET') {
      await handleGetRooms(res);
      return true;
    }
    if (pathname === '/api/rooms' && req.method === 'POST') {
      await handleCreateRoom(req, res);
      return true;
    }
    if (segments[0] === 'rooms' && segments[1]) {
      const roomId = decodeURIComponent(segments[1]);
      if (segments.length === 2) {
        if (req.method === 'GET') {
          await handleGetRoom(res, roomId);
          return true;
        }
        if (req.method === 'PATCH') {
          await handlePatchRoom(req, res, roomId);
          return true;
        }
        if (req.method === 'DELETE') {
          await handleDeleteRoom(res, roomId);
          return true;
        }
      }
      if (segments.length === 3) {
        if (segments[2] === 'kick' && req.method === 'POST') {
          await handleKickPlayer(req, res, roomId);
          return true;
        }
        if (segments[2] === 'transfer-owner' && req.method === 'POST') {
          await handleTransferOwner(req, res, roomId);
          return true;
        }
      }
    }

    // ---------- 账号管理 ----------
    if (pathname === '/api/users' && req.method === 'GET') {
      await handleGetUsers(req, res, params);
      return true;
    }
    if (segments[0] === 'users' && segments[1]) {
      const userId = decodeURIComponent(segments[1]);
      if (segments.length === 2) {
        if (req.method === 'PATCH') {
          await handleSetUserRole(req, res, userId);
          return true;
        }
        if (req.method === 'DELETE') {
          await handleDeleteUser(req, res, userId);
          return true;
        }
      }
      if (segments.length === 3 && segments[2] === 'kick' && req.method === 'POST') {
        await handleKickUser(res, userId);
        return true;
      }
    }

    // ---------- 谱面库（磁盘文件） ----------
    if (pathname === '/api/charts' && req.method === 'GET') {
      await handleGetCharts(req, res);
      return true;
    }
    if (pathname === '/api/charts/upload' && req.method === 'POST') {
      await handleUploadChart(req, res, params);
      return true;
    }
    if (segments[0] === 'charts' && segments.length === 3 && segments[2] === 'download' && req.method === 'GET') {
      await handleDownloadChartFile(req, res, decodeURIComponent(segments[1]));
      return true;
    }
    if (segments[0] === 'charts' && segments.length === 2 && req.method === 'DELETE') {
      await handleDeleteChart(req, res, decodeURIComponent(segments[1]));
      return true;
    }

    // ---------- 社区谱面 ----------
    if (pathname === '/api/levels' && req.method === 'GET') {
      await handleGetLevels(req, res, params);
      return true;
    }
    // search 必须排在 :id 之前，否则会被当成条目 id
    if (pathname === '/api/levels/search' && req.method === 'GET') {
      await handleSearchUpstream(req, res, params);
      return true;
    }
    if (pathname === '/api/levels/publish' && req.method === 'POST') {
      await handlePublishLevel(req, res, admin);
      return true;
    }
    if (segments[0] === 'levels' && segments[1] === 'upstream' && segments[2]) {
      const upstreamId = decodeURIComponent(segments[2]);
      if (segments[3] === 'download' && req.method === 'GET') {
        await handleUpstreamDownload(req, res, upstreamId);
        return true;
      }
    }
    if (segments[0] === 'levels' && segments.length === 3 && segments[2] === 'download') {
      if (req.method === 'GET') {
        await handleDownloadLevel(req, res, decodeURIComponent(segments[1]));
        return true;
      }
    }
    if (segments[0] === 'levels' && segments.length === 2) {
      if (req.method === 'DELETE') {
        await handleDeleteLevel(req, res, decodeURIComponent(segments[1]), params);
        return true;
      }
    }

    // ---------- Mod 发布 ----------
    if (pathname === '/api/mods' && req.method === 'GET') {
      handleGetMods(req, res);
      return true;
    }
    if (pathname === '/api/mods/publish' && req.method === 'POST') {
      await handlePublishMod(req, res, params);
      return true;
    }
    if (pathname === '/api/mods/activate' && req.method === 'POST') {
      handleActivateMod(res, params);
      return true;
    }
    if (pathname === '/api/mods/preview' && req.method === 'GET') {
      handlePreviewMod(req, res, params);
      return true;
    }
    if (segments[0] === 'mods' && segments.length === 2 && req.method === 'DELETE') {
      handleDeleteMod(res, segments[1]);
      return true;
    }
  } catch (err) {
    sendJson(res, 500, { error: '服务器错误', message: String(err) });
    return true;
  }

  sendJson(res, 404, { error: '接口不存在', message: '接口不存在' });
  return true;
}

/**
 * 静态文件：以 public 为根
 */
function serveStatic(res: http.ServerResponse, pathname: string): void {
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(PUBLIC_DIR, pathname);
  const ext = path.extname(filePath);

  if (pathname.includes('..')) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end();
      } else {
        res.writeHead(500);
        res.end();
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/**
 * 创建并返回 HTTP 服务器（不 listen），供 index 挂载 WebSocket 并 listen
 */
export function createAdminHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    // 用 URL 解析而不是手动切 '?': 查询串需要 decodeURIComponent 过的值
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = parsed.pathname;

    const handled = await handleApi(req, res, pathname, parsed.searchParams);
    if (handled) return;

    serveStatic(res, pathname);
  });
}
