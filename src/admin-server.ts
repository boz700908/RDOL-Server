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

/** 管理员最低角色：2=管理员 3=超级管理员 */
const ADMIN_ROLE = 2;

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

/** 校验管理员：验证 token 且 role >= ADMIN_ROLE。未通过则写 401 并返回 null */
async function requireAdmin(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<{ id: number; username: string; role: number } | null> {
  const token = getAuthToken(req);
  if (!token) {
    sendJson(res, 401, { error: '未登录', message: '请先登录' });
    return null;
  }
  const user = await authService.verifyToken(token);
  if (!user) {
    sendJson(res, 401, { error: '登录已失效', message: 'Token 无效或已过期' });
    return null;
  }
  if (user.role < ADMIN_ROLE) {
    sendJson(res, 403, { error: '权限不足', message: '需要管理员权限' });
    return null;
  }
  return { id: user.id, username: user.username, role: user.role };
}

/**
 * POST /api/auth/login
 * 管理端登录：仅管理员（role >= 2）可登录，返回 token 供后续 API 携带
 */
async function handleAuthLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = await parseBody(req) as { account?: string; password?: string };
  const account = body.account?.toString().trim();
  const password = body.password;

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
    sendJson(res, 200, { success: false, message: '需要管理员权限才能访问' });
    return;
  }

  sendJson(res, 200, {
    success: true,
    message: result.message,
    data: { token: result.data.token, user },
  });
}

/**
 * GET /api/overview
 */
function handleGetOverview(res: http.ServerResponse): void {
  const lobby = sceneManager.getScene('lobby');
  sendJson(res, 200, {
    onlineCount: sessionManager.getOnlineCount(),
    roomCount: roomManager.getList().length,
    lobbyCount: lobby ? lobby.players.size : 0,
  });
}

/** 管理员创建房间时使用的房主 ID（系统房间） */
const ADMIN_CREATE_ROOM_OWNER_ID = 0;

/**
 * GET /api/rooms
 */
function handleGetRooms(res: http.ServerResponse): void {
  sendJson(res, 200, roomManager.getList());
}

/**
 * POST /api/rooms — 管理员创建房间
 */
async function handleCreateRoom(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseBody(req) as {
    name?: string;
    maxPlayers?: number;
    password?: string | null;
    chartUrl?: string;
    chartName?: string;
  };
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
    ADMIN_CREATE_ROOM_OWNER_ID,
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
      status: room.status,
      playerCount: 0,
    },
  });
}

/**
 * GET /api/rooms/:id
 */
function handleGetRoom(res: http.ServerResponse, roomId: string): void {
  const room = roomManager.getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { error: '房间不存在', message: '房间不存在' });
    return;
  }
  const players = sceneManager.getPlayers(roomId);
  const roomWithCount = {
    ...room,
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
async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith('/api')) return false;

  const segments = pathname.slice(4).split('/').filter(Boolean);

  try {
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      await handleAuthLogin(req, res);
      return true;
    }

    const admin = await requireAdmin(req, res);
    if (!admin) return true;

    if (pathname === '/api/overview' && req.method === 'GET') {
      handleGetOverview(res);
      return true;
    }
    if (pathname === '/api/rooms' && req.method === 'GET') {
      handleGetRooms(res);
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
          handleGetRoom(res, roomId);
          return true;
        }
        if (req.method === 'PATCH') {
          await handlePatchRoom(req, res, roomId);
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
    const url = req.url ?? '/';
    const pathname = url.split('?')[0];

    const handled = await handleApi(req, res, pathname);
    if (handled) return;

    serveStatic(res, pathname);
  });
}
