-- 用户表
CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `avatar` VARCHAR(255) DEFAULT NULL,
  `avatar_frame` VARCHAR(255) DEFAULT NULL COMMENT '头像框',
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

-- 头像框表
CREATE TABLE `avatar_frames` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `image_url` VARCHAR(255) NOT NULL COMMENT '头像框图片URL',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序，越小越靠前',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户头像框解锁表
CREATE TABLE `user_avatar_frames` (
  `user_id` INT UNSIGNED NOT NULL,
  `avatar_frame_id` INT UNSIGNED NOT NULL,
  `unlocked_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `avatar_frame_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_avatar_frame_id` (`avatar_frame_id`),
  CONSTRAINT `fk_user_avatar_frames_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_avatar_frames_frame` FOREIGN KEY (`avatar_frame_id`) REFERENCES `avatar_frames` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 设备码表（用户最多绑定 2 个设备码，绑定前需已绑定 QQ 且未封禁）
CREATE TABLE `device_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `device_code` CHAR(6) NOT NULL COMMENT '六位数字设备码，游戏客户端生成',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_device` (`user_id`, `device_code`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_device_codes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 封禁的邮箱域名表（该域名下的邮箱无法注册）
CREATE TABLE `banned_email_domains` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `domain` VARCHAR(100) NOT NULL COMMENT '邮箱域名，如 ibymain.com',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_domain` (`domain`),
  KEY `idx_domain` (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
