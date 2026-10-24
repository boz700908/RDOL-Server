# RDOL 后端（RhythmDoctorOnline 自托管服务）

Rhythm Doctor 联机 mod **RDOL** 的完整服务端替代实现，用来接替已经停止维护的官方后端。
由原 ADOFAIOnline 的 server 包移植改造而来，已彻底去掉 MySQL、Go HTTP 服务、邮箱验证与 123 云盘依赖。

除游戏联机所需的服务外，还包含一个网页管理端：房间直播、谱面库、社区谱面、Mod 发布都在里面，
不需要登服务器敲命令。

---

## 三个入口

| 入口 | 端口 | 进程 | 职责 |
|------|------|------|------|
| WebSocket 联机服务 + 管理页 | 3005 | `src/index.ts` → `dist/index.js` | 登录/注册、大厅、房间、聊天、准备与开局、心跳；同端口托管管理页与 `/api/*` 管理接口 |
| HTTP API | 3004 | `src/api-server.ts` → `dist/api-server.js` | 谱面列表、谱面上下载、元数据发布、版本检查、Mod 更新与下载 |
| 管理页 | 3005 | 同上 | `http://<主机>:3005/` |

两个进程都是独立 Node 进程，共用同一个 SQLite 文件、同一个 `charts/` 目录、同一个 `mod-releases/` 目录。
因为它们读写同一份磁盘状态，管理端看到的和游戏里看到的始终一致，不需要同步。

> 注意：管理页在 **3005**，而谱面与 Mod 文件的下载只在 **3004** 提供。
> 管理端生成对外地址时会固定用 `API_PORT`，不会把 3005 写进数据库。

---

## 管理端

浏览器打开 `http://<主机>:3005/`，两种登录方式：

| 方式 | 说明 |
|------|------|
| 账号密码 | 账号需要 `role >= 2`。用 `scripts/make-admin.mjs` 升级或新建（见下） |
| API 令牌 | 直接填 `.env` 里的 `API_TOKEN`，用于没有管理员账号或 `.env` 尚未配置账号时应急 |

两条通道最终换到的都是同一个管理 token，前端不区分来源。令牌方式不写「记住我」。

### 页面

- **概览** — 在线人数、房间数、用户数、谱面条数与占用、当前生效的 Mod 版本。
- **房间** — 实时房间列表；进详情可看玩家与聊天、改房间信息、踢人、转移房主。
- **谱面库** — `charts/` 目录里的谱面包：上传、下载、删除。删除前会检查引用：被房间或社区条目
  引用的包返回 409，并说明是谁在用。
- **社区谱面** — 三件事分开做：
  - *本服务器已发布*：本库条目，可下载、可下架；
  - *上游 rhythm.cafe*：实时搜索上游，可直链下载，也可「发布到本库」（抓包落盘后入库）；
  - *上传并发布*：本机文件上传后立刻登记元数据。
- **Mod 发布** — 上传整包 zip、切换生效版本、预览热更新清单、删除旧版本。

### 管理员账号

```bash
node --env-file=.env scripts/make-admin.mjs list             # 看现有账号与角色
node --env-file=.env scripts/make-admin.mjs promote <账号>    # 升级为管理员
node --env-file=.env scripts/make-admin.mjs demote <账号>     # 降回普通用户
node --env-file=.env scripts/make-admin.mjs create <账号> <密码>  # 新建管理员
```

`role`：`1` 普通用户，`2` 管理员。账号只能是 2–32 位的字母、数字、下划线；密码至少 6 位。

---

## HTTP 接口（3004）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/health` | 健康检查，返回端口、谱面数、上游地址、Mod 版本 |
| GET | `/checkupdate?platform=win` | 替代已停摆的原版版本检查服务器 |
| GET | `/api/get_chartlist.php?q=&page=&per_page=` | 社区谱面列表，对客户端保持 Typesense 外形 |
| GET | `/api/levels/:id/download` | 反代上游谱面下载，流式转发 |
| POST | `/charts/upload?name=x.rdzip` | 上传 `.rdzip` 原始字节 |
| GET | `/charts/<file>` | 下载已上传谱面 |
| POST | `/charts/publish` | 发布/更新谱面元数据（按 url 幂等） |
| GET | `/mods/<release>/(CacheAssets|boot)/<path>` | Mod 文件下载 |
| POST | `/mods/admin/publish` | 上传整包 zip 并发布 Mod（需 `API_TOKEN`） |
| GET | `/mods/admin/releases` | 列出已发布版本 |
| POST | `/mods/admin/activate?release=<id>` | 切换生效版本 |

