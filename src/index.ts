import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config';
import { handleMessage, handleDisconnect } from './handlers';
import { logSystem, logConnect, logError, logWarning } from './utils/logger';
import { sessionManager } from './managers/session.manager';
import { sceneManager } from './managers/scene.manager';
import { roomManager } from './managers/room.manager';
import { broadcastService } from './services/broadcast.service';
import { createAdminHttpServer } from './admin-server';
import * as adminWsManager from './admin-ws.manager';
import { initSchema } from './db/schema';

// 建表（幂等），必须在任何数据库访问之前完成
initSchema();

// 同一端口：HTTP（管理页 + API）+ WebSocket
const httpServer = createAdminHttpServer();
const wss = new WebSocketServer({ server: httpServer });

/** 管理端概览推送间隔（毫秒） */
const ADMIN_OVERVIEW_INTERVAL_MS = 3000;

httpServer.listen(config.server.port, () => {
  logSystem(`服务器启动，端口: ${config.server.port}（WebSocket + 管理页 http://localhost:${config.server.port}/ ）`);
  broadcastService.start();
  setInterval(() => {
    const lobby = sceneManager.getScene('lobby');
    adminWsManager.broadcastToAllAdmins({
      type: 'admin/overview',
      data: {
        onlineCount: sessionManager.getOnlineCount(),
        roomCount: roomManager.getList().length,
        lobbyCount: lobby ? lobby.players.size : 0,
      },
    });
  }, ADMIN_OVERVIEW_INTERVAL_MS);
});

wss.on('connection', (ws: WebSocket) => {
  logConnect('新客户端连接');

  ws.on('message', (data: Buffer) => {
    handleMessage(ws, data.toString());
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    logError('WebSocket错误', err);
  });

  ws.send(JSON.stringify({ type: 'connected', message: '连接成功' }));
});

// 启动心跳超时检测定时器
setInterval(() => {
  const timeoutSessions = sessionManager.getTimeoutSessions(config.server.heartbeatTimeout);

  for (const session of timeoutSessions) {
    logWarning(`客户端心跳超时，主动断开连接: ${session.username}(ID:${session.userId})`);

    try {
      // 主动关闭 WebSocket 连接
      session.ws.close(1000, '心跳超时');

      // 触发断开连接处理（清理房间、大厅等）
      handleDisconnect(session.ws);
    } catch (err) {
      logError('关闭超时连接时出错', err);
    }
  }
}, config.server.heartbeatCheckInterval);
