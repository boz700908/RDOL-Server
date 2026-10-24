import { WebSocket } from 'ws';
import { authService } from '../services/auth.service';
import { sessionManager } from '../managers/session.manager';
import { ERR_USER_NOT_FOUND, ERR_ALREADY_LOGGED_IN, ERR_TOKEN_INVALID, ERR_UNKNOWN_ACTION } from '../utils/errors';

export async function handleAuth(ws: WebSocket, action: string, data: any): Promise<any> {
  switch (action) {
    // 邮箱验证已移除：保留动作名以免旧客户端报「未知操作」，直接返回成功
    case 'sendCode':
      return { success: true, message: '本服务器已关闭邮箱验证，无需验证码' };

    case 'register':
      return authService.register(data.username, data.email, data.password);

    case 'login': {
      const user = await authService.getUserByAccount(data.account);
      if (!user) {
        return { success: false, message: ERR_USER_NOT_FOUND };
      }

      if (sessionManager.isOnline(user.id)) {
        return { success: false, message: ERR_ALREADY_LOGGED_IN };
      }

      const result = await authService.login(data.account, data.password);

      if (result.success && result.data) {
        const u = result.data.user;
        sessionManager.login(u.id, u.username, u.avatar, u.avatarFrame ?? null, u.nameColor ?? null, ws);
      }

      return result;
    }

    case 'logout': {
      const userId = sessionManager.getUserId(ws);
      if (userId) {
        sessionManager.logout(userId);
      }

      if (data.token) {
        await authService.logout(data.token);
      }
      return { success: true, message: '已登出' };
    }

    case 'verify': {
      const user = await authService.verifyToken(data.token);
      if (user) {
        return {
          success: true,
          data: {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            avatarFrame: user.avatar_frame ?? null,
            nameColor: user.name_color ?? null,
            role: user.role,
            qq: user.qq
          }
        };
      }
      return { success: false, message: ERR_TOKEN_INVALID };
    }

    case 'online': {
      return {
        success: true,
        data: {
          count: sessionManager.getOnlineCount(),
          users: sessionManager.getOnlineUsers()
        }
      };
    }

    default:
      return { success: false, message: ERR_UNKNOWN_ACTION };
  }
}
