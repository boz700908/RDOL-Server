# ADOFAIOnline · server

Git 仓库名：**ADOFAIOnline**（单仓多项目）。**本目录为其中的 server 包**，包含 ADOFAI Online 游戏服务端：**Node WebSocket 服务**（大厅/房间/实时玩法）与 **Go HTTP API**（账号、正版验证、资源等），共用同一 MySQL 数据库。

---

## API 文档

| 服务 | Base URL | 文档 | 说明 |
|------|----------|------|------|
| **Node（WebSocket）** | `ws(s)://<your-host>:4005` | [WebScoketAPI.md](./WebScoketAPI.md) | 游戏实时通信：认证、大厅、房间、聊天、心跳等 |
| **Go（HTTP）** | `{API_BASE_URL}` | [ADOFAIOnlineAPI/API.md](./ADOFAIOnlineAPI/API.md) | 账号注册/登录、用户信息、正版验证申请、热更新、文件上传、管理端等 |

---

## 快速运行

**请在 `Server` 目录下执行**（从仓库根目录先 `cd Server`）。

```bash
pnpm install
pnpm run build        # 仅编译 Node
pnpm run start:node   # 仅启动 Node WebSocket（需先 build）
pnpm run start:go     # 仅启动 Go HTTP API
pnpm run start        # 同时启动 Node + Go
```

开发时：`pnpm run dev:node` / `pnpm run dev:go` / `pnpm run dev`（同时）。

更多脚本（单独构建 Go/Node、跨平台构建 Go 等）见 [package.json](./package.json) 的 `scripts`。
