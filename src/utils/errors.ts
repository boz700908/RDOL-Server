// 通用错误
export const ERR_UNKNOWN_MODULE = '未知模块';
export const ERR_UNKNOWN_ACTION = '未知操作';
export const ERR_MESSAGE_FORMAT = '消息格式错误';
export const ERR_NOT_LOGGED_IN = '非法连接：未登录';
export const ERR_PLEASE_LOGIN = '请先登录';
export const ERR_SERVER_ERROR = '服务器内部错误';

// 认证错误
export const ERR_USER_NOT_FOUND = '用户不存在';
export const ERR_PASSWORD_WRONG = '密码错误';
export const ERR_ACCOUNT_DISABLED = '账号已被禁用';
export const ERR_ALREADY_LOGGED_IN = '该账号已在其他设备登录';
export const ERR_USERNAME_EXISTS = '用户名已存在';
export const ERR_EMAIL_EXISTS = '邮箱已被注册';
export const ERR_CODE_INVALID = '验证码无效或已过期';
export const ERR_TOKEN_INVALID = 'Token无效或已过期';

// 场景错误
export const ERR_NOT_IN_SCENE = '未在任何场景中';
export const ERR_SCENE_NOT_FOUND = '场景不存在';

// 房间错误
export const ERR_ROOM_NOT_FOUND = '房间不存在';
export const ERR_ROOM_FULL = '房间已满';
export const ERR_ROOM_PASSWORD_WRONG = '密码错误';
export const ERR_ROOM_LIMIT_REACHED = '房间数量已达上限';
export const ERR_NOT_IN_ROOM = '你不在任何房间中';
export const ERR_NOT_ROOM_OWNER = '只有房主可以修改房间信息';
export const ERR_ROOM_NAME_REQUIRED = '房间名称和谱面URL不能为空';
export const ERR_GAME_ALREADY_STARTED = '游戏已经开始';
export const ERR_GAME_NOT_STARTED = '游戏尚未开始';

// 聊天错误
export const ERR_CHAT_EMPTY = '消息内容不能为空';
export const ERR_CHAT_TOO_LONG = '消息内容过长';

// 表情错误
export const ERR_EMOTE_EMPTY = '表情名不能为空';
