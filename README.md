# RDOL 后端（RhythmDoctorOnline 自托管服务）

Rhythm Doctor 联机 mod **RDOL** 的完整服务端替代实现，用来接替已经停止维护的官方后端。

由原 ADOFAIOnline 的 server 包移植改造而来，已彻底去掉 MySQL、Go HTTP 服务、邮箱验证与 123 云盘依赖。

---

## 两个服务

| 服务 | 端口 | 入口 | 职责 |
|------|------|------|------|
| WebSocket 联机服务 | 3005 | `src/index.ts` → `dist/index.js` | 登录/注册、大厅、房间、聊天、准备与开局、心跳 |
| HTTP API | 3004 | `src/api-server.ts` → `dist/api-server.js` | 谱面列表、谱面上传/下载、元数据发布、版本检查 |

两个进程都是独立 Node 进程，共用同一个 SQLite 文件。

---

## HTTP 接口

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/health` | 健康检查，返回端口、谱面数与上游地址 |
| GET | `/checkupdate?platform=win` | 替代已停摆的原版版本检查服务器 |
| GET | `/api/get_chartlist.php?q=&page=&per_page=` | 社区谱面列表，对客户端保持 Typesense 外形 |
| GET | `/api/levels/:id/download` | 反代上游谱面下载，透传 Range/206 |
| POST | `/charts/upload?name=x.rdzip` | 上传 `.rdzip` 原始字节 |
| GET | `/charts/<file>` | 下载已上传谱面 |
| POST | `/charts/publish` | 发布/更新谱面元数据（按 url 幂等） |

### 社区谱面列表

官方上游 `https://rhythm.cafe` 是活的（约 5320 条谱面），死掉的只是两个代理镜像
（`cafe.rhythmdoctor.top`、`orchardb.fly.dev`）。本服务对上游做**实时代理**，并把本地发布的
谱面合并进结果，对客户端仍返回 Typesense 形状：

```json
{ "found": 5320, "page": 1, "out_of": 5320, "hits": [ { "document": { ... } } ] }
```

- 本地条目整体置顶，后面接上游，按**连续全局偏移**分页。
- 下载地址双轨：`url2` 是 CDN 直链（`c2.rhythm.cafe`），`url` 是本机反代兜底
  （服务器出口只有约 1 Mbps，大包优先走 CDN）。
- 必须走 IPv4：`dns.setDefaultResultOrder('ipv4first')`。

### 谱面上传与发布

上传只发原始字节，响应返回服务端实际落盘的文件名：

```json
{ "success": true, "name": "20261023235323_fbc8ce_chart_xxx.rdzip", "size": 2319, "url": "..." }
```

客户端随后用这个 `name` POST 到 `/charts/publish` 登记元数据（`song`/`artist`/`authors`/
`difficulty`/`minBpm`/`maxBpm`/`tags`）。以 `url` 为幂等键 upsert，重复发布不会产生重复条目。
`difficulty` 是 **0–3 的整数**，不是 BPM。

---

## 数据与存储

- **SQLite 单文件**（`node:sqlite`），默认 `./data/rdonline.db`，无需账号密码。
  - 因为 `RETURNING` 等语句必须走 `all()`，见 `src/db/sqlite.ts`。
- 谱面包落盘在 `./charts`。
- `data/` 与 `charts/` 都是运行时数据，**不进版本库**。

表结构（`src/db/schema.ts`，启动时幂等建表）：

- `users` — 账号；`email` 允许为空（邮箱验证已移除，字段保留以兼容客户端）。
- `levels` — 本地发布的谱面元数据。

---

## 运行

```bash
pnpm install
pnpm build          # tsc 编译到 dist/
pnpm start          # 启动 WebSocket 服务（3005）
pnpm start:api      # 启动 HTTP API（3004）
```

生产环境用 systemd 各起一个单元，注意 `EnvironmentFile` 指向 `.env`。

---

## 环境变量

见 [.env.example](./.env.example)。要点：

- `SERVER_PORT`（3005）、`API_PORT`（3004）
- `DB_FILE` — SQLite 文件路径
- `CHART_DIR` — `.rdzip` 落盘目录
- `CHART_BASE_URL` — 对外可访问的基础地址，用于拼下载直链
- `MAX_UPLOAD_MB` — 上传上限，默认 64
- `REQUIRE_QQ_BIND` — 登录是否强制绑定 QQ，默认关闭

---

## 与客户端配套

RDOL 客户端的 `rdol.config.json` 决定它连哪个服务；默认地址已指向本服务所在主机。
客户端侧的谱面来源分三个独立标签页：社区谱面库、官方关卡、玩家关卡库。
官方关卡只传关卡标识（`internal://<LevelName>`），各端本地加载音频，因此不受版本差异影响。
