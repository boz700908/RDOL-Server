# ADOFAIOnline 游戏服务端 WebSocket API 文档（Node 模块）

本文档描述 **Node 模块**提供的 WebSocket 接口，端口与常量以 `src/config/constants.ts` 为准。

## 连接信息

- 协议：WebSocket
- 地址：`ws(s)://<your-host>:3005`（默认端口 3005，见 `SERVER_PORT`）

---

## 消息格式

### 请求格式

```json
{
  "type": "模块/操作",
  "data": { ... },
  "requestId": "可选，用于匹配响应"
}
```

### 响应格式

```json
{
  "type": "模块/操作",
  "success": true,
  "message": "提示信息",
  "data": { ... },
  "requestId": "与请求对应"
}
```

### 服务端推送格式

```json
{
  "type": "事件类型",
  "data": { ... }
}
```

---

## 连接流程

1. 建立 WebSocket 连接
2. 收到 `{"type": "connected", "message": "连接成功"}`
3. 调用登录接口
4. 登录成功后可调用其他接口

**注意：** 未登录状态下调用非公开接口，服务端会返回错误并可能断开连接。

**公开接口（无需登录）：** `auth/sendCode`、`auth/login`、`ping`。

---

## 认证机制说明

本服务采用 **WebSocket 会话认证**，而非每次请求都带 Token。

### 工作原理

1. 客户端调用 `auth/login` 登录成功后，服务端会将该 WebSocket 连接与用户绑定
2. **后续所有请求不需要携带 Token**，服务端通过连接自动识别用户身份
3. 连接断开后，会话失效

### Token 的用途

登录成功返回的 `token` 用于以下场景：

1. **断线重连**：客户端本地保存 token，重新连接后可调用 `auth/verify` 验证身份（注意：verify 只验证 token 有效性，不会自动登录，仍需调用 login）
2. **HTTP 接口**：如果后续有 REST API，可用 token 做身份验证
3. **登出**：调用 `auth/logout` 时传入 token，清除服务端的 token 记录

### 示例流程

```
[首次登录]
客户端 → auth/login → 服务端返回 token → 客户端保存 token
后续请求直接发送，无需带 token

[断线重连]
客户端重新连接 → auth/login（用账号密码重新登录）
或
客户端重新连接 → auth/verify（验证本地 token 是否有效）→ auth/login
```

---

## 认证模块 (auth)

### 发送验证码

用于注册或重置密码前获取邮箱验证码。