### 社区谱面列表

官方上游 `https://rhythm.cafe` 是活的（约 5300 条谱面），死掉的只是两个代理镜像
（`cafe.rhythmdoctor.top`、`orchardb.fly.dev`）。本服务对上游做**实时代理**，并把本地发布的
谱面合并进结果，对客户端仍返回 Typesense 形状：

```json
{ "found": 5320, "page": 1, "out_of": 5320, "hits": [ { "document": { ... } } ] }
```

- 本地条目整体置顶，后面接上游，按**连续全局偏移**分页。
- 下载地址双轨：`url2` 是 CDN 直链（`c2.rhythm.cafe`），`url` 是本机兜底
  （服务器出口只有约 1 Mbps，大包优先走 CDN）。
- 必须走 IPv4：`dns.setDefaultResultOrder('ipv4first')`。

### 谱面上传与发布

上传只发原始字节，响应返回服务端实际落盘的文件名：

```json
{ "success": true, "data": { "name": "20261024184955_a99e58_chart.rdzip", "size": 2319, "url": "..." } }
```

文件名带时间戳与随机段，同名上传不会互相覆盖。客户端随后把 `name` POST 到 `/charts/publish`
登记元数据（`song`/`artist`/`authors`/`difficulty`/`minBpm`/`maxBpm`/`tags`）。
`difficulty` 是 **0–3 的整数**，不是 BPM。

**上传不等于发布**：包进 `charts/` 后房间里就能用，但只有登记了元数据才会出现在游戏内的社区页。

---

## Mod 托管

客户端启动时先读本地包里那份**不可热更新**的 `RDOL.Entry.dll` 与 `checkupdate.*.assets`，再去
`/checkupdate` 取清单，比对 `CacheAssets/` 下的同名文件哈希，不一致就下载。

### 两层结构

| 层 | 目录 | 什么时候更新 |
|----|------|--------------|
| 热更新层 | `<release>/CacheAssets/` | 客户端每次启动比对 `files[]`，变了就下载 |
| 重启层 | `<release>/boot/` | 出包时把加载器与入口 DLL 一起换掉；不在 `files[]` 里 |

`mod-releases/current` 是一个文本文件，内容为当前生效的发布目录名。
`/checkupdate` 每次请求都重新读它，所以切换版本不需要重启进程。

### 契约

`GET /checkupdate?platform=win` 返回：

```json
{ "version": "2.0.0", "announcement": "", "platform": "win", "url": "", "force": false,
  "files": [ { "name": "RDOL.dll", "hash": "sha256:<64 位小写 hex>", "size": 123456, "url": "..." } ] }
```

- `version` 必须回 **`clientVersion`**（当前为 `2.0.0`）。它与客户端 `ScnCheckUpdate.BuiltInVersion`
  比较，写大了会把人挡在门外。
- `hash` 的格式固定为 `sha256:` + 小写 hex，客户端按 `OrdinalIgnoreCase` 比对。
- `name` 会被 `Path.GetFileName` 截成裸文件名落进 `CacheAssets/`，所以清单里**不能有重名**；
  服务端发现重名会直接报错而不是生成一份会互相覆盖的清单。
- 客户端只下载 `CacheAssets/` 下清单里的文件；**清单为空时它不会删本地任何文件**。
- 客户端会删除 `CacheAssets/` 里不在清单中的文件，所以清单必须完整覆盖该目录。

### 发布

管理端「Mod 发布」页上传整包 zip，服务端按文件名白名单分拣：
热更新文件进 `CacheAssets/`，加载器与入口 DLL 进 `boot/`。也可以命令行：

