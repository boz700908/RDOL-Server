import { WebSocket } from 'ws';
import { handleAuth } from './auth.handler';
import { handleLobby } from './lobby.handler';
import { handlePlayer } from './player.handler';
import { handleRoom } from './room.handler';
import { handleChat } from './chat.handler';
import { handleAdminMessage } from './admin.handler';
import * as adminWsManager from '../admin-ws.manager';
import { sessionManager } from '../managers/session.manager';
import { sceneManager } from '../managers/scene.manager';
import { roomManager } from '../managers/room.manager';
import { UserInfo } from '../types';
import { SILENT_ACTIONS } from '../config/constants';
import { ERR_MESSAGE_FORMAT, ERR_NOT_LOGGED_IN, ERR_UNKNOWN_MODULE, ERR_PLEASE_LOGIN, ERR_SERVER_ERROR } from '../utils/errors';
import { logAction, logActionFail, logError, logConnect } from '../utils/logger';

interface Message {
  type: string;
  data?: any;
  requestId?: string;
}

// 未登录也允许调用的动作。register 必须在其中，否则新用户无法注册；
// verify/logout 用 token 自证身份，同样允许。
const publicActions = new Set([
  'auth/sendCode',
  'auth/register',
  'auth/login',
  'auth/verify',
  'auth/logout',
  'ping'
]);

// 操作描述映射
const actionDescriptions: Record<string, (data: any) => string> = {
  'auth/sendCode': () => '邮箱验证已关闭（兼容占位）',
  'auth/register': (d) => `注册账号 ${d.username}`,
  'auth/login': (d) => `登录账号 ${d.account}`,
  'auth/logout': () => '登出',
  'lobby/join': () => '进入大厅',
  'lobby/leave': () => '离开大厅',
  'lobby/move': (d) => `移动至 (${d?.x}, ${d?.y})`,
  'lobby/players': () => '获取大厅玩家列表',
  'player/emote': (d) => `播放表情 ${d.emote}`,
  'chat/send': () => '发送聊天消息',
  'room/create': (d) => `创建房间 "${d.name}"`,
  'room/join': (d) => `加入房间 ${d.roomId}`,
  'room/leave': () => '离开房间',
  'room/update': () => '修改房间设置',
  'room/list': () => '获取房间列表'
};

function getActionDesc(type: string, data: any): string {
  const fn = actionDescriptions[type];
  return fn ? fn(data) : type;
}

function getUser(ws: WebSocket): UserInfo | null {
  const userId = sessionManager.getUserId(ws);
  if (!userId) return null;

  const session = sessionManager.getSession(userId);
  if (!session) return null;

  return {
    id: userId,
    username: session.username,
    avatar: session.avatar,
    avatarFrame: session.avatarFrame,
    nameColor: session.nameColor
  };
}

type Handler = (action: string, data: any, user: UserInfo | null, ws?: WebSocket) => Promise<any>;

const handlers: Record<string, Handler> = {
  auth: (action, data, _, ws) => handleAuth(ws!, action, data),
  lobby: (action, data, user) => handleLobby(action, data, user!),
  player: (action, data, user) => handlePlayer(action, data, user!),
  room: (action, data, user) => handleRoom(action, data, user!),
  chat: (action, data, user) => handleChat(action, data, user!)
};

const noUserModules = new Set(['auth']);

