// 服务器配置
export const SERVER_PORT = 3005;

// 房间限制
export const MAX_ROOMS = 16;
export const MAX_PLAYERS_PER_ROOM = 120;

// 聊天限制
export const MAX_CHAT_MESSAGE_LENGTH = 500;

// Token 配置
export const TOKEN_EXPIRE_DAYS = 7;

// 验证码配置
export const CODE_EXPIRE_MINUTES = 10;
export const CODE_LENGTH = 6;

// 不记录日志的高频消息
export const SILENT_ACTIONS = new Set(['auth/online', 'lobby/move']);

// 定时广播配置
export const BROADCAST_INTERVAL = {
  LOBBY: 5000,  // 大厅广播间隔（毫秒）
  ROOM: 5000    // 房间广播间隔（毫秒）
};

export const BROADCAST_ENABLED = {
  LOBBY: true,  // 是否启用大厅定时广播
  ROOM: true    // 是否启用房间定时广播
};