**请求：**
```json
{
  "type": "auth/sendCode",
  "data": {
    "email": "user@example.com",
    "type": 1
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址 |
| type | number | 否 | 1=注册（默认），2=重置密码 |

**响应：**
```json
{
  "type": "auth/sendCode",
  "success": true,
  "message": "验证码已发送"
}
```

---

### 注册

**本 WebSocket 服务不提供注册接口。** 注册请使用 HTTP API（见 `ADOFAIOnlineAPI/API.md` 的 `POST /auth/register`、`POST /auth/send-code` 等）。

---

### 登录

支持用户名或邮箱登录。实现单点登录，同一账号只能在一个客户端登录。

**请求：**
```json
{
  "type": "auth/login",
  "data": {
    "account": "player1",
    "password": "123456"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| account | string | 是 | 用户名或邮箱 |
| password | string | 是 | 密码 |

**响应：**
```json
{
  "type": "auth/login",
  "success": true,
  "message": "登录成功",
  "data": {
    "token": "abc123...",
    "user": {
      "id": 1,
      "username": "player1",
      "email": "user@example.com",
      "avatar": null,
      "avatarFrame": null,
      "nameColor": null,
      "role": 1,
      "qq": "123456789"
    }
  }
}
```

**错误情况：**
- 用户不存在
- 密码错误
- 账号已被禁用
- 未绑定QQ,请在群内通过机器人命令绑定QQ
- 该账号已在其他设备登录（单点登录）

---

### 登出

**请求：**
```json
{
  "type": "auth/logout",
  "data": {
    "token": "abc123..."
  }
}
```

**响应：**
```json
{
  "type": "auth/logout",
  "success": true,
  "message": "已登出"
}
```

---

### 验证Token

用于客户端重连时验证已保存的 Token 是否有效。

**请求：**
```json
{
  "type": "auth/verify",
  "data": {
    "token": "abc123..."
  }
}
```

**响应（成功）：**
```json
{
  "type": "auth/verify",
  "success": true,
  "data": {
    "id": 1,
    "username": "player1",
    "email": "user@example.com",
    "avatar": null,
    "avatarFrame": null,
    "nameColor": null,
    "role": 1,
    "qq": "123456789"
  }
}
```

**响应（失败）：**
```json
{
  "type": "auth/verify",
  "success": false,
  "message": "Token无效或已过期"
}
```

---

### 获取在线用户

**请求：**
```json
{
  "type": "auth/online",
  "data": {}
}
```

**响应：**
```json
{
  "type": "auth/online",
  "success": true,
  "data": {
    "count": 5,
    "users": [
      { "userId": 1, "username": "player1", "nameColor": null },
      { "userId": 2, "username": "player2", "nameColor": "#FF0000" }
    ]
  }
}
```

---

## 大厅模块 (lobby)

**注意：** 以下接口需要登录后才能调用。

### 进入大厅

**请求：**
```json
{
  "type": "lobby/join",
  "data": {}
}
```

**响应：**
```json
{
  "type": "lobby/join",
  "success": true,
  "message": "已进入大厅",
  "data": {
    "players": [
      {
        "userId": 2,
        "username": "player2",
        "avatar": null,
        "avatarFrame": null,
        "nameColor": null,
        "x": 0,
        "y": 0
      }
    ]
  }
}
```

**同时，大厅内其他玩家会收到推送：**
```json
{
  "type": "lobby/playerJoin",
  "data": {
    "player": {
      "userId": 1,
      "username": "player1",
      "avatar": null,
      "avatarFrame": null,
      "nameColor": null,
      "x": 0,
      "y": 0
    }
  }
}
```

---

### 离开大厅

**请求：**
```json
{
  "type": "lobby/leave",
  "data": {}
}
```

**响应：**
```json
{
  "type": "lobby/leave",
  "success": true,
  "message": "已离开大厅"
}
```

**同时，大厅内其他玩家会收到推送：**
```json
{
  "type": "lobby/playerLeave",
  "data": {
    "userId": 1
  }
}
```

---

### 获取大厅玩家列表

**请求：**
```json
{
  "type": "lobby/players",
  "data": {}
}
```

**响应：**
```json
{
  "type": "lobby/players",
  "success": true,
  "data": {
    "players": [
      {
        "userId": 1,
        "username": "player1",
        "avatar": null,
        "avatarFrame": null,
        "nameColor": null,
        "x": 0,
        "y": 0
      }
    ]
  }
}
```

---

### 大厅内移动

用于同步玩家在大厅内的坐标（如 2D 大厅场景）。

**请求：**
```json
{
  "type": "lobby/move",
  "data": {
    "x": 100,
    "y": 200
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| x | number | 是 | X 坐标 |
| y | number | 是 | Y 坐标 |

**响应：**
```json
{
  "type": "lobby/move",
  "success": true
}
```

**错误情况：** 缺少 x 或 y、未在大厅或更新失败

**同时，大厅内其他玩家会收到推送：**
```json
{
  "type": "lobby/playerMove",
  "data": {
    "userId": 1,
    "x": 100,
    "y": 200
  }
}
```

---

## 玩家模块 (player)

**注意：** 以下接口需要登录后才能调用。

### 播放表情

**请求：**
```json
{
  "type": "player/emote",
  "data": {
    "emote": "wave"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| emote | string | 是 | 表情名称 |

**响应：**
```json
{
  "type": "player/emote",
  "success": true
}
```

**同时，场景内其他玩家会收到推送：**
```json
{
  "type": "player/emote",
  "data": {
    "userId": 1,
    "emote": "wave"
  }
}
```

---

## 聊天模块 (chat)

**注意：** 以下接口需要登录后才能调用。

### 发送消息

发送聊天消息，广播给同场景（大厅或房间）的所有玩家。

**请求：**
```json
{
  "type": "chat/send",
  "data": {
    "message": "大家好！"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 消息内容，最长 500 字符（见 `MAX_CHAT_MESSAGE_LENGTH`） |

**响应：**
```json
{
  "type": "chat/send",
  "success": true
}
```

**同时，场景内所有玩家（包括自己）会收到推送：**
```json
{
  "type": "chat/message",
  "data": {
    "userId": 1,
    "username": "player1",
    "nameColor": null,
    "message": "大家好！",
    "timestamp": 1736755200000
  }
}
```

---

## 房间模块 (room)

**注意：** 以下接口需要登录后才能调用。

### 限制说明

- 最多同时存在 16 个房间
- 每个房间最多 8 人
- 房主离开时自动转移给下一个玩家
- 房间空了自动销毁

### 创建房间

**请求:**
```json
{
  "type": "room/create",
  "data": {
    "name": "新手房间",
    "maxPlayers": 4,
    "password": "123456",
    "chartUrl": "https://example.com/chart.json",
    "chartName": "示例谱面"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 房间名称 |
| maxPlayers | number | 否 | 最大人数，1-8，默认8 |
| password | string | 否 | 房间密码，为空则无密码 |
| chartUrl | string | 是 | 谱面URL |
| chartName | string | 是 | 谱面名称 |

**响应：**
```json
{
  "type": "room/create",
  "success": true,
  "message": "房间创建成功",
  "data": {
    "roomId": "room_1"
  }
}
```

**同时，大厅玩家会收到推送：**
```json
{
  "type": "room/created",
  "data": {
    "room": {
      "id": "room_1",
      "name": "新手房间",
      "maxPlayers": 4,
      "hasPassword": true,
      "chartUrl": "https://example.com/chart.json",
      "chartName": "示例谱面",
      "ownerId": 1,
      "status": "waiting",
      "playerCount": 0
    }
  }
}
```

---

### 获取房间列表

**请求：**
```json
{
  "type": "room/list",
  "data": {}
}
```

**响应：**
```json
{
  "type": "room/list",
  "success": true,
  "data": {
    "rooms": [
      {
        "id": "room_1",
        "name": "新手房间",
        "maxPlayers": 4,
        "hasPassword": true,
        "chartUrl": "https://example.com/chart.json",
        "chartName": "示例谱面",
        "ownerId": 1,
        "status": "waiting",
        "playerCount": 2
      }
    ]
  }
}
```

---

### 验证房间密码

验证房间密码是否正确，用于加入房间前的密码校验。

**请求：**
```json
{
  "type": "room/verifyPassword",
  "data": {
    "roomId": "room_1",
    "password": "123456"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| roomId | string | 是 | 房间ID |
| password | string | 是 | 要验证的密码 |

**响应（正确）：**
```json
{
  "type": "room/verifyPassword",
  "success": true
}
```

**响应（错误）：**
```json
{
  "type": "room/verifyPassword",
  "success": false,
  "message": "密码错误"
}
```

**响应（房间无密码）：**
```json
{
  "type": "room/verifyPassword",
  "success": true,
  "message": "该房间无密码"
}
```

---

### 加入房间

**请求：**
```json
{
  "type": "room/join",
  "data": {
    "roomId": "room_1",
    "password": "123456"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| roomId | string | 是 | 房间ID |
| password | string | 否 | 房间密码（如果房间有密码） |

**响应：**
```json
{
  "type": "room/join",
  "success": true,
  "message": "已加入房间 新手房间",
  "data": {
    "room": {
      "id": "room_1",
      "name": "新手房间",
      "maxPlayers": 4,
      "hasPassword": true,
      "chartUrl": "https://example.com/chart.json",
      "chartName": "示例谱面",
      "ownerId": 1,
      "status": "waiting",
      "playerCount": 1
    },
    "players": [
      {
        "userId": 1,
        "username": "player1",
        "avatar": null,
        "avatarFrame": null,
        "nameColor": null,
        "ready": false
      }
    ]
  }
}
```

**错误情况：**
- 房间不存在
- 房间已满
- 密码错误（`ERR_ROOM_PASSWORD_WRONG`）

---

### 离开房间

离开当前房间。

**请求：**
```json
{
  "type": "room/leave",
  "data": {}
}
```

**响应：**
```json
{
  "type": "room/leave",
  "success": true,
  "message": "已离开房间"
}
```

**注意：**
- 离开房间后玩家不在任何场景中，需要客户端自行调用 `lobby/join` 进入大厅
- 如果离开的是房主，房主会自动转移给房间内第一个玩家
- 如果房间空了，房间会自动销毁

**房主离开时，房间内其他玩家会收到推送：**
```json
{
  "type": "room/updated",
  "data": {
    "roomId": "room_1",
    "playerCount": 2,
    "ownerId": 3
  }
}
```

**同时大厅玩家也会收到相同的 `room/updated` 推送。**

---

### 获取房间详情

**请求：**
```json
{
  "type": "room/info",
  "data": {
    "roomId": "room_1"
  }
}
```

**响应：**
```json
{
  "type": "room/info",
  "success": true,
  "data": {
    "room": {
      "id": "room_1",
      "name": "新手房间",
      "maxPlayers": 4,
      "hasPassword": true,
      "chartUrl": "https://example.com/chart.json",
      "chartName": "示例谱面",
      "ownerId": 1,
      "status": "waiting",
      "playerCount": 2
    },
    "players": [
      {
        "userId": 1,
        "username": "player1",
        "avatar": null,
        "avatarFrame": null,
        "nameColor": null
      }
    ]
  }
}
```

---

### 更新房间信息

只有房主可以修改房间信息。

**请求：**
```json
{
  "type": "room/update",
  "data": {
    "name": "新房间名",
    "maxPlayers": 6,
    "password": "newpass",
    "chartUrl": "https://example.com/new-chart.json",
    "chartName": "新谱面名称"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 否 | 新房间名称 |
| maxPlayers | number | 否 | 新最大人数（1-8，不能小于当前人数） |
| password | string | 否 | 新密码，传空字符串取消密码 |
| chartUrl | string | 否 | 新谱面URL |
| chartName | string | 否 | 新谱面名称 |

**响应：**
```json
{
  "type": "room/update",
  "success": true,
  "message": "房间信息已更新"
}
```

**错误情况：**
- 你不在任何房间中
- 只有房主可以修改房间信息
- 当前房间有N人，无法设置为M人

**同时，房间内玩家和大厅玩家会收到推送：**
```json
{
  "type": "room/updated",
  "data": {
    "roomId": "room_1",
    "name": "新房间名",
    "maxPlayers": 6,
    "hasPassword": true,
    "chartUrl": "https://example.com/new-chart.json",
    "chartName": "新谱面名称",
    "status": "waiting",
    "playerCount": 2
  }
}
```

---

### 转移房主

只有当前房主可以将房主权限转移给房间内的其他玩家。

**请求：**
```json
{
  "type": "room/transferOwner",
  "data": {
    "userId": 2
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | number | 是 | 目标玩家的用户ID |

**响应：**
```json
{
  "type": "room/transferOwner",
  "success": true,
  "message": "房主已转移"
}
```

**错误情况：**
- 你不在任何房间中
- 只有房主可以转移房主权限
- 缺少目标玩家ID
- 目标玩家不在房间内
- 不能转移给自己

**同时，房间内玩家和大厅玩家会收到推送：**
```json
{
  "type": "room/updated",
  "data": {
    "roomId": "room_1",
    "playerCount": 3,
    "ownerId": 2
  }
}
```

---

### 踢出玩家

只有房主可以踢出房间内的其他玩家。

**请求：**
```json
{
  "type": "room/kick",
  "data": {
    "userId": 3
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | number | 是 | 要踢出的玩家ID |

**响应：**
```json
{
  "type": "room/kick",
  "success": true,
  "message": "玩家已被踢出"
}
```

**错误情况：**
- 你不在任何房间中
- 只有房主可以踢出玩家
- 缺少目标玩家ID
- 目标玩家不在房间内
- 不能踢出自己

**被踢出的玩家会收到：**
```json
{
  "type": "room/kicked",
  "data": {
    "roomId": "room_1"
  }
}
```

**同时，大厅玩家会收到房间人数更新：**
```json
{
  "type": "room/updated",
  "data": {
    "roomId": "room_1",
    "playerCount": 2
  }
}
```

---

### 准备/取消准备

房间内玩家可以准备或取消准备。所有玩家都准备后会开始5秒倒计时，倒计时结束后开始游戏。

**请求：**
```json
{
  "type": "room/ready",
  "data": {
    "ready": true
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ready | boolean | 否 | 是否准备，默认true |

**响应：**
```json
{
  "type": "room/ready",
  "success": true
}
```

**错误情况：**
- 你不在任何房间中
- 游戏已经开始

**房间内所有玩家会收到推送：**
```json
{
  "type": "room/playerReady",
  "data": {
    "userId": 1,
    "ready": true
  }
}
```

**所有玩家都准备后，房间内玩家会收到倒计时推送：**
```json
{
  "type": "room/countdown",
  "data": {
    "seconds": 5
  }
}
```

**倒计时期间有人取消准备，房间内玩家会收到：**
```json
{
  "type": "room/countdownCancel",
  "data": {}
}
```

**倒计时结束，游戏开始，房间内玩家会收到：**
```json
{
  "type": "room/gameStart",
  "data": {}
}
```

---

### 游戏结束

玩家完成游戏后发送此消息，需要包含游戏分数。所有玩家都发送后，房间恢复等待状态。

**请求：**
```json
{
  "type": "room/finish",
  "data": {
    "score": "95.5"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| score | string | 是 | 玩家的游戏分数（字符串格式） |

**响应：**
```json
{
  "type": "room/finish",
  "success": true
}
```

**错误情况：**
- 你不在任何房间中
- 游戏尚未开始
- 缺少分数信息

**说明：** 若已发送过 `room/finish`，再次发送会视为幂等，返回 `success: true`，不再重复广播。

**房间内所有玩家会收到推送：**
```json
{
  "type": "room/playerFinish",
  "data": {
    "userId": 1
  }
}
```

**所有玩家都结束后，房间内玩家会依次收到：**

1. 游戏结束事件（包含所有玩家分数）：
```json
{
  "type": "room/gameEnd",
  "data": {
    "scores": [
      {
        "userId": 1,
        "username": "player1",
        "nameColor": null,
        "score": "95.5"
      },
      {
        "userId": 2,
        "username": "player2",
        "nameColor": "#00FF00",
        "score": "88.2"
      }
    ]
  }
}
```

2. 每个玩家的准备状态重置通知（每个玩家一条）：
```json
{
  "type": "room/playerReady",
  "data": {
    "userId": 1,
    "ready": false
  }
}
```

游戏结束后，房间状态恢复为 `waiting`，所有玩家的准备状态重置为未准备，并通知客户端。

**说明：** 若因玩家断线导致“所有剩余玩家都已结束”，服务端也会广播 `room/gameEnd`，此时 `data.scores` 可能为空或仅包含部分玩家，并会广播 `room/updated`（status: waiting）给大厅。

---

## 心跳检测

不需要登录。**客户端应定期发送 `ping`**，否则服务端在超过一定时间（默认约 20 秒，见 `heartbeatTimeout`）未收到心跳会主动断开连接并清理会话/房间。

**请求：**
```json
{
  "type": "ping"
}
```

**响应：**
```json
{
  "type": "pong",
  "timestamp": 1736755200000
}
```

---

## 服务端推送事件汇总

| 事件类型 | 触发时机 | 接收者 | 数据 |
|----------|----------|--------|------|
| `connected` | 连接成功 | 当前连接 | `{ message: "连接成功" }` |
| `pong` | 收到 ping | 当前连接 | `{ timestamp }` |
| `lobby/playerJoin` | 有玩家进入大厅 | 大厅玩家 | `{ player: PlayerInfo }`（含 x, y） |
| `lobby/playerLeave` | 有玩家离开大厅 | 大厅玩家 | `{ userId: number }` |
| `lobby/playerMove` | 大厅内玩家移动 | 大厅玩家 | `{ userId, x, y }` |
| `room/playerJoin` | 有玩家进入房间 | 房间内玩家 | `{ player: PlayerInfo }` |
| `room/playerLeave` | 有玩家离开房间 | 房间内玩家 | `{ userId: number }` |
| `room/kicked` | 玩家被踢出房间 | 被踢出的玩家 | `{ roomId }` |
| `player/emote` | 有玩家播放表情 | 同场景玩家 | `{ userId, emote }` |
| `chat/message` | 有玩家发送聊天消息 | 同场景玩家 | `{ userId, username, nameColor, message, timestamp }` |
| `room/created` | 有新房间创建 | 大厅玩家 | `{ room: RoomInfo }` |
| `room/updated` | 房间信息变化 | 大厅玩家 + 房间内玩家 | `{ roomId, name?, maxPlayers?, hasPassword?, chartUrl?, status?, playerCount? }` |
| `room/destroyed` | 房间销毁 | 大厅玩家 | `{ roomId }` |
| `room/playerReady` | 玩家准备状态变化 | 房间内玩家 | `{ userId, ready }` |
| `room/countdown` | 开始倒计时 | 房间内玩家 | `{ seconds: 5 }` |
| `room/countdownCancel` | 倒计时取消 | 房间内玩家 | `{}` |
| `room/gameStart` | 游戏开始 | 房间内玩家 | `{}` |
| `room/playerFinish` | 玩家游戏结束 | 房间内玩家 | `{ userId }` |
| `room/gameEnd` | 所有玩家结束，游戏结束 | 房间内玩家 | `{ scores: [{ userId, username, nameColor, score }] }` |

### room/updated 事件说明

此事件在以下情况触发：
- 玩家加入房间（playerCount 变化）
- 玩家离开房间（playerCount 变化）
- 房主离开，房主转移（ownerId 变化）

**重要：** 此事件会同时推送给大厅玩家和房间内玩家，确保所有相关客户端都能及时更新房间信息。

---

## 数据结构

### User

```typescript
{
  id: number;              // 用户ID
  username: string;        // 用户名
  email: string;          // 邮箱
  avatar: string | null;  // 头像URL
  avatarFrame: string | null;  // 头像框
  nameColor: string | null;    // 名字颜色，如 #RRGGBB
  qq: string | null;      // QQ号
  role: number;           // 角色：1=普通用户 2=管理员 3=超级管理员
}
```

### PlayerInfo（场景中的玩家）

```typescript
{
  userId: number;
  username: string;
  avatar: string | null;
  avatarFrame: string | null;
  nameColor: string | null;  // 名字颜色，如 #RRGGBB
  x?: number;   // 仅大厅有效，X 坐标
  y?: number;   // 仅大厅有效，Y 坐标
  ready?: boolean;  // 仅房间内有效，是否准备
}
```

### RoomInfo（房间信息）

```typescript
{
  id: string;              // 房间ID
  name: string;            // 房间名称
  maxPlayers: number;      // 最大人数
  hasPassword: boolean;    // 是否有密码
  chartUrl: string;        // 谱面URL
  chartName: string;       // 谱面名称
  ownerId: number;         // 房主ID
  status: 'waiting' | 'playing';  // 房间状态（waiting=等待中, playing=游戏中）
  playerCount: number;     // 当前人数
}
```

---

## 错误处理

所有错误响应格式：

```json
{
  "type": "请求的type",
  "success": false,
  "message": "错误描述"
}
```

### 常见错误

| 错误信息 | 说明 |
|----------|------|
| 消息格式错误 | 请求体 JSON 解析失败 |
| 非法连接：未登录 | 未登录状态调用需要登录的接口，连接会被断开 |
| 请先登录 | 需要登录的接口未携带有效会话 |
| 未知模块 / 未知操作 | type 格式错误或模块/动作不存在 |
| 该账号已在其他设备登录 | 单点登录限制 |
| 场景不存在 | 尝试加入不存在的大厅/房间（如大厅不存在） |
| 房间数量已达上限 | 最多 16 个房间（`MAX_ROOMS`） |
| 房间已满 | 房间人数已达上限（每房间最多 8 人） |
| 密码错误 | 加入有密码房间时密码不正确 |
| 房间名称和谱面URL不能为空 | 创建房间时缺少 name/chartUrl/chartName |
| 你不在任何房间中 | 当前不在房间时调用 room/leave、room/update 等 |
| 只有房主可以修改房间信息 | 非房主调用 room/update、room/transferOwner、room/kick |
| 游戏已经开始 | 游戏中无法准备/取消准备 |
| 游戏尚未开始 | 游戏未开始时无法发送 room/finish |
| 缺少分数信息 | room/finish 未传 score 或 score 非字符串 |
| 未在任何场景中 | 不在大厅也不在房间时调用 player/emote、chat/send |
| 表情名不能为空 | player/emote 未传 emote 或为空 |
| 消息内容不能为空 | chat/send 未传 message 或为空 |
| 消息内容过长 | 聊天消息超过 500 字符 |
| 缺少 x 或 y 坐标 | lobby/move 未传有效数字 x、y |

---

## Unity 客户端示例代码

```csharp
using UnityEngine;
using WebSocketSharp;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class NetworkManager : MonoBehaviour
{
    private WebSocket ws;
    private string token;

    void Start()
    {
        ws = new WebSocket("ws(s)://<your-host>:3005");
        
        ws.OnOpen += (sender, e) => {
            Debug.Log("连接成功");
        };
        
        ws.OnMessage += (sender, e) => {
            var msg = JObject.Parse(e.Data);
            HandleMessage(msg);
        };
        
        ws.OnClose += (sender, e) => {
            Debug.Log("连接断开");
        };
        
        ws.Connect();
    }

    void HandleMessage(JObject msg)
    {
        string type = msg["type"].ToString();
        
        switch (type)
        {
            case "auth/login":
                if (msg["success"].ToObject<bool>())
                {
                    token = msg["data"]["token"].ToString();
                    // 登录成功，进入大厅
                    JoinLobby();
                }
                break;
                
            case "lobby/playerJoin":
                // 有新玩家进入大厅
                var player = msg["data"]["player"];
                SpawnPlayer(player);
                break;
        }
    }

    public void Login(string account, string password)
    {
        Send("auth/login", new { account, password });
    }

    public void JoinLobby()
    {
        Send("lobby/join", new { });
    }

    void Send(string type, object data)
    {
        var msg = new { type, data };
        ws.Send(JsonConvert.SerializeObject(msg));
    }

    void OnDestroy()
    {
        ws?.Close();
    }
}
```

---

## 版本与配置

- 文档版本：2.1（与 Node 模块实现对齐）
- 默认端口：3005（`src/config/constants.ts` 中的 `SERVER_PORT`）；HTTP API 在 3004（`src/api-server.ts` 的 `API_PORT`，可用环境变量 `API_PORT` 覆盖）
- 心跳超时：约 20 秒未收到 ping 会断开（`heartbeatTimeout`）
- 房间上限：16 个（`MAX_ROOMS`），每房间最多 8 人（`MAX_PLAYERS_PER_ROOM`）
- 聊天长度：500 字符（`MAX_CHAT_MESSAGE_LENGTH`）
- 最后更新：2026-02-18