export async function handleMessage(ws: WebSocket, raw: string): Promise<void> {
  let msg: Message;

  try {
    msg = JSON.parse(raw);
  } catch {
    ws.send(JSON.stringify({ success: false, message: ERR_MESSAGE_FORMAT }));
    return;
  }

  // 兼容客户端 PascalCase（如 C# Newtonsoft.Json 默认）与小写
  const type = typeof msg.type === 'string' ? msg.type : (msg as any).Type;
  const data = msg.data !== undefined ? msg.data : (msg as any).Data;
  const requestId = msg.requestId !== undefined ? msg.requestId : (msg as any).RequestId;

  if (typeof type !== 'string' || !type.trim()) {
    ws.send(JSON.stringify({ success: false, message: ERR_MESSAGE_FORMAT, requestId: requestId ?? (msg as any).RequestId }));
    return;
  }

  if (type === 'admin/auth' || type === 'admin/subscribe' || type === 'admin/unsubscribe') {
    await handleAdminMessage(ws, type, data || {}, requestId);
    return;
  }

  // ping-pong 心跳
  if (type === 'ping') {
    sessionManager.updatePing(ws);
    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    return;
  }

  const [module, action] = type.split('/');
  const shouldLog = !SILENT_ACTIONS.has(type);

  if (!publicActions.has(type)) {
    if (!sessionManager.getUserId(ws)) {
      // 带上 requestId，客户端的回调才能收到这条失败原因；
      // 不主动 close，否则客户端只会看到连接断开而不知道原因。
      ws.send(JSON.stringify({ type, requestId, success: false, message: ERR_NOT_LOGGED_IN }));
      return;
    }
  }

  const handler = handlers[module];
  if (!handler) {
    ws.send(JSON.stringify({ type, requestId, success: false, message: ERR_UNKNOWN_MODULE }));
    return;
  }

  const user = noUserModules.has(module) ? null : getUser(ws);
  if (!noUserModules.has(module) && !user) {
    ws.send(JSON.stringify({ type, requestId, success: false, message: ERR_PLEASE_LOGIN }));
    return;
  }

  try {
    const result = await handler(action, data || {}, user, ws);
    ws.send(JSON.stringify({ type, requestId, ...result }));

    // 记录日志
    if (shouldLog) {
      const desc = getActionDesc(type, data || {});
      let userId = user?.id || 0;
      let username = user?.username || '未知';

      // 登录成功时从返回结果获取用户信息
      if (type === 'auth/login' && result.success && result.data?.user) {
        userId = result.data.user.id;
        username = result.data.user.username;
      } else if (!user && data) {
        // 未登录的操作（如发送验证码）
        username = data.username || data.account || data.email || '未知';
      }

      if (result.success) {
        logAction(userId, username, desc);
      } else {
        logActionFail(userId, username, desc, result.message);
      }
    }
  } catch (err: any) {
    logError('处理消息出错', err);
    ws.send(JSON.stringify({ type, requestId, success: false, message: err.message || ERR_SERVER_ERROR }));
  }
}

export function handleDisconnect(ws: WebSocket): void {
  if (adminWsManager.isAdmin(ws)) {
    adminWsManager.unregisterAdmin(ws);
    return;
  }

  const userId = sessionManager.getUserId(ws);
  if (userId) {
    const session = sessionManager.getSession(userId);
    const username = session?.username || '未知';

    const sceneId = sceneManager.getPlayerScene(userId);
    if (sceneId && sceneId !== 'lobby') {
      const room = roomManager.getRoom(sceneId);
      const wasPlaying = room?.status === 'playing';

      sceneManager.leave(userId);
      roomManager.removePlayer(sceneId, userId);

      if (room) {
        const remainingPlayers = sceneManager.getPlayers(sceneId);
        if (remainingPlayers.length === 0) {
          roomManager.destroy(sceneId);
          const destroyedMsg = { type: 'room/destroyed', data: { roomId: sceneId } };
          sceneManager.broadcastToLobby(destroyedMsg);
          adminWsManager.broadcastToAllAdmins(destroyedMsg);
        } else {
          if (room.ownerId === userId) {
            roomManager.transferOwner(sceneId, remainingPlayers[0].userId);
          }
          const updatedMsg = {
            type: 'room/updated',
            data: {
              roomId: sceneId,
              playerCount: remainingPlayers.length,
              ownerId: roomManager.getRoom(sceneId)?.ownerId
            }
          };
          sceneManager.broadcastToLobby(updatedMsg);
          adminWsManager.broadcastToAllAdmins(updatedMsg);

          // 游戏中有人断线：若剩余玩家都已结束，则广播游戏结束
          if (wasPlaying && roomManager.isAllFinished(sceneId)) {
            const scene = sceneManager.getScene(sceneId);
            const playerIds = scene ? Array.from(scene.players.keys()) : [];
            const scoresMap = roomManager.getAllScores(sceneId);
            const scores = playerIds.map(pid => {
              const player = scene?.players.get(pid);
              return {
                userId: pid,
                username: player?.username ?? '',
                nameColor: player?.nameColor ?? null,
                score: scoresMap?.get(pid) ?? '0'
              };
            });
            roomManager.endGame(sceneId);
            sceneManager.broadcast(sceneId, {
              type: 'room/gameEnd',
              data: { scores }
            });
            playerIds.forEach(pid => {
              sceneManager.broadcast(sceneId, {
                type: 'room/playerReady',
                data: { userId: pid, ready: false }
              });
            });
            const waitingMsg = { type: 'room/updated', data: { roomId: sceneId, status: 'waiting' } };
            sceneManager.broadcastToLobby(waitingMsg);
            adminWsManager.broadcastToAllAdmins(waitingMsg);
          }
        }
      }
    } else {
      sceneManager.leave(userId);
    }

    sessionManager.logoutByWs(ws);
    logConnect(`${username}(ID:${userId}) 断开连接`);
  }
}
