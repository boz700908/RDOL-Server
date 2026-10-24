import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '{msg}'
    }
  }
});

// 格式化用户标识
function formatUser(userId?: number, username?: string): string {
  if (!userId) return '未知用户';
  return username ? `${username}(ID:${userId})` : `用户(ID:${userId})`;
}

// 操作日志
export function logAction(userId: number, username: string, action: string, detail?: string) {
  const user = formatUser(userId, username);
  const msg = detail ? `${user} ${action}: ${detail}` : `${user} ${action}`;
  logger.info(msg);
}

// 操作失败日志
export function logActionFail(userId: number, username: string, action: string, reason: string) {
  const user = formatUser(userId, username);
  logger.warn(`${user} ${action}失败: ${reason}`);
}

// 系统日志
export function logSystem(msg: string) {
  logger.info(`[系统] ${msg}`);
}

// 错误日志
export function logError(msg: string, err?: any) {
  if (err) {
    logger.error(`[错误] ${msg}: ${err.message || err}`);
  } else {
    logger.error(`[错误] ${msg}`);
  }
}

// 连接日志
export function logConnect(msg: string) {
  logger.info(`[连接] ${msg}`);
}

// 警告日志
export function logWarning(msg: string) {
  logger.warn(`[警告] ${msg}`);
}

export default logger;
