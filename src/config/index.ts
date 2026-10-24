import 'dotenv/config';

import { SERVER_PORT } from './constants';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少必需的环境变量：${name}`);
  }
  return value;
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function envPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`环境变量 ${name} 必须是有效端口号`);
  }
  return value;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`环境变量 ${name} 必须为 true 或 false`);
}

export const config = {
  server: {
    // RDOL 客户端硬编码连 3005，默认值与之一致；可用 SERVER_PORT 覆盖
    port: envPort('SERVER_PORT', SERVER_PORT),
    heartbeatTimeout: 20000, // 心跳超时时间（毫秒），20秒
    heartbeatCheckInterval: 10000 // 心跳检查间隔（毫秒），每10秒检查一次
  },
  db: {
    // SQLite 单文件数据库，无需账号密码
    file: env('DB_FILE', './data/rdonline.db')
  },
  auth: {
    // 登录是否强制已绑定 QQ（原版依赖 QQ 机器人，自建部署默认关闭）
    requireQqBind: envBoolean('REQUIRE_QQ_BIND', false)
  }
};

export { requiredEnv };
