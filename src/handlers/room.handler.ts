import { roomManager } from '../managers/room.manager';
import { sceneManager } from '../managers/scene.manager';
import { sessionManager } from '../managers/session.manager';
import * as adminWsManager from '../admin-ws.manager';
import { UserInfo, PlayerInScene } from '../types';
import { ERR_ROOM_NAME_REQUIRED, ERR_ROOM_NOT_FOUND, ERR_NOT_IN_ROOM, ERR_NOT_ROOM_OWNER, ERR_UNKNOWN_ACTION, ERR_GAME_ALREADY_STARTED, ERR_GAME_NOT_STARTED } from '../utils/errors';

export async function handleRoom(action: string, data: any, user: UserInfo): Promise<any> {
  switch (action) {
    case 'create': {
      const { name, maxPlayers, password, chartUrl, chartName } = data;

      if (!name || !chartUrl || !chartName) {
        return { success: false, message: ERR_ROOM_NAME_REQUIRED };
      }

      const result = roomManager.create(user.id, name, maxPlayers || 8, chartUrl, chartName, password);

      if (!result.success) {
        return result;
      }

      const createdMsg = {
        type: 'room/created',
        data: {
          room: {
            id: result.room!.id,
            name: result.room!.name,
            maxPlayers: result.room!.maxPlayers,
            hasPassword: !!result.room!.password,
            chartUrl: result.room!.chartUrl,
            chartName: result.room!.chartName,
            ownerId: result.room!.ownerId,
            status: result.room!.status,
            playerCount: 0
          }
        }
      };
      sceneManager.broadcastToLobby(createdMsg);
      adminWsManager.broadcastToAllAdmins(createdMsg);

      return {
        success: true,
        message: '房间创建成功',
        data: { roomId: result.room!.id }
      };
    }

    case 'list': {
      const rooms = roomManager.getList();
      return { success: true, data: { rooms } };
    }

    case 'verifyPassword': {
      const { roomId, password } = data;
      const room = roomManager.getRoom(roomId);

      if (!room) {
        return { success: false, message: ERR_ROOM_NOT_FOUND };
      }

      if (!room.password) {
        return { success: true, message: '该房间无密码' };
      }

      if (room.password === password) {
        return { success: true };
      } else {
        return { success: false, message: '密码错误' };
      }
    }

    case 'join': {
      const { roomId, password } = data;

      const canJoin = roomManager.canJoin(roomId, password);
      if (!canJoin.success) {
        return canJoin;
      }

      const room = roomManager.getRoom(roomId);
      if (!room) {
        return { success: false, message: ERR_ROOM_NOT_FOUND };
      }

      const player: PlayerInScene = {
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        avatarFrame: user.avatarFrame,
        nameColor: user.nameColor
      };

      const joinResult = sceneManager.join(roomId, player);
      if (!joinResult.success) {
        return joinResult;
      }

      const playerCount = sceneManager.getPlayers(roomId).length;
      const joinUpdatedMsg = { type: 'room/updated', data: { roomId, playerCount } };
      sceneManager.broadcastToLobby(joinUpdatedMsg);
      adminWsManager.broadcastToAllAdmins(joinUpdatedMsg);

      // 获取所有玩家的准备状态
      const playersWithReady = joinResult.players.map(p => ({
        ...p,
        ready: roomManager.isReady(roomId, p.userId)
      }));

      return {
        success: true,
        message: `已加入房间 ${room.name}`,
        data: {
          room: {
            id: room.id,
            name: room.name,
            maxPlayers: room.maxPlayers,
            hasPassword: !!room.password,
            chartUrl: room.chartUrl,
            chartName: room.chartName,
            ownerId: room.ownerId,
            status: room.status,
            playerCount: sceneManager.getPlayers(roomId).length
          },
          players: playersWithReady
        }
      };
    }

    case 'leave': {
      const currentSceneId = sceneManager.getPlayerScene(user.id);

      if (!currentSceneId || currentSceneId === 'lobby') {
        return { success: false, message: ERR_NOT_IN_ROOM };
      }

      const room = roomManager.getRoom(currentSceneId);
      const wasPlaying = room?.status === 'playing';

      // 清理玩家的准备/结束状态
      roomManager.removePlayer(currentSceneId, user.id);

      sceneManager.leave(user.id);

      if (room) {
        const remainingPlayers = sceneManager.getPlayers(currentSceneId);

        if (remainingPlayers.length === 0) {
          roomManager.destroy(currentSceneId);
          const destroyedMsg = { type: 'room/destroyed', data: { roomId: currentSceneId } };
          sceneManager.broadcastToLobby(destroyedMsg);
          adminWsManager.broadcastToAllAdmins(destroyedMsg);
        } else {
          if (room.ownerId === user.id) {
            roomManager.transferOwner(currentSceneId, remainingPlayers[0].userId);
          }

          const updatedRoom = roomManager.getRoom(currentSceneId);
          const newOwnerId = updatedRoom?.ownerId;

          const leaveUpdatedMsg = {
            type: 'room/updated',
            data: {
              roomId: currentSceneId,
              playerCount: remainingPlayers.length,
              ownerId: newOwnerId
            }
          };
          sceneManager.broadcastToLobby(leaveUpdatedMsg);
          adminWsManager.broadcastToAllAdmins(leaveUpdatedMsg);

          sceneManager.broadcast(currentSceneId, {
            type: 'room/updated',
            data: {
              roomId: currentSceneId,
              playerCount: remainingPlayers.length,
              ownerId: newOwnerId
            }
          });

          // 如果游戏中有人离开，检查是否所有剩余玩家都结束了
          if (wasPlaying && roomManager.isAllFinished(currentSceneId)) {
            roomManager.endGame(currentSceneId);
            sceneManager.broadcast(currentSceneId, {
              type: 'room/gameEnd',
              data: {}
            });
            const statusMsg = { type: 'room/updated', data: { roomId: currentSceneId, status: 'waiting' } };
            sceneManager.broadcastToLobby(statusMsg);
            adminWsManager.broadcastToAllAdmins(statusMsg);
          }

          // 如果等待中有人离开且正在倒计时，检查是否还是全员准备
          if (!wasPlaying && roomManager.hasCountdown(currentSceneId) && !roomManager.isAllReady(currentSceneId)) {
            roomManager.cancelCountdown(currentSceneId);
            sceneManager.broadcast(currentSceneId, {
              type: 'room/countdownCancel',
              data: {}
            });
          }
        }
      }

      return {
        success: true,
        message: '已离开房间'
      };
    }

    case 'info': {
      const { roomId } = data;
      const room = roomManager.getRoom(roomId);

      if (!room) {
        return { success: false, message: ERR_ROOM_NOT_FOUND };
      }

      const players = sceneManager.getPlayers(roomId);

      return {
        success: true,
        data: {
          room: {
            id: room.id,
            name: room.name,
            maxPlayers: room.maxPlayers,
            hasPassword: !!room.password,
            chartUrl: room.chartUrl,
            chartName: room.chartName,
            ownerId: room.ownerId,
            status: room.status,
            playerCount: players.length
          },
          players
        }
      };
    }

    case 'update': {
      const currentSceneId = sceneManager.getPlayerScene(user.id);

      if (!currentSceneId || currentSceneId === 'lobby') {
        return { success: false, message: ERR_NOT_IN_ROOM };
      }

      const room = roomManager.getRoom(currentSceneId);
      if (!room) {
        return { success: false, message: ERR_ROOM_NOT_FOUND };
      }

      if (room.ownerId !== user.id) {
        return { success: false, message: ERR_NOT_ROOM_OWNER };
      }

      const { name, maxPlayers, password, chartUrl, chartName } = data;

      if (name === undefined && maxPlayers === undefined && password === undefined && chartUrl === undefined && chartName === undefined) {
        return { success: false, message: '没有要修改的内容' };
      }

      // 检查是否更新了谱面
      const isChartChanged = (chartUrl !== undefined && chartUrl !== room.chartUrl) ||
        (chartName !== undefined && chartName !== room.chartName);

      const result = roomManager.update(currentSceneId, { name, maxPlayers, password, chartUrl, chartName });
      if (!result.success) {
        return result;
      }

      // 如果谱面发生变化，清除所有玩家的准备状态
      if (isChartChanged) {
        roomManager.clearAllReady(currentSceneId);

        // 获取房间内所有玩家
        const players = sceneManager.getPlayers(currentSceneId);

        // 向每个玩家广播准备状态重置
        players.forEach(player => {
          sceneManager.broadcast(currentSceneId, {
            type: 'room/playerReady',
            data: { userId: player.userId, ready: false }
          });
        });
      }

      const updatedRoom = roomManager.getRoom(currentSceneId)!;
      const playerCount = sceneManager.getPlayers(currentSceneId).length;

      const roomInfo = {
        roomId: currentSceneId,
        name: updatedRoom.name,
        maxPlayers: updatedRoom.maxPlayers,
        hasPassword: !!updatedRoom.password,
        chartUrl: updatedRoom.chartUrl,
        chartName: updatedRoom.chartName,
        status: updatedRoom.status,
        playerCount
      };

      sceneManager.broadcast(currentSceneId, {
        type: 'room/updated',
        data: roomInfo
      });
      sceneManager.broadcastToLobby({ type: 'room/updated', data: roomInfo });
      adminWsManager.broadcastToAllAdmins({ type: 'room/updated', data: roomInfo });

      return { success: true, message: '房间信息已更新' };
    }

    case 'transferOwner': {
      const currentSceneId = sceneManager.getPlayerScene(user.id);

      if (!currentSceneId || currentSceneId === 'lobby') {
        return { success: false, message: ERR_NOT_IN_ROOM };
      }

      const room = roomManager.getRoom(currentSceneId);
      if (!room) {
        return { success: false, message: ERR_ROOM_NOT_FOUND };
      }

      if (room.ownerId !== user.id) {
        return { success: false, message: ERR_NOT_ROOM_OWNER };
      }

      const { userId } = data;
      if (!userId || typeof userId !== 'number') {
        return { success: false, message: '缺少目标玩家ID' };
      }

      // 检查目标玩家是否在房间内
      const players = sceneManager.getPlayers(currentSceneId);
      const targetPlayer = players.find(p => p.userId === userId);

      if (!targetPlayer) {
        return { success: false, message: '目标玩家不在房间内' };
      }

      if (userId === user.id) {
        return { success: false, message: '不能转移给自己' };
      }

      // 转移房主
      roomManager.transferOwner(currentSceneId, userId);
      const playerCount = players.length;

      const roomInfo = {
        roomId: currentSceneId,
        playerCount,
        ownerId: userId
      };

      // 广播给房间内玩家
      sceneManager.broadcast(currentSceneId, {
        type: 'room/updated',
        data: roomInfo
      });

      const transferMsg = { type: 'room/updated', data: { ...roomInfo, roomId: currentSceneId } };
      sceneManager.broadcastToLobby({ type: 'room/updated', data: roomInfo });
      adminWsManager.broadcastToAllAdmins(transferMsg);

      return { success: true, message: '房主已转移' };
    }

    case 'kick': {
      const currentSceneId = sceneManager.getPlayerScene(user.id);

      if (!currentSceneId || currentSceneId === 'lobby') {
        return { success: false, message: ERR_NOT_IN_ROOM };
      }

      const room = roomManager.getRoom(currentSceneId);
      if (!room) {
        return { success: false, message: ERR_ROOM_NOT_FOUND };
      }

      if (room.ownerId !== user.id) {
        return { success: false, message: ERR_NOT_ROOM_OWNER };
      }

      const { userId } = data;
      if (!userId || typeof userId !== 'number') {
        return { success: false, message: '缺少目标玩家ID' };
      }

      if (userId === user.id) {
        return { success: false, message: '不能踢出自己' };
      }

      // 检查目标玩家是否在房间内
      const targetPlayerScene = sceneManager.getPlayerScene(userId);
      if (targetPlayerScene !== currentSceneId) {
        return { success: false, message: '目标玩家不在房间内' };
      }

      // 通知被踢出的玩家
      const targetSession = sessionManager.getSession(userId);
      if (targetSession) {
        targetSession.ws.send(JSON.stringify({
          type: 'room/kicked',
          data: { roomId: currentSceneId }
        }));
      }

      // 移除玩家
      sceneManager.leave(userId);
      roomManager.removePlayer(currentSceneId, userId);

      const remainingPlayers = sceneManager.getPlayers(currentSceneId);

      const kickUpdatedMsg = {
        type: 'room/updated',
        data: { roomId: currentSceneId, playerCount: remainingPlayers.length }
      };
      sceneManager.broadcastToLobby(kickUpdatedMsg);
      adminWsManager.broadcastToAllAdmins(kickUpdatedMsg);

      return { success: true, message: '玩家已被踢出' };
    }

    case 'ready': {
      const currentSceneId = sceneManager.getPlayerScene(user.id);

      if (!currentSceneId || currentSceneId === 'lobby') {
        return { success: false, message: ERR_NOT_IN_ROOM };
      }

      const room = roomManager.getRoom(currentSceneId);
      if (!room) {
        return { success: false, message: ERR_ROOM_NOT_FOUND };
      }

      if (room.status === 'playing') {
        return { success: false, message: ERR_GAME_ALREADY_STARTED };
      }

      const { ready = true } = data;
      const wasReady = roomManager.isReady(currentSceneId, user.id);

      // 状态没变化
      if (wasReady === ready) {
        return { success: true };
      }

      roomManager.setReady(currentSceneId, user.id, ready);

      // 广播准备状态变化
      sceneManager.broadcast(currentSceneId, {
        type: 'room/playerReady',
        data: { userId: user.id, ready }
      });

      // 取消准备时，如果正在倒计时则取消
      if (!ready && roomManager.hasCountdown(currentSceneId)) {
        roomManager.cancelCountdown(currentSceneId);
        sceneManager.broadcast(currentSceneId, {
          type: 'room/countdownCancel',
          data: {}
        });
      }

      // 检查是否所有人都准备了
      if (ready && roomManager.isAllReady(currentSceneId)) {
        // 开始倒计时
        sceneManager.broadcast(currentSceneId, {
          type: 'room/countdown',
          data: { seconds: 5 }
        });

        roomManager.startCountdown(currentSceneId, () => {
          // 倒计时结束，再次检查是否所有人都准备
          if (roomManager.isAllReady(currentSceneId)) {
            roomManager.startGame(currentSceneId);

            sceneManager.broadcast(currentSceneId, {
              type: 'room/gameStart',
              data: {}
            });

            const playingMsg = { type: 'room/updated', data: { roomId: currentSceneId, status: 'playing' } };
            sceneManager.broadcastToLobby(playingMsg);
            adminWsManager.broadcastToAllAdmins(playingMsg);
          }
        });
      }

      return { success: true };
    }

    case 'finish': {
      const currentSceneId = sceneManager.getPlayerScene(user.id);

      if (!currentSceneId || currentSceneId === 'lobby') {
        return { success: false, message: ERR_NOT_IN_ROOM };
      }

      const room = roomManager.getRoom(currentSceneId);
      if (!room) {
        return { success: false, message: ERR_ROOM_NOT_FOUND };
      }

      if (room.status !== 'playing') {
        return { success: false, message: ERR_GAME_NOT_STARTED };
      }

      // 已经发送过结束消息
      if (roomManager.isFinished(currentSceneId, user.id)) {
        return { success: true };
      }

      // 获取分数
      const { score } = data;
      if (score === undefined || typeof score !== 'string') {
        return { success: false, message: '缺少分数信息' };
      }

      roomManager.setFinished(currentSceneId, user.id);
      roomManager.setPlayerScore(currentSceneId, user.id, score);

      // 广播玩家结束
      sceneManager.broadcast(currentSceneId, {
        type: 'room/playerFinish',
        data: { userId: user.id }
      });

      // 检查是否所有人都结束了
      if (roomManager.isAllFinished(currentSceneId)) {
        // 获取房间内所有玩家ID，用于通知准备状态重置
        const scene = sceneManager.getScene(currentSceneId);
        const playerIds = scene ? Array.from(scene.players.keys()) : [];

        // 获取所有玩家分数（在 endGame 之前）
        const scoresMap = roomManager.getAllScores(currentSceneId);
        const scores = playerIds.map(playerId => {
          const player = scene?.players.get(playerId);
          return {
            userId: playerId,
            username: player?.username || '',
            nameColor: player?.nameColor ?? null,
            score: scoresMap?.get(playerId) || '0'
          };
        });

        roomManager.endGame(currentSceneId);

        sceneManager.broadcast(currentSceneId, {
          type: 'room/gameEnd',
          data: { scores }
        });

        // 通知所有玩家准备状态被重置
        playerIds.forEach(playerId => {
          sceneManager.broadcast(currentSceneId, {
            type: 'room/playerReady',
            data: { userId: playerId, ready: false }
          });
        });

        const waitingMsg = { type: 'room/updated', data: { roomId: currentSceneId, status: 'waiting' } };
        sceneManager.broadcastToLobby(waitingMsg);
        adminWsManager.broadcastToAllAdmins(waitingMsg);
      }

      return { success: true };
    }

    default:
      return { success: false, message: ERR_UNKNOWN_ACTION };
  }
}
