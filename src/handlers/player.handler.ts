import { sceneManager } from '../managers/scene.manager';
import { UserInfo } from '../types';
import { ERR_NOT_IN_SCENE, ERR_EMOTE_EMPTY, ERR_UNKNOWN_ACTION } from '../utils/errors';

export async function handlePlayer(action: string, data: any, user: UserInfo): Promise<any> {
  switch (action) {
    case 'emote': {
      const { emote } = data;
      
      if (!emote || typeof emote !== 'string') {
        return { success: false, message: ERR_EMOTE_EMPTY };
      }

      const sceneId = sceneManager.getPlayerScene(user.id);
      if (!sceneId) {
        return { success: false, message: ERR_NOT_IN_SCENE };
      }

      sceneManager.broadcast(sceneId, {
        type: 'player/emote',
        data: { userId: user.id, emote }
      }, user.id);

      return { success: true };
    }

    default:
      return { success: false, message: ERR_UNKNOWN_ACTION };
  }
}
