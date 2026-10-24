// 用户相关
export interface User {
  id: number;
  username: string;
  email: string;
  avatar: string | null;
  avatarFrame: string | null;
  /** 名字颜色，如 #RRGGBB 或颜色名，可为空 */
  nameColor: string | null;
  qq: string | null;
  role: number;
  status: number;
}

// Handler 中使用的用户信息
export interface UserInfo {
  id: number;
  username: string;
  avatar: string | null;
  avatarFrame: string | null;
  nameColor: string | null;
}

// 场景中的玩家（大厅时包含 x, y）
export interface PlayerInScene {
  userId: number;
  username: string;
  avatar: string | null;
  avatarFrame: string | null;
  /** 名字颜色，如 #RRGGBB，可为空 */
  nameColor: string | null;
  /** 大厅内 X 坐标，仅大厅有效 */
  x?: number;
  /** 大厅内 Y 坐标，仅大厅有效 */
  y?: number;
}

// 房间状态
export type RoomStatus = 'waiting' | 'playing';

// 房间
export interface Room {
  id: string;
  name: string;
  maxPlayers: number;
  password: string | null;
  chartUrl: string;
  chartName: string;
  ownerId: number;
  status: RoomStatus;
  createdAt: Date;
}

// 房间列表项（不含密码）
export interface RoomListItem {
  id: string;
  name: string;
  maxPlayers: number;
  hasPassword: boolean;
  chartUrl: string;
  chartName: string;
  ownerId: number;
  status: RoomStatus;
  playerCount: number;
}

// Session 信息
export interface SessionInfo {
  userId: number;
  username: string;
  avatar: string | null;
  avatarFrame: string | null;
  nameColor: string | null;
}
