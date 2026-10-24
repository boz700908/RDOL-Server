/**
 * 管理端 WebSocket 消息：鉴权、订阅/取消订阅房间；鉴权成功后推送全站初始数据
 */

import { WebSocket } from 'ws';
import { authService } from '../services/auth.service';
import { sessionManager } from '../managers/session.manager';
import { sceneManager } from '../managers/scene.manager';
import { roomManager } from '../managers/room.manager';
import * as adminWsManager from '../admin-ws.manager';

const ADMIN_ROLE = 2;

function sendOverview(ws: WebSocket): void {
  const lobby = sceneManager.getScene('lobby');
  const data = {
    onlineCount: sessionManager.getOnlineCount(),
    roomCount: roomManager.getList().length,
    lobbyCount: lobby ? lobby.players.size : 0,
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'admin/overview', data }));
  }
}

function sendRoomList(ws: WebSocket): void {
  const data = { rooms: roomManager.getList() };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'admin/roomList', data }));
  }
}

export async function handleAdminMessage(
  ws: WebSocket,
  type: string,
  data: any,
  requestId?: string
): Promise<void> {
  const send = (payload: object) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ...payload, requestId }));
    }
  };

  if (type === 'admin/auth') {
    const token = data?.token?.trim();
    if (!token) {
      send({ success: false, message: '缺少 token' });
      return;
    }
    const user = await authService.verifyToken(token);
    if (!user || user.role < ADMIN_ROLE) {
      send({ success: false, message: 'Token 无效或需要管理员权限' });
      return;
    }
    adminWsManager.registerAdmin(ws);
    send({ success: true, message: '管理端已连接' });
    sendOverview(ws);
    sendRoomList(ws);
    return;
  }

  if (!adminWsManager.isAdmin(ws)) {
    send({ success: false, message: '请先发送 admin/auth 鉴权' });
    return;
  }

  if (type === 'admin/subscribe') {
    const roomId = data?.roomId?.trim();
    if (!roomId) {
      send({ success: false, message: '缺少 roomId' });
      return;
    }
    adminWsManager.setSubscribedRoom(ws, roomId);
    send({ success: true, message: `已订阅房间 ${roomId}` });
    return;
  }

  if (type === 'admin/unsubscribe') {
    adminWsManager.setSubscribedRoom(ws, null);
    send({ success: true, message: '已取消订阅' });
    return;
  }

  send({ success: false, message: '未知的管理端操作' });
}
