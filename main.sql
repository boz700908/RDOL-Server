-- 用户表
CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `avatar` VARCHAR(255) DEFAULT NULL,
  `avatar_frame` VARCHAR(255) DEFAULT NULL COMMENT '头像框',
  `name_color` VARCHAR(32) DEFAULT NULL COMMENT '名字颜色，如 #RRGGBB',
  `qq` VARCHAR(20) DEFAULT NULL COMMENT 'QQ号',
  `role` TINYINT NOT NULL DEFAULT 1 COMMENT '角色：1=普通用户 2=管理员 3=超级管理员',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1:正常 0:禁用',
  `profile_updated_at` DATETIME DEFAULT NULL COMMENT '上次修改资料时间',
  `token` VARCHAR(255) DEFAULT NULL COMMENT '登录 token，新登录覆盖',
  `token_expires_at` DATETIME DEFAULT NULL COMMENT 'token 过期时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 已有 users 表时，增加名字颜色字段（执行一次即可）：
-- ALTER TABLE `users` ADD COLUMN `name_color` VARCHAR(32) DEFAULT NULL COMMENT '名字颜色，如 #RRGGBB' AFTER `avatar_frame`;

-- 邮箱验证码表
CREATE TABLE `email_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(100) NOT NULL,
  `code` VARCHAR(6) NOT NULL,
  `type` TINYINT NOT NULL DEFAULT 1 COMMENT '1:注册 2:重置密码',
  `expires_at` DATETIME NOT NULL,
  `used` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_email_type` (`email`, `type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
