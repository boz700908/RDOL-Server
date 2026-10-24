export interface User {
  id: number;
  username: string;
  email: string | null;
  password: string;
  avatar: string | null;
  avatar_frame: string | null;
  /** 名字颜色，如 #RRGGBB，数据库字段 name_color */
  name_color: string | null;
  qq: string | null;
  role: number;
  status: number;
  profile_updated_at: Date | null;
  token: string | null;
  token_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

