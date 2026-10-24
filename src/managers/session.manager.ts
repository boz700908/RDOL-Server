import { WebSocket } from 'ws';

export interface Session {
  userId: number;
  ws: WebSocket;
  username: string;
  avatar: string | null;
  avatarFrame: string | null;
  nameColor: string | null;
  lastPingTime: number; // 最后一次收到 ping 的时间戳
}

class SessionManager {
  private sessions = new Map<number, Session>();
  private wsToUser = new Map<WebSocket, number>();

  login(
    userId: number,
    username: string,
    avatar: string | null,
    avatarFrame: string | null,
    nameColor: string | null,
    ws: WebSocket
  ): boolean {
    if (this.sessions.has(userId)) {
      return false;
    }

    this.sessions.set(userId, {
      userId,
      ws,
      username,
      avatar,
      avatarFrame,
      nameColor,
      lastPingTime: Date.now()
    });
    this.wsToUser.set(ws, userId);
    return true;
  }

  logout(userId: number): void {
    const session = this.sessions.get(userId);
    if (session) {
      this.wsToUser.delete(session.ws);
      this.sessions.delete(userId);
    }
  }

  logoutByWs(ws: WebSocket): number | null {
    const userId = this.wsToUser.get(ws);
    if (userId) {
      this.sessions.delete(userId);
      this.wsToUser.delete(ws);
      return userId;
    }
    return null;
  }

  isOnline(userId: number): boolean {
    return this.sessions.has(userId);
  }

  getSession(userId: number): Session | undefined {
    return this.sessions.get(userId);
  }

  getUserId(ws: WebSocket): number | undefined {
    return this.wsToUser.get(ws);
  }

  getOnlineCount(): number {
    return this.sessions.size;
  }

  getOnlineUsers(): { userId: number; username: string; nameColor: string | null }[] {
    return Array.from(this.sessions.values()).map(s => ({
      userId: s.userId,
      username: s.username,
      nameColor: s.nameColor
    }));
  }

  // 更新心跳时间
  updatePing(ws: WebSocket): void {
    const userId = this.wsToUser.get(ws);
    if (userId) {
      const session = this.sessions.get(userId);
      if (session) {
        session.lastPingTime = Date.now();
      }
    }
  }

  // 获取所有超时的会话
  getTimeoutSessions(timeoutMs: number): Session[] {
    const now = Date.now();
    const timeoutSessions: Session[] = [];

    for (const session of this.sessions.values()) {
      if (now - session.lastPingTime > timeoutMs) {
        timeoutSessions.push(session);
      }
    }

    return timeoutSessions;
  }
}

export const sessionManager = new SessionManager();
