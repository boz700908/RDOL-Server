import { query } from '../db/sqlite';
import { User } from '../models/user';
import { verifyPassword, hashPassword } from '../utils/password';
import { generateToken } from '../utils/token';
import { TOKEN_EXPIRE_DAYS } from '../config/constants';
import { config } from '../config';
import {
  ERR_USERNAME_EXISTS,
  ERR_USER_NOT_FOUND,
  ERR_ACCOUNT_DISABLED,
  ERR_PASSWORD_WRONG
} from '../utils/errors';

class AuthService {
  async login(account: string, password: string): Promise<{ success: boolean; message: string; data?: any }> {
    const users = await query<User[]>(
      'SELECT * FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)',
      [account, account]
    );

    if (users.length === 0) {
      return { success: false, message: ERR_USER_NOT_FOUND };
    }

    const user = users[0];

    if (user.status === 0) {
      return { success: false, message: ERR_ACCOUNT_DISABLED };
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return { success: false, message: ERR_PASSWORD_WRONG };
    }

    // 检查是否绑定QQ。原版依赖 QQ 机器人校验，自建部署没有该机器人，
    // 因此改为可配置；REQUIRE_QQ_BIND=false 时跳过。
    if (config.auth.requireQqBind && !user.qq) {
      return { success: false, message: '未绑定QQ,请在群内通过机器人命令绑定QQ' };
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

    await query(
      'UPDATE users SET token = ?, token_expires_at = ? WHERE id = ?',
      [token, expiresAt, user.id]
    );

    return {
      success: true,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          avatarFrame: user.avatar_frame ?? null,
          nameColor: user.name_color ?? null,
          role: user.role,
          qq: user.qq
        }
      }
    };
  }

  /**
   * 注册新账号。
   *
   * 客户端发送字段：{ username, email, password, code }（auth/register）
   * 自建部署已移除邮箱验证：email 与 code 均可不传，只按用户名 + 密码注册。
   * 传了就校验邮箱格式并用其登记（仍保持唯一，便于后续按邮箱登录）。
   */
  async register(
    username: string,
    email: string | null | undefined,
    password: string
  ): Promise<{ success: boolean; message: string; data?: any }> {
    if (!username || !password) {
      return { success: false, message: '用户名和密码不能为空' };
    }
    if (username.length > 50) {
      return { success: false, message: '用户名过长' };
    }
    if (password.length < 6) {
      return { success: false, message: '密码至少 6 位' };
    }

    const existingName = await query<User[]>('SELECT id FROM users WHERE username = ?', [username]);
    if (existingName.length > 0) {
      return { success: false, message: ERR_USERNAME_EXISTS };
    }

    // 邮箱可选：空串或纯空白按未填写处理
    const mail = (email || '').trim();
    if (mail !== '') {
      if (mail.length > 100 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
        return { success: false, message: '邮箱格式不正确' };
      }
      const existingMail = await query<User[]>('SELECT id FROM users WHERE email = ?', [mail]);
      if (existingMail.length > 0) {
        return { success: false, message: '邮箱已被注册' };
      }
    }

    const hashed = await hashPassword(password);

    // 用 RETURNING 直接取回自增 id（SQLite 3.35+ 支持，替代 MySQL 的 insertId）
    const rows = await query<any[]>(
      `INSERT INTO users (username, email, password) VALUES (?, ?, ?) RETURNING id`,
      [username, mail === '' ? null : mail, hashed]
    );
    const id = rows?.[0]?.id;

    return {
      success: true,
      message: '注册成功',
      data: { id, username, email: mail === '' ? null : mail }
    };
  }

  async getUserByAccount(account: string): Promise<User | null> {
    const users = await query<User[]>(
      'SELECT * FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)',
      [account, account]
    );
    return users.length > 0 ? users[0] : null;
  }

  async verifyToken(token: string): Promise<User | null> {
    const users = await query<User[]>(
      'SELECT * FROM users WHERE token = ? AND token_expires_at > NOW()',
      [token]
    );
    return users.length > 0 ? users[0] : null;
  }

  async logout(token: string): Promise<void> {
    await query('UPDATE users SET token = NULL, token_expires_at = NULL WHERE token = ?', [token]);
  }
}

export const authService = new AuthService();
