/**
 * SQLite schema 初始化（由原 main.sql 转换而来）
 *
 * 转换要点：
 *  - INT UNSIGNED AUTO_INCREMENT → INTEGER PRIMARY KEY AUTOINCREMENT
 *  - DATETIME DEFAULT CURRENT_TIMESTAMP 保留（SQLite 支持）
 *  - MySQL 的 ON UPDATE CURRENT_TIMESTAMP 无对应，改为触发器
 *  - COMMENT / ENGINE / CHARSET / COLLATE / KEY 索引声明改为独立 CREATE INDEX
 *  - TINYINT → INTEGER（SQLite 无整数宽度概念）
 *
 * 语句全部幂等（IF NOT EXISTS），每次启动执行都不会破坏已有数据。
 */
import { exec } from '../db/sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  username           TEXT    NOT NULL UNIQUE,
  -- 自建部署已移除邮箱验证，email 允许为空（保留字段以兼容客户端字段）
  email              TEXT    DEFAULT NULL,
  password           TEXT    NOT NULL,
  avatar             TEXT    DEFAULT NULL,
  avatar_frame       TEXT    DEFAULT NULL,
  name_color         TEXT    DEFAULT NULL,
  qq                 TEXT    DEFAULT NULL,
  role               INTEGER NOT NULL DEFAULT 1,
  status             INTEGER NOT NULL DEFAULT 1,
  profile_updated_at TEXT    DEFAULT NULL,
  token              TEXT    DEFAULT NULL,
  token_expires_at   TEXT    DEFAULT NULL,
  created_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_token ON users (token);

-- 邮箱仍需唯一（允许 NULL），用于登录时按邮箱查找
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;

-- updated_at 自动维护（对应 MySQL 的 ON UPDATE CURRENT_TIMESTAMP）
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS email_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  code       TEXT    NOT NULL,
  type       INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT    NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_codes_email_type ON email_codes (email, type);

-- 社区谱面库（替代已失效的 cafe.rhythmdoctor.top / orchardb.fly.dev）
-- 字段与原 RhythmCafe LevelDocument 一一对应，客户端无需改动解析逻辑
CREATE TABLE IF NOT EXISTS levels (
  id          TEXT PRIMARY KEY,                  -- 谱面唯一标识
  song        TEXT    NOT NULL DEFAULT '',
  artist      TEXT    DEFAULT NULL,
  authors     TEXT    DEFAULT NULL,               -- JSON 数组字符串
  difficulty  INTEGER NOT NULL DEFAULT 1,         -- 0 Easy / 1 Medium / 2 Hard / 3 Expert
  image       TEXT    DEFAULT NULL,               -- 封面地址
  min_bpm     REAL    NOT NULL DEFAULT 0,
  max_bpm     REAL    NOT NULL DEFAULT 0,
  tags        TEXT    DEFAULT NULL,               -- JSON 数组字符串
  url         TEXT    NOT NULL,                   -- 谱面下载地址（必需）
  url2        TEXT    DEFAULT NULL,               -- 备用下载地址
  description TEXT    DEFAULT NULL,
  approval    INTEGER NOT NULL DEFAULT 1,         -- >=0 才在列表中可见
  source      TEXT    DEFAULT NULL,
  uploader    TEXT    DEFAULT NULL,               -- 发布者用户名
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- url 是发布的幂等键：同一个文件重复发布只更新元数据，不产生重复条目
CREATE UNIQUE INDEX IF NOT EXISTS idx_levels_url ON levels (url);
CREATE INDEX IF NOT EXISTS idx_levels_approval ON levels (approval);
CREATE INDEX IF NOT EXISTS idx_levels_created ON levels (created_at);

CREATE TRIGGER IF NOT EXISTS trg_levels_updated_at
AFTER UPDATE ON levels
FOR EACH ROW
BEGIN
  UPDATE levels SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
`;

/** 建表（幂等），在服务启动最开始调用一次 */
export function initSchema(): void {
  exec(SCHEMA);
  console.log('[db] schema 已就绪（users / levels；邮箱验证已移除）');
}