```bash
./scripts/publish-mod.sh <整包.zip> <release-id> [clientVersion]
```

发布前建议先点「预览清单」，确认文件数与哈希；发布失败时服务端会清掉整个残目录并复位 `current`，
不会留下半成品。

---

## 数据与存储

- **SQLite 单文件**（`node:sqlite`），默认 `./data/rdonline.db`，无需账号密码。
  - 因为 `RETURNING` 等语句必须走 `all()`，见 `src/db/sqlite.ts`。
- 谱面包落盘在 `./charts`，Mod 发布在 `./mod-releases`。
- `data/`、`charts/`、`mod-releases/` 都是运行时数据，**不进版本库**。

表结构（`src/db/schema.ts`，启动时幂等建表）：

- `users` — 账号；`email` 允许为空（邮箱验证已移除，字段保留以兼容客户端）。
- `levels` — 本地发布的谱面元数据。

推荐备份就三条：数据库文件、`charts/`、`mod-releases/`。

---

## 目录结构

```
src/
  index.ts                  WebSocket 服务入口（3005），同时挂管理页
  api-server.ts             HTTP API 入口（3004）
  admin-server.ts           管理页静态文件 + /api/* 管理接口
  admin-ws.manager.ts       管理端实时推送（房间与在线状态）
  db/                       sqlite 封装与建表
  services/
    auth.service.ts         登录、注册、token 校验
    level.service.ts        社区谱面：上游代理、合并、发布
    chart-cleanup.service.ts 孤儿谱面清理
    mod-publish.service.ts  Mod 整包分拣与发布（3004 与管理端共用）
  config/
    chart.ts                谱面目录、文件名规则、对外地址前缀
    mod-releases.ts         Mod 发布目录、清单生成、版本比较
public/                     管理页（原生 JS，无构建步骤）
scripts/
  make-admin.mjs            管理员账号维护
  publish-mod.sh            命令行发布 Mod
```

---

## 运行

```bash
pnpm install
pnpm build            # tsc 编译到 dist/
pnpm start            # WebSocket 服务 + 管理页（3005）
pnpm start:api        # HTTP API（3004）
```

生产用 systemd 各起一个单元，两个单元都要 `EnvironmentFile` 指向 `.env`，
`WorkingDirectory` 指向仓库根目录（相对路径的 `charts/`、`data/` 依赖它）。
`rdol-api` 少了 `EnvironmentFile` 会导致它读不到 `API_TOKEN` 与 `MOD_DIR`，表现为 401 和空发布列表。

---

## 环境变量

见 [.env.example](./.env.example)。要点：

- `SERVER_PORT`（3005）、`API_PORT`（3004）、`API_VERSION`（`2.0.0`，须与客户端内置版本一致）
- `DB_FILE` — SQLite 文件路径
- `CHART_DIR` — `.rdzip` 落盘目录
- `CHART_BASE_URL` — 对外可访问的基础地址；留空则由请求 Host 推断
- `MAX_UPLOAD_MB` — 谱面上传上限，默认 64
- `API_TOKEN` — 管理接口令牌，同时是管理页的后备登录方式
- `MOD_DIR` — Mod 发布根目录，默认 `./mod-releases`
- `MAX_MOD_MB` — Mod 整包上限，默认 256
- `SMTP_*` — 保留字段，邮箱验证已移除，正常部署留空即可

密钥只写进 `.env`，不提交、不回显。

---

## 与客户端配套

RDOL 客户端的 `rdol.config.json` 决定它连哪个服务；默认地址已指向本服务所在主机。
客户端侧的谱面来源分三个独立标签页：社区谱面库、官方关卡、玩家关卡库。
官方关卡只传关卡标识（`internal://<LevelName>`），各端本地加载音频，因此不受版本差异影响。

出包流程见客户端仓库的 `BUILDING-WINDOWS.md`：本机 Windows + Unity 出整包，
再用 `scripts/publish-mod.sh` 或管理端上传，客户端下次启动即自动更新。
