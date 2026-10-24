import { sceneManager } from '../managers/scene.manager';
import { UserInfo, PlayerInScene } from '../types';
import { ERR_UNKNOWN_ACTION } from '../utils/errors';

export async function handleLobby(action: string, data: any, user: UserInfo): Promise<any> {
  switch (action) {
    case 'join': {
      const player: PlayerInScene = {
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        avatarFrame: user.avatarFrame,
        nameColor: user.nameColor,
        x: 0,
        y: 0
      };

      const result = sceneManager.join('lobby', player);

      if (!result.success) {
        return { success: false, message: result.message };
      }

      return {
        success: true,
        message: '已进入大厅',
        data: {
          players: result.players
        }
      };
    }

    case 'leave': {
      sceneManager.leave(user.id);
      return { success: true, message: '已离开大厅' };
    }

    case 'players': {
      const players = sceneManager.getPlayers('lobby');
      return { success: true, data: { players } };
    }

    case 'move': {
      const { x, y } = data ?? {};
      if (typeof x !== 'number' || typeof y !== 'number') {
        return { success: false, message: '缺少 x 或 y 坐标' };
      }
      const ok = sceneManager.updateLobbyPosition(user.id, x, y);
      if (!ok) {
        return { success: false, message: '未在大厅或更新失败' };
      }
      return { success: true };
    }

    default:
      return { success: false, message: ERR_UNKNOWN_ACTION };
  }
}
