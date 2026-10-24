import { WebSocket } from 'ws';
import { sessionManager } from './session.manager';
import { PlayerInScene } from '../types';
import { ERR_SCENE_NOT_FOUND } from '../utils/errors';
import * as adminWsManager from '../admin-ws.manager';

export interface Scene {
  id: string;
  type: 'lobby' | 'room';
  players: Map<number, PlayerInScene>;
}

class SceneManager {
  private scenes = new Map<string, Scene>();
  private playerScene = new Map<number, string>();

  constructor() {
    this.scenes.set('lobby', {
      id: 'lobby',
      type: 'lobby',
      players: new Map()
    });
  }

  getScene(sceneId: string): Scene | undefined {
    return this.scenes.get(sceneId);
  }

  createRoom(roomId: string): Scene {
    const scene: Scene = {
      id: roomId,
      type: 'room',
      players: new Map()
    };
    this.scenes.set(roomId, scene);
    return scene;
  }

  join(sceneId: string, player: PlayerInScene): { success: boolean; players: PlayerInScene[]; message?: string } {
    const scene = this.scenes.get(sceneId);
    
    if (!scene) {
      return { success: false, players: [], message: ERR_SCENE_NOT_FOUND };
    }

    this.leave(player.userId);

    // 根据场景类型发送不同的事件
    const eventType = scene.type === 'lobby' ? 'lobby/playerJoin' : 'room/playerJoin';
    this.broadcast(sceneId, {
      type: eventType,
      data: { player }
    }, player.userId);

    const otherPlayers = Array.from(scene.players.values());

    scene.players.set(player.userId, player);
    this.playerScene.set(player.userId, sceneId);

    return { success: true, players: otherPlayers };
  }

  leave(userId: number): void {
    const sceneId = this.playerScene.get(userId);
    if (!sceneId) return;

    const scene = this.scenes.get(sceneId);
    if (scene) {
      scene.players.delete(userId);
      
      // 根据场景类型发送不同的事件
      const eventType = scene.type === 'lobby' ? 'lobby/playerLeave' : 'room/playerLeave';
      this.broadcast(sceneId, {
        type: eventType,
        data: { userId }
      }, userId);
    }

    this.playerScene.delete(userId);
  }

  getPlayerScene(userId: number): string | undefined {
    return this.playerScene.get(userId);
  }

  broadcast(sceneId: string, message: any, excludeUserId?: number): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) return;

    const msgStr = JSON.stringify(message);

    for (const [userId] of scene.players) {
      if (excludeUserId && userId === excludeUserId) continue;
      
      const session = sessionManager.getSession(userId);
      if (session && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(msgStr);
      }
    }

    if (sceneId !== 'lobby') {
      adminWsManager.forwardToRoomSubscribers(sceneId, message);
    }
  }

  getPlayers(sceneId: string): PlayerInScene[] {
    const scene = this.scenes.get(sceneId);
    if (!scene) return [];
    return Array.from(scene.players.values());
  }

  destroyScene(sceneId: string): void {
    if (sceneId === 'lobby') return;
    this.scenes.delete(sceneId);
  }

  broadcastToLobby(message: any): void {
    this.broadcast('lobby', message);
  }

  /**
   * 更新大厅内玩家位置并广播 lobby/playerMove
   */
  updateLobbyPosition(userId: number, x: number, y: number): boolean {
    const scene = this.scenes.get('lobby');
    if (!scene) return false;

    const player = scene.players.get(userId);
    if (!player) return false;

    player.x = x;
    player.y = y;

    this.broadcast('lobby', {
      type: 'lobby/playerMove',
      data: { userId, x, y }
    });
    return true;
  }
}

export const sceneManager = new SceneManager();
