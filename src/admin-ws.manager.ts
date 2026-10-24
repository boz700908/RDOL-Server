/**
 * 管理端 WebSocket：全 Node 管理
 * - 所有已鉴权管理员连接都会收到：概览推送、房间列表变更（room/created、room/destroyed、room/updated）
 * - 订阅了某房间的管理员额外收到该房间内广播（聊天、进出、状态等）
 */

import { WebSocket } from 'ws';

interface AdminConnection {
  subscribedRoomId: string | null;
}

const adminConnections = new Map<WebSocket, AdminConnection>();

export function registerAdmin(ws: WebSocket): void {
  adminConnections.set(ws, { subscribedRoomId: null });
}

export function unregisterAdmin(ws: WebSocket): void {
  adminConnections.delete(ws);
}

export function isAdmin(ws: WebSocket): boolean {
  return adminConnections.has(ws);
}

export function setSubscribedRoom(ws: WebSocket, roomId: string | null): void {
  const conn = adminConnections.get(ws);
  if (conn) conn.subscribedRoomId = roomId;
}

/** 向所有管理员连接推送一条消息（概览、房间列表变更等） */
export function broadcastToAllAdmins(message: object): void {
  const msgStr = JSON.stringify(message);
  for (const [ws] of adminConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(msgStr);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * 将房间内广播的消息转发给所有订阅了该房间的管理员连接
 */
export function forwardToRoomSubscribers(roomId: string, message: object): void {
  const msgStr = JSON.stringify(message);
  for (const [ws, conn] of adminConnections) {
    if (conn.subscribedRoomId === roomId && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(msgStr);
      } catch {
        // ignore
      }
    }
  }
}
