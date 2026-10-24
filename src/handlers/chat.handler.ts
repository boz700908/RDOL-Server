import { sceneManager } from '../managers/scene.manager';
import { UserInfo } from '../types';
import { MAX_CHAT_MESSAGE_LENGTH } from '../config/constants';
import { ERR_CHAT_EMPTY, ERR_CHAT_TOO_LONG, ERR_NOT_IN_SCENE, ERR_UNKNOWN_ACTION } from '../utils/errors';

export async function handleChat(action: string, data: any, user: UserInfo): Promise<any> {
  switch (action) {
    case 'send': {
      const { message } = data;

      if (!message || typeof message !== 'string') {
        return { success: false, message: ERR_CHAT_EMPTY };
      }

      if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
        return { success: false, message: ERR_CHAT_TOO_LONG };
      }

      const sceneId = sceneManager.getPlayerScene(user.id);
      if (!sceneId) {
        return { success: false, message: ERR_NOT_IN_SCENE };
      }

      sceneManager.broadcast(sceneId, {
        type: 'chat/message',
        data: {
          userId: user.id,
          username: user.username,
          nameColor: user.nameColor,
          message,
          timestamp: Date.now()
        }
      });

      return { success: true };
    }

    default:
      return { success: false, message: ERR_UNKNOWN_ACTION };
  }
}
