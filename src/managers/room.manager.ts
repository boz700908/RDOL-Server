import { sceneManager } from './scene.manager';
import { Room, RoomListItem } from '../types';
import { MAX_ROOMS, MAX_PLAYERS_PER_ROOM } from '../config/constants';
import { ERR_ROOM_LIMIT_REACHED, ERR_ROOM_NOT_FOUND, ERR_ROOM_FULL, ERR_ROOM_PASSWORD_WRONG } from '../utils/errors';

class RoomManager {
  private rooms = new Map<string, Room>();
  private roomIdCounter = 1;
  
  // 玩家准备状态 roomId -> Set<userId>
  private readyPlayers = new Map<string, Set<number>>();
  // 玩家游戏结束状态 roomId -> Set<userId>
  private finishedPlayers = new Map<string, Set<number>>();
  // 玩家分数 roomId -> Map<userId, score>
  private playerScores = new Map<string, Map<number, string>>();
  // 倒计时定时器 roomId -> timer
  private countdownTimers = new Map<string, NodeJS.Timeout>();

  create(ownerId: number, name: string, maxPlayers: number, chartUrl: string, chartName: string, password?: string): { success: boolean; room?: Room; message?: string } {
    if (this.rooms.size >= MAX_ROOMS) {
      return { success: false, message: ERR_ROOM_LIMIT_REACHED };
    }
    if (maxPlayers < 1 || maxPlayers > MAX_PLAYERS_PER_ROOM) {
      return { success: false, message: `房间人数必须在1-${MAX_PLAYERS_PER_ROOM}之间` };
    }

    const roomId = `room_${this.roomIdCounter++}`;
    
    const room: Room = {
      id: roomId,
      name,
      maxPlayers,
      password: password || null,
      chartUrl,
      chartName,
      ownerId,
      status: 'waiting',
      createdAt: new Date()
    };

    this.rooms.set(roomId, room);
    this.readyPlayers.set(roomId, new Set());
    this.finishedPlayers.set(roomId, new Set());
    this.playerScores.set(roomId, new Map());
    sceneManager.createRoom(roomId);

    return { success: true, room };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getList(): RoomListItem[] {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      maxPlayers: room.maxPlayers,
      hasPassword: !!room.password,
      chartUrl: room.chartUrl,
      chartName: room.chartName,
      ownerId: room.ownerId,
      status: room.status,
      playerCount: sceneManager.getPlayers(room.id).length
    }));
  }

  canJoin(roomId: string, password?: string): { success: boolean; message?: string } {
    const room = this.rooms.get(roomId);
    
    if (!room) {
      return { success: false, message: ERR_ROOM_NOT_FOUND };
    }

    const playerCount = sceneManager.getPlayers(roomId).length;
    if (playerCount >= room.maxPlayers) {
      return { success: false, message: ERR_ROOM_FULL };
    }

    if (room.password && room.password !== password) {
      return { success: false, message: ERR_ROOM_PASSWORD_WRONG };
    }

    return { success: true };
  }

  transferOwner(roomId: string, newOwnerId: number): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.ownerId = newOwnerId;
    }
  }

  update(
    roomId: string,
    updates: { name?: string; maxPlayers?: number; password?: string | null; chartUrl?: string; chartName?: string }
  ): { success: boolean; message?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, message: ERR_ROOM_NOT_FOUND };
    }
    if (updates.maxPlayers !== undefined) {
      if (updates.maxPlayers < 1 || updates.maxPlayers > MAX_PLAYERS_PER_ROOM) {
        return { success: false, message: `房间人数必须在1-${MAX_PLAYERS_PER_ROOM}之间` };
      }
      const currentCount = sceneManager.getPlayers(roomId).length;
      if (updates.maxPlayers < currentCount) {
        return { success: false, message: `当前房间有${currentCount}人，无法设置为${updates.maxPlayers}人` };
      }
      room.maxPlayers = updates.maxPlayers;
    }

    if (updates.name !== undefined) room.name = updates.name;
    if (updates.chartUrl !== undefined) room.chartUrl = updates.chartUrl;
    if (updates.chartName !== undefined) room.chartName = updates.chartName;
    if (updates.password !== undefined) room.password = updates.password || null;

    return { success: true };
  }

  destroy(roomId: string): void {
    this.cancelCountdown(roomId);
    this.readyPlayers.delete(roomId);
    this.finishedPlayers.delete(roomId);
    this.playerScores.delete(roomId);
    this.rooms.delete(roomId);
    sceneManager.destroyScene(roomId);
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  // 玩家准备/取消准备
  setReady(roomId: string, userId: number, ready: boolean): void {
    const readySet = this.readyPlayers.get(roomId);
    if (!readySet) return;
    
    if (ready) {
      readySet.add(userId);
    } else {
      readySet.delete(userId);
    }
  }

  isReady(roomId: string, userId: number): boolean {
    return this.readyPlayers.get(roomId)?.has(userId) ?? false;
  }

  getReadyPlayers(roomId: string): number[] {
    return Array.from(this.readyPlayers.get(roomId) ?? []);
  }

  // 检查是否所有玩家都准备了
  isAllReady(roomId: string): boolean {
    const players = sceneManager.getPlayers(roomId);
    const readySet = this.readyPlayers.get(roomId);
    if (!readySet || players.length === 0) return false;
    return players.every(p => readySet.has(p.userId));
  }

  // 清除所有玩家的准备状态
  clearAllReady(roomId: string): void {
    const readySet = this.readyPlayers.get(roomId);
    if (readySet) {
      readySet.clear();
    }
  }

  // 倒计时管理
  startCountdown(roomId: string, onComplete: () => void): void {
    this.cancelCountdown(roomId);
    const timer = setTimeout(onComplete, 5000);
    this.countdownTimers.set(roomId, timer);
  }

  cancelCountdown(roomId: string): void {
    const timer = this.countdownTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.countdownTimers.delete(roomId);
    }
  }

  hasCountdown(roomId: string): boolean {
    return this.countdownTimers.has(roomId);
  }

  // 开始游戏
  startGame(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.status = 'playing';
      this.finishedPlayers.set(roomId, new Set());
    }
  }

  // 玩家游戏结束
  setFinished(roomId: string, userId: number): void {
    this.finishedPlayers.get(roomId)?.add(userId);
  }

  isFinished(roomId: string, userId: number): boolean {
    return this.finishedPlayers.get(roomId)?.has(userId) ?? false;
  }

  // 检查是否所有玩家都结束了
  isAllFinished(roomId: string): boolean {
    const players = sceneManager.getPlayers(roomId);
    const finishedSet = this.finishedPlayers.get(roomId);
    if (!finishedSet || players.length === 0) return false;
    return players.every(p => finishedSet.has(p.userId));
  }

  // 设置玩家分数
  setPlayerScore(roomId: string, userId: number, score: string): void {
    const scoresMap = this.playerScores.get(roomId);
    if (scoresMap) {
      scoresMap.set(userId, score);
    }
  }

  // 获取所有玩家分数
  getAllScores(roomId: string): Map<number, string> | undefined {
    return this.playerScores.get(roomId);
  }

  // 结束游戏，重置状态
  endGame(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.status = 'waiting';
    }
    this.readyPlayers.set(roomId, new Set());
    this.finishedPlayers.set(roomId, new Set());
    this.playerScores.set(roomId, new Map());
  }

  // 玩家离开房间时清理其准备/结束状态
  removePlayer(roomId: string, userId: number): void {
    this.readyPlayers.get(roomId)?.delete(userId);
    this.finishedPlayers.get(roomId)?.delete(userId);
    this.playerScores.get(roomId)?.delete(userId);
  }
}

export const roomManager = new RoomManager();
