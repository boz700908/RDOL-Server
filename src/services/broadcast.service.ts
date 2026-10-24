import { sceneManager } from '../managers/scene.manager';
import { roomManager } from '../managers/room.manager';
import { BROADCAST_INTERVAL, BROADCAST_ENABLED } from '../config/constants';
import { logSystem, logError } from '../utils/logger';

class BroadcastService {
  private lobbyTimer: NodeJS.Timeout | null = null;
  private roomTimer: NodeJS.Timeout | null = null;

  /**
   * 启动定时广播服务
   */
  start(): void {
    if (BROADCAST_ENABLED.LOBBY) {
      this.startLobbyBroadcast();
      logSystem(`大厅定时广播已启动，间隔: ${BROADCAST_INTERVAL.LOBBY}ms`);
    }

    if (BROADCAST_ENABLED.ROOM) {
      this.startRoomBroadcast();
      logSystem(`房间定时广播已启动，间隔: ${BROADCAST_INTERVAL.ROOM}ms`);
    }
  }

  /**
   * 停止定时广播服务
   */
  stop(): void {
    if (this.lobbyTimer) {
      clearInterval(this.lobbyTimer);
      this.lobbyTimer = null;
      logSystem('大厅定时广播已停止');
    }

    if (this.roomTimer) {
      clearInterval(this.roomTimer);
      this.roomTimer = null;
      logSystem('房间定时广播已停止');
    }
  }

  /**
   * 启动大厅定时广播
   */
  private startLobbyBroadcast(): void {
    this.lobbyTimer = setInterval(() => {
      try {
        this.broadcastLobbySync();
      } catch (error) {
        logError('大厅定时广播出错', error);
      }
    }, BROADCAST_INTERVAL.LOBBY);
  }

  /**
   * 启动房间定时广播
   */
  private startRoomBroadcast(): void {
    this.roomTimer = setInterval(() => {
      try {
        this.broadcastRoomSync();
      } catch (error) {
        logError('房间定时广播出错', error);
      }
    }, BROADCAST_INTERVAL.ROOM);
  }

  /**
   * 广播大厅同步消息
   */
  private broadcastLobbySync(): void {
    // 获取大厅内所有玩家
    const players = sceneManager.getPlayers('lobby');

    // 如果大厅没有玩家，不需要广播
    if (players.length === 0) {
      return;
    }

    // 获取所有房间列表
    const rooms = roomManager.getList();

    // 构造广播消息
    const message = {
      type: 'lobby/sync',
      data: {
        players,
        rooms
      }
    };

    // 广播到大厅
    sceneManager.broadcastToLobby(message);
  }

  /**
   * 广播房间同步消息
   */
  private broadcastRoomSync(): void {
    // 获取所有房间
    const rooms = roomManager.getList();

    // 遍历每个房间进行广播
    for (const roomInfo of rooms) {
      try {
        this.broadcastSingleRoomSync(roomInfo.id);
      } catch (error) {
        logError(`房间 ${roomInfo.id} 广播出错`, error);
      }
    }
  }

  /**
   * 广播单个房间的同步消息
   */
  private broadcastSingleRoomSync(roomId: string): void {
    // 获取房间信息
    const room = roomManager.getRoom(roomId);
    if (!room) {
      return;
    }

    // 获取房间内所有玩家
    const players = sceneManager.getPlayers(roomId);

    // 如果房间没有玩家，不需要广播
    if (players.length === 0) {
      return;
    }

    // 获取玩家的准备状态
    const playersWithStatus = players.map(player => {
      const ready = roomManager.isReady(roomId, player.userId);

      return {
        userId: player.userId,
        username: player.username,
        avatar: player.avatar,
        avatarFrame: player.avatarFrame,
        nameColor: player.nameColor,
        ready
      };
    });

    // 构造广播消息
    const message = {
      type: 'room/sync',
      data: {
        room: {
          id: room.id,
          name: room.name,
          maxPlayers: room.maxPlayers,
          hasPassword: !!room.password,
          chartUrl: room.chartUrl,
          chartName: room.chartName,
          ownerId: room.ownerId,
          status: room.status
        },
        players: playersWithStatus
      }
    };

    // 广播到该房间
    sceneManager.broadcast(roomId, message);
  }
}

export const broadcastService = new BroadcastService();
