# ADOFAI Online API 文档

## 基本信息

- **默认端口**: 4004
- **Base URL**: `{API_BASE_URL}` (开发环境)
- **内容类型**: `application/json`
- **字符编码**: UTF-8
- **CORS**: 已启用，支持跨域请求

---

## 全局说明

### 请求头要求

所有 POST/PUT 请求必须包含：
```
Content-Type: application/json
```

跨域请求会自动处理，支持的 CORS 头：
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
Access-Control-Allow-Credentials: true
```

### 通用错误响应格式

所有错误响应都遵循统一的 JSON 格式：
```json
{
  "error": "错误描述信息"
}
```

### HTTP 状态码说明

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 204 | 请求成功（无内容，用于 OPTIONS 预检） |
| 400 | 请求错误（所有业务错误都返回400，具体错误看error字段） |
| 404 | 资源不存在 |
| 405 | 请求方法不允许 |
| 503 | 服务不可用（数据库连接失败） |

---

## 1. 健康检查

### GET /health

检查服务是否存活。

**请求方法**: `GET`

**请求头**: 无特殊要求

**请求参数**: 无

**成功响应** (200)
```json
{
  "status": "ok",
  "timestamp": "2026-02-09T12:00:00Z",
  "version": "1.0.0"
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| status | string | 服务状态，固定为 "ok" |
| timestamp | string | 当前服务器时间 (ISO 8601 格式) |
| version | string | API 版本号 |

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 405 | `{"error":"Method not allowed"}` | 使用了非 GET 方法 |

**示例**

```bash
# cURL 请求
curl {API_BASE_URL}/health

# JavaScript Fetch
fetch('{API_BASE_URL}/health')
  .then(res => res.json())
  .then(data => console.log(data));
```

---

## 2. 热更新

### GET /checkupdate

检查更新，按平台返回资源包列表。

**请求方法**: `GET`

**请求头**: 无特殊要求

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| platform | string | 是 | 平台标识：`android` / `ios` / `win` |

**成功响应** (200)
```json
{
  "version": "1.0.0",
  "announcement": "更新公告内容...",
  "platform": "android",
  "files": [
    {
      "name": "ADOFAIOL.dll.bytes",
      "hash": "sha256:abc123...",
      "size": 12345,
      "url": "{API_BASE_URL}/download/ADOFAIOL.dll.bytes"
    },
    {
      "name": "Android/adofaiol.resources.assets.bundle",
      "hash": "sha256:def456...",
      "size": 67890,
      "url": "{API_BASE_URL}/download/Android/adofaiol.resources.assets.bundle"
    }
  ]
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| version | string | 当前版本号 |
| announcement | string | 更新公告内容 |
| platform | string | 请求的平台标识 |
| files | array | 文件列表 |
| files[].name | string | 文件名（含路径） |
| files[].hash | string | 文件 SHA256 哈希值 |
| files[].size | number | 文件大小（字节） |
| files[].url | string | 文件下载链接 |

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | `{"error":"platform parameter required (android\|ios\|win)"}` | 缺少 platform 参数 |
| 400 | `{"error":"invalid platform (android\|ios\|win)"}` | platform 参数值无效 |
| 405 | `{"error":"Method not allowed"}` | 使用了非 GET 方法 |
| 500 | `{"error":"manifest not found: ..."}` | manifest.json 文件不存在 |
| 500 | `{"error":"invalid manifest: ..."}` | manifest.json 格式错误 |
| 500 | `{"error":"failed to scan bundles: ..."}` | 无法扫描 bundles 目录 |

**示例**

```bash
# cURL 请求
curl "{API_BASE_URL}/checkupdate?platform=android"

# JavaScript Fetch
fetch('{API_BASE_URL}/checkupdate?platform=android')
  .then(res => res.json())
  .then(data => console.log(data));
```

**说明**

- 根目录的程序集文件（如 `ADOFAIOL.dll.bytes`）各平台共用
- 平台专属的 bundle 文件存放在对应子目录（`Android/`、`IOS/`、`StandaloneWindows/`）
- 文件哈希用于客户端验证文件完整性
- 如果未设置 `BASE_URL` 环境变量，下载链接会自动根据请求的 Host 生成
- 返回的 `files[].url` 可能带有查询参数 `?h=xxx`（SHA256 前 16 位），用于缓存失效，客户端应原样使用

---

### GET /download/{path}

下载资源包文件。

**请求方法**: `GET`

**请求头**: 无特殊要求

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| path | string | 文件相对路径，支持根目录文件或平台子目录文件 |

**成功响应** (200)

返回文件二进制内容，Content-Type 根据文件类型自动设置。

**响应头**
```
Cache-Control: public, max-age=86400
Content-Type: application/octet-stream
```

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | `{"error":"invalid path"}` | 路径为空、包含 `..` 或以 `/` 开头 |
| 403 | `{"error":"access denied"}` | 路径穿越攻击被拦截 |
| 404 | - | 文件不存在 |
| 405 | `{"error":"Method not allowed"}` | 使用了非 GET 方法 |
| 500 | `{"error":"file unavailable"}` | 文件存在但无法读取（如权限问题） |

**说明**：请求路径为目录时返回 403 `{"error":"access denied"}`。

**示例**

```bash
# 下载根目录文件
curl -O {API_BASE_URL}/download/ADOFAIOL.dll.bytes

# 下载平台专属文件
curl -O {API_BASE_URL}/download/Android/adofaiol.resources.assets.bundle

# JavaScript 下载
fetch('{API_BASE_URL}/download/ADOFAIOL.dll.bytes')
  .then(res => res.blob())
  .then(blob => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ADOFAIOL.dll.bytes';
    a.click();
  });
```

**安全说明**

- 路径穿越攻击（如 `../../../etc/passwd`）会被自动拦截
- 只能访问 `bundles/` 目录下的文件
- 文件缓存时间为 24 小时

---

## 3. 认证

### POST /auth/send-code

发送注册验证码到邮箱。

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
```

**请求体**
```json
{
  "email": "user@example.com"
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 接收验证码的邮箱地址，**仅支持 163.com、qq.com** |

**成功响应** (200)
```json
{
  "message": "verification code sent"
}
```

**错误响应**

所有错误统一返回 400 状态码，错误信息在 `error` 字段中：

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `Content-Type must be application/json` - 请求头错误
- `invalid request body: ...` - JSON格式错误
- `email required` - 缺少邮箱
- `仅支持163、QQ邮箱注册` - 邮箱域名非 163.com 或 qq.com
- `该邮箱域名已被禁止注册` - 该邮箱域名在封禁列表中
- `验证码保存失败` - 数据库错误
- `邮件发送失败，请检查邮箱地址` - 邮件发送失败

**示例**

```bash
# cURL 请求
curl -X POST {API_BASE_URL}/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'

# JavaScript Fetch
fetch('{API_BASE_URL}/auth/send-code', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'user@example.com'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

**说明**

- **注册仅支持 163、QQ 邮箱**（163.com、qq.com）
- 验证码有效期为 10 分钟
- 验证码为 6 位字母数字混合（如 `gl7lsy`）
- 验证码不区分大小写（`GL7LSY` 和 `gl7lsy` 等效）
- 每个验证码只能使用一次

---

### POST /auth/register

注册新账号。

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
```

**请求体**
```json
{
  "username": "myuser",
  "password": "mypassword",
  "email": "user@example.com",
  "code": "123456"
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名，最多 10 个字符（支持中文，按字符数计算） |
| password | string | 是 | 密码，建议至少 6 位 |
| email | string | 是 | 邮箱地址，**仅支持 163.com、qq.com** |
| code | string | 是 | 邮箱验证码（6 位字母数字混合，不区分大小写） |

**成功响应** (200)
```json
{
  "message": "registered successfully"
}
```

**错误响应**

所有错误统一返回 400 状态码，错误信息在 `error` 字段中（中文）：

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `Content-Type must be application/json` - 请求头错误
- `invalid request body: ...` - JSON格式错误
- `username, password, email, code required` - 缺少必填字段
- `用户名最多10个字符` - 用户名超过10个字符
- `仅支持163、QQ邮箱注册` - 邮箱域名非 163.com 或 qq.com
- `该邮箱域名已被禁止注册` - 该邮箱域名在封禁列表中
- `用户名已存在` - 用户名重复
- `邮箱已被注册` - 邮箱重复
- `请先获取验证码` - 没有发送过验证码
- `验证码已被使用，请重新获取` - 验证码已用过
- `验证码已过期，请重新获取` - 验证码超过10分钟
- `验证码错误` - 验证码不正确

**示例**

```bash
# cURL 请求
curl -X POST {API_BASE_URL}/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "myuser",
    "password": "mypassword",
    "email": "user@example.com",
    "code": "123456"
  }'

# JavaScript Fetch
fetch('{API_BASE_URL}/auth/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    username: 'myuser',
    password: 'mypassword',
    email: 'user@example.com',
    code: '123456'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

**重要说明**

- 新注册用户默认 `status=0`（封禁状态）、`role=1`（普通用户）
- 账号需要在群内绑定 QQ 后由管理员解禁才能使用
- 用户名长度限制为 10 个字符（中文、英文、数字都算 1 个字符）
- 验证码为 6 位字母数字混合，不区分大小写
- 验证码有效期为 10 分钟，每个验证码只能使用一次
- 密码会使用 bcrypt 加密存储

---

### POST /auth/login

用户登录。

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
```

**请求体**
```json
{
  "username": "myuser",
  "password": "mypassword"
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名或邮箱地址 |
| password | string | 是 | 密码 |

**成功响应** (200)
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "uid": 1
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| token | string | JWT 认证令牌，用于后续需要认证的请求 |
| uid | number | 用户 ID |

**错误响应**

所有错误统一返回 400 状态码，错误信息在 `error` 字段中（中文）：

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `Content-Type must be application/json` - 请求头错误
- `invalid request body: ...` - JSON格式错误
- `username and password required` - 缺少用户名或密码
- `用户名或密码错误` - 登录凭据错误

**示例**

```bash
# cURL 请求
curl -X POST {API_BASE_URL}/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "myuser",
    "password": "mypassword"
  }'

# JavaScript Fetch
fetch('{API_BASE_URL}/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    username: 'myuser',
    password: 'mypassword'
  })
})
.then(res => {
  if (!res.ok) throw new Error('Login failed');
  return res.json();
})
.then(data => {
  console.log('Token:', data.token);
  console.log('UID:', data.uid);
  // 保存 token 用于后续请求
  localStorage.setItem('token', data.token);
});
```

**说明**

- `username` 字段支持用户名或邮箱登录
- 返回的 `token` 是 JWT 令牌，需要在后续需要认证的请求中携带
- Token 有效期根据服务器配置（默认 7 天）
- 封禁账号仍可登录，仅限制部分功能

---

## 4. 用户信息

### GET /me

获取当前登录用户的信息。**需要登录认证**

**请求方法**: `GET`

**请求头**: 
```
Authorization: Bearer your_token_here
```

**请求参数**: 无

**成功响应** (200)
```json
{
  "uid": 1,
  "username": "testuser",
  "email": "user@example.com",
  "avatar": "{API_BASE_URL}/files/avatars/xxx.jpg",
  "avatar_frame": "{API_BASE_URL}/files/frames/xxx.png",
  "name_color": "#FF0000",
  "qq": "123456789",
  "role": 1,
  "status": 1
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| uid | number | 用户ID |
| username | string | 用户名 |
| email | string | 邮箱地址 |
| avatar | string/null | 头像URL（可为null） |
| avatar_frame | string/null | 当前佩戴的头像框图片URL（可为null） |
| name_color | string/null | 名字颜色，如 #RRGGBB（可为null） |
| qq | string/null | QQ号（可为null） |
| role | number | 角色：1=普通用户，2=管理员，3=超级管理员 |
| status | number | 状态：0=封禁，1=正常 |

**错误响应**

所有错误统一返回对应状态码，错误信息在 `error` 字段中（中文）：

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供 token
- `登录已失效，请重新登录` (401) - token 不存在
- `登录已过期，请重新登录` (401) - token 已过期
- `Token验证失败` (500) - 验证 token 时数据库错误
- `用户信息获取失败` (500) - 服务器错误
- `用户不存在` (404) - 用户已被删除
- `查询用户信息失败` (500) - 数据库错误
- `服务暂时不可用，数据库未连接` (503) - 数据库未连接

**示例**

```bash
# cURL 请求
curl {API_BASE_URL}/me \
  -H "Authorization: Bearer your_token_here"

# JavaScript Fetch
const token = localStorage.getItem('token');

fetch('{API_BASE_URL}/me', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(res => res.json())
.then(data => {
  if (data.error) {
    alert(data.error);
  } else {
    console.log('用户信息:', data);
    console.log('用户名:', data.username);
    console.log('邮箱:', data.email);
  }
});

// React 示例
async function getUserInfo() {
  const token = localStorage.getItem('token');
  
  if (!token) {
    alert('请先登录');
    return;
  }
  
  try {
    const response = await fetch('{API_BASE_URL}/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    
    if (data.error) {
      alert(data.error);
      return;
    }
    
    // 使用用户信息
    console.log('用户信息:', data);
    return data;
  } catch (error) {
    alert('获取用户信息失败');
  }
}
```

**说明**

- 此接口用于获取当前登录用户的详细信息
- 可用于显示用户资料、验证登录状态等
- `status=0` 表示账号被封禁，前端可以根据此字段提示用户

---

### PUT /me

更新当前用户资料（用户名、佩戴的头像框）。**需要登录认证**

**请求方法**: `PUT`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer your_token_here
```

**请求体**
```json
{
  "username": "newusername",
  "avatar_frame": "{API_BASE_URL}/files/frames/xxx.png"
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 新用户名，最多10个字符 |
| avatar_frame | string/null | 否 | 佩戴的头像框图片URL；传空字符串可清空，不传则不修改 |

**说明**：名字颜色（`name_color`）仅管理员可通过 PUT /admin/users 修改，用户本人不可修改。

**成功响应** (200)
```json
{
  "message": "更新成功"
}
```

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供token
- `登录已失效，请重新登录` (401) - token不存在
- `登录已过期，请重新登录` (401) - token已过期
- `Content-Type must be application/json` (400) - 请求头错误
- `请求格式错误` (400) - JSON格式错误
- `用户名不能为空` (400) - 用户名为空
- `用户名最多10个字符` (400) - 用户名超过10个字符
- `用户名已被占用` (400) - 用户名重复
- `更新用户名失败` (500) - 数据库错误

**说明**

- 只能更新自己的用户名和佩戴的头像框
- 用户名长度限制为10个字符（中文、英文、数字都算1个字符）
- 用户名不能与其他用户重复
- 头像框需为用户已解锁的头像框之一，前端根据「头像框列表」与「已解锁列表」校验后提交对应 URL
- 更新后会自动记录 `profile_updated_at` 时间

---

### POST /me/password

修改密码。**需要登录认证**

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer your_token_here
```

**请求体**
```json
{
  "old_password": "oldpass123",
  "new_password": "newpass456"
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| old_password | string | 是 | 当前密码 |
| new_password | string | 是 | 新密码 |

**成功响应** (200)
```json
{
  "message": "密码修改成功，请使用新密码重新登录"
}
```

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供token
- `登录已失效，请重新登录` (401) - token不存在
- `登录已过期，请重新登录` (401) - token已过期
- `Content-Type must be application/json` (400) - 请求头错误
- `请求格式错误` (400) - JSON格式错误
- `旧密码和新密码不能为空` (400) - 缺少字段
- `旧密码错误` (400) - 当前密码不正确
- `修改密码失败` (500) - 数据库错误

**说明**

- 必须提供正确的旧密码才能修改
- 新密码会使用 bcrypt 加密存储
- **修改密码后当前 token 立即失效**，需使用新密码重新登录

---

### GET /users/:id

获取指定用户的公开信息。**不需要认证**

**请求方法**: `GET`

**请求头**: 无特殊要求

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| id | number | 用户ID |

**成功响应** (200)
```json
{
  "uid": 1,
  "username": "testuser",
  "avatar": "{API_BASE_URL}/files/avatars/xxx.jpg",
  "avatar_frame": "{API_BASE_URL}/files/frames/xxx.png",
  "name_color": "#FF0000",
  "qq": "123456789",
  "role": 1,
  "status": 1
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| uid | number | 用户ID |
| username | string | 用户名 |
| avatar | string/null | 头像URL（可为null） |
| avatar_frame | string/null | 当前佩戴的头像框图片URL（可为null） |
| name_color | string/null | 名字颜色，如 #RRGGBB（可为null） |
| qq | string/null | QQ号（可为null） |
| role | number | 角色：1=普通用户，2=管理员，3=超级管理员 |
| status | number | 状态：0=封禁，1=正常 |

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `用户ID不能为空` (400) - 未提供用户ID
- `用户ID格式错误` (400) - 用户ID不是数字
- `用户不存在` (404) - 用户不存在
- `查询用户信息失败` (500) - 数据库错误

**说明**

- 此接口不需要登录即可访问
- 只返回公开信息，不返回邮箱地址
- 可用于查看其他用户的资料

---

## 5. 头像框

### GET /avatar-frames

获取所有头像框列表（系统内全部可选头像框及图片 URL）。**不需要认证**

**请求方法**: `GET`

**请求头**: 无特殊要求

**请求参数**: 无

**成功响应** (200)
```json
[
  {
    "id": 1,
    "image_url": "{API_BASE_URL}/files/frames/frame1.png"
  },
  {
    "id": 2,
    "image_url": "{API_BASE_URL}/files/frames/frame2.png"
  }
]
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 头像框ID |
| image_url | string | 头像框图片 URL |

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 405 | `{"error":"Method not allowed"}` | 使用了非 GET 方法 |
| 500 | `{"error":"查询头像框列表失败"}` | 数据库错误 |
| 503 | - | 数据库未连接 |

**说明**

- 按 `sort_order`、`id` 升序返回
- 前端可据此展示头像框图鉴；再结合「当前用户已解锁的头像框」接口判断哪些可佩戴

---

### GET /me/avatar-frames

获取当前用户已解锁的头像框列表。**需要登录认证**

**请求方法**: `GET`

**请求头**: 
```
Authorization: Bearer your_token_here
```

**请求参数**: 无

**成功响应** (200)
```json
[
  {
    "id": 1,
    "image_url": "{API_BASE_URL}/files/frames/frame1.png"
  }
]
```

**响应字段说明**

与 `GET /avatar-frames` 单条结构相同：`id`、`image_url`，仅返回当前用户已解锁的头像框。

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供 token
- `登录已失效，请重新登录` (401) - token 无效或已过期
- `用户信息获取失败` (500) - 服务器错误
- `查询已解锁头像框失败` (500) - 数据库错误
- `服务暂时不可用，数据库未连接` (503) - 数据库未连接

**说明**

- 仅返回当前用户已解锁的头像框（含 id 与 image_url）
- 前端可据此判断用户能佩戴哪些头像框；用户选择佩戴时，将对应头像框的 `image_url` 通过 `PUT /me` 的 `avatar_frame` 提交

---

## 6. 设备码

用户可将游戏客户端生成的六位数字设备码绑定到账号下，每个账号最多绑定 2 个设备码。**绑定前须已绑定 QQ 且账号未封禁**。

### GET /verify/device-code

**不需要认证**。有两种用法：

1. **不传 `device_code`**：生成一个六位（大写字母+数字）设备码并返回，**不写入数据库**，且保证与库中已有设备码不重复；若随机到重复会一直重试直到生成不重复的码。
2. **传 `device_code`**：校验该设备码是否已绑定且对应用户可用（已绑定 QQ、未封禁）。

**请求方法**: `GET`

**请求头**: 无特殊要求

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_code | string | 否 | 不传则生成新设备码；传则校验。格式：六位数字 或 六位大写字母+数字 |

**响应一：未传 device_code — 生成设备码** (200)

返回一个新生成的、与库中不重复的六位设备码（不存库）。

```json
{
  "device_code": "AB12CD"
}
```

**响应二：传了 device_code — 校验结果**

成功（设备码存在且对应用户已绑定 QQ、未封禁）(200)：
```json
{
  "success": true
}
```

失败 (200) — 统一 200，通过 `success: false` 与 `error` 区分原因：

| error 取值 | 说明 |
|-----------|------|
| `设备码格式错误` | 参数不是六位数字或六位大写字母+数字 |
| `设备码未绑定` | 该设备码未在库中绑定任何账号 |
| `您的账号被封` | 设备码已绑定，但该账号已被封禁 |
| `未绑定QQ` | 设备码已绑定，但该账号未绑定 QQ |

示例（失败）：
```json
{
  "success": false,
  "error": "设备码未绑定"
}
```

**其他错误**

| 状态码 | 说明 |
|--------|------|
| 405 | `{"error":"Method not allowed"}` — 非 GET 方法 |
| 500 | `{"error":"生成设备码失败"}` — 仅在不传 device_code 时，查询库失败等异常 |
| 503 | 数据库未连接 |

---

### GET /me/devices

获取当前用户已绑定的设备码列表。**需要登录认证**

**请求方法**: `GET`

**请求头**: 
```
Authorization: Bearer your_token_here
```

**请求参数**: 无

**成功响应** (200)
```json
[
  {
    "device_code": "123456",
    "created_at": "2026-02-10T12:00:00Z"
  },
  {
    "device_code": "654321",
    "created_at": "2026-02-10T13:00:00Z"
  }
]
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| device_code | string | 六位设备码（数字或大写字母+数字） |
| created_at | string | 绑定时间（ISO 8601） |

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 401 | `{"error":"请先登录"}` 等 | 未提供 token 或 token 无效 |
| 405 | `{"error":"Method not allowed"}` | 非 GET 方法 |
| 500 | `{"error":"查询设备码列表失败"}` | 数据库错误 |
| 503 | - | 数据库未连接 |

---

### POST /me/devices

绑定设备码。**需要登录认证**

**前提条件**：用户已绑定 QQ（`qq` 不为空）且账号未封禁（`status = 1`）。每个用户最多绑定 2 个设备码。

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer your_token_here
```

**请求体**
```json
{
  "device_code": "123456"
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_code | string | 是 | 六位数字 或 六位大写字母+数字（可由 GET /verify/device-code 不传参生成） |

**成功响应** (200)

首次绑定：
```json
{
  "message": "绑定成功"
}
```

该设备码已绑定过当前账号（幂等）：
```json
{
  "message": "该设备码已绑定"
}
```

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | `{"error":"请求格式错误"}` | JSON 格式错误 |
| 400 | `{"error":"设备码必须为六位数字或六位大写字母与数字组合"}` | 设备码格式不正确 |
| 400 | `{"error":"请先绑定 QQ 后再绑定设备码"}` | 用户未绑定 QQ |
| 400 | `{"error":"最多只能绑定两个设备码"}` | 已绑定 2 个，无法再绑定 |
| 401 | `{"error":"请先登录"}` 等 | 未提供 token 或 token 无效 |
| 403 | `{"error":"账号已封禁，无法绑定设备码"}` | 用户已被封禁 |
| 404 | `{"error":"用户不存在"}` | 用户不存在 |
| 405 | `{"error":"Method not allowed"}` | 非 POST 方法 |
| 500 | `{"error":"查询用户信息失败"}` 等 | 服务器错误 |
| 503 | - | 数据库未连接 |

---

### DELETE /me/devices

解绑设备码。仅能解绑当前用户自己账号下已绑定的设备码。**需要登录认证**

**请求方法**: `DELETE`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer your_token_here
```

**请求体**
```json
{
  "device_code": "123456"
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_code | string | 是 | 要解绑的设备码（六位数字或六位大写字母+数字） |

**成功响应** (200)
```json
{
  "message": "解绑成功"
}
```

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | `{"error":"请求格式错误"}` | JSON 格式错误 |
| 400 | `{"error":"设备码必须为六位数字或六位大写字母与数字组合"}` | 设备码格式不正确 |
| 401 | `{"error":"请先登录"}` 等 | 未提供 token 或 token 无效 |
| 404 | `{"error":"该设备码未绑定或不属于当前账号"}` | 无此绑定记录或不属于当前用户 |
| 405 | `{"error":"Method not allowed"}` | 非 DELETE 方法 |
| 500 | `{"error":"解绑失败"}` | 服务器错误 |
| 503 | - | 数据库未连接 |

---

## 7. 文件上传

### POST /upload/purchase-receipt

上传购买凭证照片。**需要登录认证**

**请求方法**: `POST`

**请求头**: 
```
Content-Type: multipart/form-data
Authorization: Bearer your_token_here
```

**认证说明**：
- 必须先调用登录接口获取token
- 在请求头中添加 `Authorization: Bearer {token}` 或 `Authorization: {token}`

**请求参数**

使用 `FormData` 上传文件，字段名为 `file`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 图片文件 |

**支持的图片格式**：jpg, jpeg, png, gif, webp

**文件大小限制**：最大 10MB

**成功响应** (200)
```json
{
  "filename": "20260209_180530_screenshot.png",
  "url": "{API_BASE_URL}/files/Purchasereceipt/20260209_180530_screenshot.png",
  "size": 102400
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| filename | string | 保存的文件名（时间戳_原文件名） |
| url | string | 文件访问URL |
| size | number | 文件大小（字节） |

**错误响应**

未提供或 token 无效时返回 401，数据库未连接时返回 503，其余为 400，错误信息在 `error` 字段中（中文）：

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供 token 或 token 无效
- `登录已失效，请重新登录` (401) - token 不存在
- `登录已过期，请重新登录` (401) - token 已过期
- `Method not allowed` (405) - 请求方法错误
- `请选择要上传的文件` (400) - 没有选择文件
- `只支持图片格式：jpg, jpeg, png, gif, webp` (400) - 文件格式不支持
- `文件大小不能超过10MB` (400) - 文件太大
- `创建上传目录失败` (500) - 服务器错误
- `文件保存失败` (500) - 服务器错误
- `文件写入失败` (500) - 服务器错误
- `服务暂时不可用，数据库未连接` (503) - 数据库未连接

**示例**

```bash
# cURL 请求（需要token）
curl -X POST {API_BASE_URL}/upload/purchase-receipt \
  -H "Authorization: Bearer your_token_here" \
  -F "file=@/path/to/image.jpg"

# JavaScript FormData（需要token）
const token = localStorage.getItem('token');
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('{API_BASE_URL}/upload/purchase-receipt', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
})
.then(res => res.json())
.then(data => {
  if (data.error) {
    alert(data.error);
  } else {
    console.log('上传成功:', data.url);
  }
});

// React 示例（带token）
async function handleUpload(file) {
  const token = localStorage.getItem('token');
  
  if (!token) {
    alert('请先登录');
    return;
  }
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch('{API_BASE_URL}/upload/purchase-receipt', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    const data = await response.json();
    
    if (data.error) {
      alert(data.error);
      return;
    }
    
    console.log('文件URL:', data.url);
    // 可以将 data.url 保存到状态或发送给后端
  } catch (error) {
    alert('上传失败');
  }
}
```

**说明**

- 文件会保存在服务器的 `upload/Purchasereceipt/` 目录下
- 文件名格式：`时间戳_原文件名`（如 `20260209_180530_screenshot.png`）
- 上传成功后返回的 URL 可以直接访问查看图片
- 文件会缓存24小时

---

### POST /upload/bundle

上传平台 bundle 压缩包（Android / iOS / Windows），自动清空对应平台目录并解压。**无需登录**

**请求方法**: `POST`

**请求头**: `Content-Type: multipart/form-data`

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| platform | string | 是 | `android`、`ios`、`win`（不区分大小写） |
| file | file | 是 | 单个 `.zip` 压缩包，最大 500MB |

**平台与目录对应**：`android`→`{BundlesPath}/Android/`，`ios`→`{BundlesPath}/IOS/`，`win`→`{BundlesPath}/StandaloneWindows/`

**成功响应** (200): `{"message": "上传并解压成功"}`

**错误响应** (均为 JSON `{"error": "..."}`)：`缺少参数 platform (android|ios|win)`、`platform 必须为 android、ios 或 win`、`请选择要上传的 zip 文件`、`只支持 .zip 格式`、`请求体过大或格式错误`、`目标路径非法` (400)；`路径解析失败`、`清空平台目录失败`、`创建临时文件失败`、`保存上传文件失败`、`无法读取 zip`、`创建解压目录失败`、`打开 zip 条目失败`、`创建文件失败`、`写入文件失败` (500)。详细说明见 `UPLOAD_BUNDLE.md`。

---

### GET /files/{path}

访问已上传的文件。

**请求方法**: `GET`

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| path | string | 文件路径（如 `Purchasereceipt/20260209_180530_screenshot.png`） |

**成功响应** (200)

返回文件二进制内容，Content-Type 根据文件类型自动设置。

**响应头**
```
Cache-Control: public, max-age=86400
Content-Type: image/jpeg (根据文件类型)
```

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | `{"error":"invalid path"}` | 路径无效 |
| 403 | `{"error":"access denied"}` | 路径穿越攻击被拦截 |
| 404 | - | 文件不存在 |
| 405 | `{"error":"Method not allowed"}` | 使用了非 GET 方法 |

**示例**

```bash
# 直接访问
{API_BASE_URL}/files/Purchasereceipt/20260209_180530_screenshot.png

# 在HTML中使用
<img src="{API_BASE_URL}/files/Purchasereceipt/20260209_180530_screenshot.png" />
```

---

## 8. 正版验证申请

### POST /applications/submit

提交正版验证申请。**需要登录认证**

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer your_token_here
```

**请求体**
```json
{
  "steam_link": "https://steamcommunity.com/...",
  "screenshot_urls": [
    "{API_BASE_URL}/files/Purchasereceipt/xxx.jpg",
    "{API_BASE_URL}/files/Purchasereceipt/yyy.jpg"
  ]
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| steam_link | string | 否 | Steam个人资料链接 |
| screenshot_urls | array | 否 | 购买记录截图URL数组，最多4张 |

**约束**：`steam_link` 和 `screenshot_urls` 至少需要提供一个

**成功响应** (200)
```json
{
  "id": 1
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 申请ID |

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供token
- `登录已失效，请重新登录` (401) - token不存在
- `登录已过期，请重新登录` (401) - token已过期
- `请求格式错误` (400) - JSON格式错误
- `Steam链接和购买截图至少需要提供一个` (400) - 两个字段都为空
- `购买截图最多只能上传4张` (400) - 截图超过4张
- `您已有申请正在审核中，请等待审核结果` (400) - 有审核中的申请
- `请先绑定QQ后再提交申请` (400) - 用户未绑定 QQ
- `您的申请已通过，无需重复提交` (400) - 已有通过的申请
- `提交申请失败` (500) - 数据库错误

**说明**

- **提交前需先绑定 QQ**（通过管理员在用户管理中设置，或后续开放用户自行绑定）
- 每个用户只能有一个有效申请（审核中或已通过）
- 申请被拒绝后可以重新提交
- 截图URL需要先通过 `/upload/purchase-receipt` 接口上传获得
- 提交后状态默认为"审核中"

---

### GET /applications/my

获取我的申请记录。**需要登录认证**

**请求方法**: `GET`

**请求头**: 
```
Authorization: Bearer your_token_here
```

**请求参数**: 无

**成功响应** (200)
```json
[
  {
    "id": 1,
    "user_id": 1,
    "steam_link": "https://steamcommunity.com/...",
    "screenshot_urls": [
      "{API_BASE_URL}/files/Purchasereceipt/xxx.jpg"
    ],
    "status": 0,
    "created_at": "2026-02-09 18:30:00",
    "updated_at": "2026-02-09 18:30:00"
  },
  {
    "id": 2,
    "user_id": 1,
    "steam_link": "",
    "screenshot_urls": [
      "{API_BASE_URL}/files/Purchasereceipt/yyy.jpg"
    ],
    "status": 2,
    "reject_reason": "截图不清晰",
    "created_at": "2026-02-08 10:00:00",
    "updated_at": "2026-02-08 15:00:00",
    "reviewed_by": 2,
    "reviewed_at": "2026-02-08 15:00:00"
  }
]
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 申请ID |
| user_id | number | 用户ID |
| steam_link | string | Steam链接 |
| screenshot_urls | array | 截图URL数组 |
| status | number | 状态：0=审核中，1=已通过，2=已拒绝 |
| reject_reason | string | 拒绝原因（仅status=2时有值） |
| created_at | string | 提交时间 |
| updated_at | string | 更新时间 |
| reviewed_by | number | 审核人ID（已审核时有值） |
| reviewed_at | string | 审核时间（已审核时有值） |

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供token
- `登录已失效，请重新登录` (401) - token不存在
- `登录已过期，请重新登录` (401) - token已过期
- `查询申请记录失败` (500) - 数据库错误

**说明**

- 返回当前用户的所有申请记录，按提交时间倒序排列
- 包含所有状态的申请（审核中、已通过、已拒绝）

---

## 9. 管理员接口

### GET /admin/applications

获取所有申请记录（支持分页和搜索）。**需要管理员权限**

**请求方法**: `GET`

**请求头**: 
```
Authorization: Bearer admin_token_here
```

**Query参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认1 |
| page_size | number | 否 | 每页数量，默认20，最大100 |
| search | string | 否 | 搜索用户名（模糊匹配） |
| status | number | 否 | 筛选状态：0=审核中，1=已通过，2=已拒绝 |

**成功响应** (200)
```json
{
  "total": 100,
  "page": 1,
  "page_size": 20,
  "total_page": 5,
  "data": [
    {
      "id": 1,
      "user_id": 1,
      "username": "testuser",
      "steam_link": "https://steamcommunity.com/...",
      "screenshot_urls": ["{API_BASE_URL}/files/Purchasereceipt/xxx.jpg"],
      "status": 0,
      "created_at": "2026-02-09 18:30:00",
      "updated_at": "2026-02-09 18:30:00"
    }
  ]
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| total | number | 总记录数 |
| page | number | 当前页码 |
| page_size | number | 每页数量 |
| total_page | number | 总页数 |
| data | array | 申请列表 |

**data数组元素字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 申请ID |
| user_id | number | 用户ID |
| username | string | 用户名 |
| steam_link | string | Steam链接 |
| screenshot_urls | array | 截图URL数组 |
| status | number | 状态：0=审核中，1=已通过，2=已拒绝 |
| reject_reason | string | 拒绝原因（仅status=2时有值） |
| created_at | string | 提交时间 |
| updated_at | string | 更新时间 |
| reviewed_by | number | 审核人ID（已审核时有值） |
| reviewed_at | string | 审核时间（已审核时有值） |

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供 token
- `登录已失效，请重新登录` (401) - token 不存在
- `登录已过期，请重新登录` (401) - token 已过期
- `权限不足，需要管理员权限` (403) - 不是管理员
- `查询申请总数失败` (500) - 查询总数时数据库错误
- `查询申请记录失败` (500) - 数据库错误

---

### POST /admin/applications/approve

通过申请。**需要管理员权限**

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer admin_token_here
```

**请求体**
```json
{
  "id": 1
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | number | 是 | 申请ID |

**成功响应** (200)
```json
{
  "message": "申请已通过"
}
```

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供token
- `权限不足，需要管理员权限` (403) - 不是管理员
- `请求格式错误` (400) - JSON格式错误
- `申请ID无效` (400) - ID小于等于0
- `申请不存在` (404) - 申请不存在
- `只能审核状态为审核中的申请` (400) - 申请已被审核
- `通过申请失败` (500) - 数据库错误

---

### POST /admin/applications/reject

拒绝申请。**需要管理员权限**

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer admin_token_here
```

**请求体**
```json
{
  "id": 1,
  "reject_reason": "截图不清晰，请重新上传"
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | number | 是 | 申请ID |
| reject_reason | string | 是 | 拒绝原因 |

**成功响应** (200)
```json
{
  "message": "申请已拒绝"
}
```

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供token
- `权限不足，需要管理员权限` (403) - 不是管理员
- `请求格式错误` (400) - JSON格式错误
- `申请ID无效` (400) - ID小于等于0
- `拒绝原因不能为空` (400) - 未提供拒绝原因
- `申请不存在` (404) - 申请不存在
- `只能审核状态为审核中的申请` (400) - 申请已被审核
- `拒绝申请失败` (500) - 数据库错误

---

### GET /admin/users

获取所有用户信息（支持分页和搜索）。**需要管理员权限**

**请求方法**: `GET`

**请求头**: 
```
Authorization: Bearer admin_token_here
```

**Query参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认1 |
| page_size | number | 否 | 每页数量，默认20，最大100 |
| search | string | 否 | 搜索用户名/邮箱/QQ（模糊匹配） |
| role | number | 否 | 筛选角色：1=普通用户，2=管理员，3=超级管理员 |
| status | number | 否 | 筛选状态：0=封禁，1=正常 |

**成功响应** (200)
```json
{
  "total": 50,
  "page": 1,
  "page_size": 20,
  "total_page": 3,
  "data": [
    {
      "uid": 1,
      "username": "testuser",
      "email": "user@example.com",
      "avatar": "{API_BASE_URL}/files/avatars/xxx.jpg",
      "avatar_frame":"{API_BASE_URL}/files/avatars/xxx.jpg",
      "name_color": "#FF0000",
      "qq": "123456789",
      "role": 1,
      "status": 1,
      "created_at": "2026-02-09 10:00:00",
      "updated_at": "2026-02-09 12:00:00"
    }
  ]
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| total | number | 总用户数 |
| page | number | 当前页码 |
| page_size | number | 每页数量 |
| total_page | number | 总页数 |
| data | array | 用户列表 |

**data数组元素字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| uid | number | 用户ID |
| username | string | 用户名 |
| email | string | 邮箱地址 |
| avatar | string/null | 头像URL |
| avatar_frame | string/null | 当前佩戴的头像框 URL（可为 null） |
| name_color | string/null | 名字颜色，如 #RRGGBB（可为 null） |
| qq | string/null | QQ号 |
| role | number | 角色：1=普通用户，2=管理员，3=超级管理员 |
| status | number | 状态：0=封禁，1=正常 |
| created_at | string | 注册时间 |
| updated_at | string | 更新时间 |

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供 token
- `权限不足，需要管理员权限` (403) - 不是管理员
- `查询用户总数失败` (500) - 查询总数时数据库错误
- `查询用户列表失败` (500) - 数据库错误

---

### PUT /admin/users

更新用户信息。**需要管理员权限**

**请求方法**: `PUT`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer admin_token_here
```

**请求体**
```json
{
  "uid": 1,
  "username": "newname",
  "email": "newemail@example.com",
  "password": "newpassword123",
  "avatar": "{API_BASE_URL}/files/avatars/new.jpg",
  "avatar_frame": "{API_BASE_URL}/files/frames/xxx.png",
  "name_color": "#00FF00",
  "qq": "987654321",
  "role": 2,
  "status": 0
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uid | number | 是 | 用户ID |
| username | string | 否 | 新用户名 |
| email | string | 否 | 新邮箱 |
| password | string | 否 | 新密码（管理员可直接设置，无需旧密码） |
| avatar | string | 否 | 新头像URL |
| avatar_frame | string/null | 否 | 新头像框URL；传空字符串可清空 |
| name_color | string/null | 否 | 名字颜色，如 #RRGGBB；传空字符串可清空 |
| qq | string | 否 | 新QQ号 |
| role | number | 否 | 新角色：1=普通用户，2=管理员，3=超级管理员 |
| status | number | 否 | 新状态：0=封禁，1=正常 |

**约束**：除uid外，至少需要提供一个字段

**成功响应** (200)
```json
{
  "message": "更新成功"
}
```

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供token
- `权限不足，需要管理员权限` (403) - 不是管理员
- `请求格式错误` (400) - JSON格式错误
- `用户ID无效` (400) - UID小于等于0
- `用户不存在` (404) - 用户不存在
- `用户名不能为空` (400) - 用户名为空字符串
- `用户名已被占用` (400) - 用户名重复
- `邮箱不能为空` (400) - 邮箱为空字符串
- `邮箱已被占用` (400) - 邮箱重复
- `密码不能为空` (400) - 密码为空字符串
- `密码加密失败` (500) - 服务器错误
- `角色值无效，必须是1-3` (400) - 角色值不在1-3范围
- `状态值无效，必须是0或1` (400) - 状态值不是0或1
- `没有需要更新的字段` (400) - 未提供任何更新字段
- `更新用户信息失败` (500) - 数据库错误

**说明**

- 可以更新任意用户的任意字段
- 可以只更新部分字段
- 用户名和邮箱会检查重复
- 可以修改用户角色和状态（封禁/解封）
- **管理员修改密码无需提供旧密码**，直接设置新密码
- **当管理员修改用户密码时，该用户的 token 会被清除**，强制其重新登录
- **重要**：当封禁用户（status改为0）时，该用户所有审核中和已通过的申请会自动变为"已拒绝"，拒绝原因为"您已被封禁"

---

### GET /admin/users/avatar-frames

管理员获取指定用户已解锁的头像框列表。**需要管理员权限**

**请求方法**: `GET`

**请求头**: 
```
Authorization: Bearer admin_token_here
```

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uid | number | 是 | 用户 ID |

**成功响应** (200)
```json
[
  {
    "id": 1,
    "image_url": "{API_BASE_URL}/files/frames/frame1.png"
  }
]
```

**响应说明**：与 `GET /avatar-frames` 单条结构相同，仅返回该用户已解锁的头像框。

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供 token
- `权限不足，需要管理员权限` (403) - 不是管理员
- `缺少参数 uid` (400) - 未传 uid
- `uid 无效` (400) - uid 非正整数
- `查询已解锁头像框失败` (500) - 数据库错误

---

### POST /admin/users/avatar-frames

管理员为用户解锁某个头像框。**需要管理员权限**

**请求方法**: `POST`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer admin_token_here
```

**请求体**
```json
{
  "uid": 1,
  "avatar_frame_id": 2
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uid | number | 是 | 用户 ID |
| avatar_frame_id | number | 是 | 头像框 ID |

**成功响应** (200)
```json
{
  "message": "已解锁"
}
```

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供 token
- `权限不足，需要管理员权限` (403) - 不是管理员
- `请求格式错误` (400) - JSON 格式错误
- `uid 和 avatar_frame_id 必须大于 0` (400) - 参数无效
- `用户不存在` (404) - 对应用户不存在
- `头像框不存在` (404) - 对应头像框不存在
- `解锁失败` (500) - 数据库错误

**说明**：若用户已解锁该头像框，不会报错，直接返回成功。

---

### DELETE /admin/users/avatar-frames

管理员为用户加锁（取消）某个头像框。**需要管理员权限**

**请求方法**: `DELETE`

**请求头**: 
```
Content-Type: application/json
Authorization: Bearer admin_token_here
```

**请求体**
```json
{
  "uid": 1,
  "avatar_frame_id": 2
}
```

**请求字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uid | number | 是 | 用户 ID |
| avatar_frame_id | number | 是 | 头像框 ID |

**成功响应** (200)
```json
{
  "message": "已加锁"
}
```

**错误响应**

```json
{"error": "错误描述"}
```

**可能的错误信息**：
- `请先登录` (401) - 未提供 token
- `权限不足，需要管理员权限` (403) - 不是管理员
- `请求格式错误` (400) - JSON 格式错误
- `uid 和 avatar_frame_id 必须大于 0` (400) - 参数无效
- `该用户未解锁此头像框` (400) - 无对应解锁记录
- `加锁失败` (500) - 数据库错误

---

### GET /admin/banned-email-domains

管理员获取封禁的邮箱域名列表。**需要管理员权限**

**请求方法**: `GET`

**请求头**: `Authorization: Bearer admin_token_here`

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| page_size | number | 否 | 每页条数，默认 20，最大 100 |

**成功响应** (200)
```json
{
  "total": 5,
  "page": 1,
  "page_size": 20,
  "total_page": 1,
  "data": [
    {"id": 1, "domain": "ibymain.com", "created_at": "2026-02-10T12:00:00Z"}
  ]
}
```

---

### POST /admin/banned-email-domains

管理员添加封禁的邮箱域名。**需要管理员权限**

**请求方法**: `POST`

**请求头**: `Content-Type: application/json`、`Authorization: Bearer admin_token_here`

**请求体**
```json
{"domain": "ibymain.com"}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| domain | string | 是 | 邮箱域名（如 ibymain.com），可带 @ 前缀会自动去除 |

**成功响应** (200): `{"message": "已添加"}`

**错误**：`该域名已在封禁列表中` (400)、`domain 不能为空` (400)、`domain 应为纯域名` (400)

---

### DELETE /admin/banned-email-domains

管理员解除邮箱域名封禁。**需要管理员权限**

**请求方法**: `DELETE`

**请求头**: `Content-Type: application/json`、`Authorization: Bearer admin_token_here`

**请求体**：`{"domain": "ibymain.com"}`

**成功响应** (200): `{"message": "已解除"}`

**错误**：`请求格式错误` (400)、`domain 不能为空` (400)、`该域名不在封禁列表中` (404)、`操作失败` (500)

---

## 10. AI 对话

### POST /ai/chat

代理请求到 DeepSeek 对话 API（与 OpenAI 兼容格式）。**需要登录认证**

**请求方法**: `POST`

**请求头**: `Content-Type: application/json`、`Authorization: Bearer your_token_here`

**请求体**（与 OpenAI Chat Completions 兼容）
```json
{
  "model": "deepseek-chat",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| model | string | 模型：`deepseek-chat`（非思考）或 `deepseek-reasoner`（思考模式） |
| messages | array | 对话消息列表 |
| stream | boolean | 是否流式输出，默认 false |

**成功响应** (200)：原样返回 DeepSeek API 的响应

**错误响应**：`AI 服务未配置` (503)、`请求 DeepSeek 失败` (502)

**说明**：需配置环境变量 `DEEPSEEK_API_KEY`，否则返回 503

---

## 11. 123 云盘

以下接口用于获取 123 云盘 access_token 及上传文件到 123 云盘目录，**无需登录**。需在服务端配置 `PAN123_CLIENT_ID` 与 `PAN123_CLIENT_SECRET`（或环境变量），否则 token 不可用。

### GET /pan123/token

获取当前可用的 123 云盘 access_token（由服务端刷新并缓存）。

**请求方法**: `GET`

**请求头**: 无特殊要求

**成功响应** (200)
```json
{
  "token": "eyJ..."
}
```

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 405 | `{"error":"Method not allowed"}` | 非 GET 方法 |
| 503 | `{"error":"123云盘 token 暂不可用，请稍后重试"}` | 未配置或 token 刷新失败 |

---

### POST /pan123/upload

上传单个文件到 123 云盘指定目录，返回下载链接与文件 ID。**无需登录**。

**请求方法**: `POST`

**请求头**: `Content-Type: multipart/form-data`

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 单个文件，最大 1GB |

**成功响应** (200)
```json
{
  "download_url": "https://...",
  "file_id": "12345"
}
```

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | `{"error":"请求体过大或格式错误"}` | 未解析为 multipart 或超过 1GB |
| 400 | `{"error":"请选择要上传的文件"}` | 未提供 file 字段 |
| 400 | `{"error":"文件大小不能超过 1GB"}` | 文件超过 1GB |
| 502 | `{"error":"..."}` | 调用 123 云盘 API 失败（具体信息见 error） |
| 503 | `{"error":"123云盘 token 暂不可用，请稍后重试"}` | token 不可用 |
| 500 | 创建临时文件失败 / 读取文件失败 / 关闭临时文件失败 | 服务器错误 |

---

## 附录

### 环境变量配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| PORT | 4004 | 服务器端口 |
| ENV | development | 运行环境 |
| BUNDLES_PATH | bundles | 资源包目录路径 |
| UPLOAD_PATH | upload | 上传文件目录 |
| BASE_URL | - | 下载链接的基础 URL（留空则自动检测） |
| NOTIFY_API_URL | 由部署者配置 | 审核通知 API 根地址（提交/通过/拒绝申请时调用） |
| DEEPSEEK_API_KEY | - | DeepSeek API Key，留空则 AI 对话接口不可用 |
| PAN123_BASE_URL | https://open-api.123pan.com | 123 云盘开放平台 API 根地址 |
| PAN123_CLIENT_ID | - | 123 云盘 ClientID，与 ClientSecret 同时配置时启用 /pan123 接口 |
| PAN123_CLIENT_SECRET | - | 123 云盘 ClientSecret |
| DB_HOST | localhost | 数据库主机地址 |
| DB_NAME | adofaionline | 数据库名称 |
| DB_USER | adofaionline | 数据库用户名 |
| DB_PASS | - | 数据库密码（未设置时使用默认） |
| SMTP_HOST | smtp.163.com | SMTP 服务器地址 |
| SMTP_PORT | 465 | SMTP 端口 |
| SMTP_USER | - | SMTP 用户名 |
| SMTP_PASS | - | SMTP 密码 |
| SMTP_FROM_NAME | RDOnline | 发件人名称 |

### 数据库表结构

#### users 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 用户 ID（主键，自增） |
| username | varchar(50) | 用户名（唯一） |
| password | varchar(255) | 密码（bcrypt 加密） |
| email | varchar(100) | 邮箱（唯一） |
| avatar | varchar(255) | 头像 URL |
| avatar_frame | varchar(255) | 头像框 URL |
| name_color | varchar(32) | 名字颜色，如 #RRGGBB |
| qq | varchar(20) | QQ 号 |
| status | tinyint | 状态：0=封禁，1=正常 |
| role | tinyint | 角色：1=普通用户，2=管理员，3=超级管理员 |
| token | varchar(255) | 登录 token（存于用户表，修改密码时清除） |
| token_expires_at | datetime | token 过期时间 |
| profile_updated_at | datetime | 资料（用户名/头像框）更新时间 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

#### verification_codes 表

| 字段 | 类型 | 说明 |
|------|------|------|
| email | varchar(100) | 邮箱地址 |
| code | varchar(6) | 验证码 |
| expires_at | timestamp | 过期时间 |

#### avatar_frames 表（头像框）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 头像框 ID（主键，自增） |
| image_url | varchar(255) | 头像框图片 URL |
| sort_order | int | 排序，越小越靠前 |
| created_at | datetime | 创建时间 |

#### user_avatar_frames 表（用户头像框解锁）

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | int | 用户 ID（外键） |
| avatar_frame_id | int | 头像框 ID（外键） |
| unlocked_at | datetime | 解锁时间 |
| 主键 | (user_id, avatar_frame_id) | 联合主键 |

#### device_codes 表（设备码）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 主键，自增 |
| user_id | int | 用户 ID（外键，关联 users.id，ON DELETE CASCADE） |
| device_code | char(6) | 六位设备码（数字或大写字母+数字，可由接口生成或游戏客户端生成） |
| created_at | datetime | 绑定时间 |
| 唯一约束 | (user_id, device_code) | 同一用户下设备码不重复 |
| 业务限制 | - | 每用户最多 2 条记录（由接口层保证） |

#### banned_email_domains 表（封禁邮箱域名）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 主键，自增 |
| domain | varchar(100) | 邮箱域名（如 ibymain.com），唯一 |
| created_at | datetime | 添加时间 |
| 说明 | - | 该域名下的邮箱无法注册（发送验证码、注册时均会拒绝） |

### 常见问题

#### 1. 返回 400 错误怎么办？

**查看错误信息**：所有错误都在响应的 `error` 字段中，直接显示给用户即可。

```javascript
fetch('...').then(res => res.json()).then(data => {
  if (data.error) {
    alert(data.error); // 直接显示错误信息
  }
});
```

#### 2. CORS 跨域问题

**现象**：浏览器控制台显示 CORS 错误

**解决**：服务器已配置CORS，确保：
- 服务器正常运行
- 请求包含 `Content-Type: application/json`

#### 3. 验证码相关问题

**验证码格式**：6位字母数字混合（如 `gl7lsy`），不区分大小写

**常见错误**：
- `请先获取验证码` - 先调用发送验证码接口
- `验证码已被使用，请重新获取` - 每个验证码只能用一次
- `验证码已过期，请重新获取` - 验证码10分钟有效
- `验证码错误` - 检查输入是否正确

#### 4. 数据库未连接（503错误）

**现象**：认证相关接口返回 `Authentication service is currently unavailable. Database connection failed.`；需登录接口返回 `服务暂时不可用，数据库未连接`

**解决**：联系后端管理员检查数据库连接

---

## 更新日志

### v1.1.0 (2026-02-10)

**新增功能**:
- ✅ DeepSeek AI 对话接口 `POST /ai/chat`（需登录，需配置 DEEPSEEK_API_KEY）
- ✅ 封禁邮箱域名管理：`GET/POST/DELETE /admin/banned-email-domains`
- ✅ 设备码生成与校验：`GET /verify/device-code` 不传参可生成六位设备码
- ✅ 审核通知：提交申请、通过/拒绝时调用通知 API
- ✅ Bundle 上传：`POST /upload/bundle` 上传平台 zip 并解压

**改进**:
- 🔧 Token 存于 users 表，移除 user_tokens 表
- 🔧 管理员修改用户密码 / 用户自己修改密码后，token 立即失效，需重新登录
- 🔧 管理员通过申请后自动解封该用户
- 🔧 封禁账号允许登录，仅限制设备码绑定等部分功能

---

### v1.0.0 (2026-02-09)

**新增功能**:
- ✅ 完整的 CORS 支持
- ✅ 请求日志中间件
- ✅ Content-Type 验证
- ✅ 统一的 JSON 错误响应
- ✅ 数据库连接失败时的优雅降级（返回 503）

**修复问题**:
- 🐛 修复跨域请求被阻止的问题
- 🐛 修复 Content-Type 错误导致的 400 错误
- 🐛 修复数据库未连接时路由 404 的问题
- 🐛 修复错误响应格式不统一的问题

**改进**:
- 📝 完善 API 文档，添加详细的错误信息说明
- 🔧 添加数据库连接超时设置
- 🔧 改进错误信息的可读性
- 🔧 添加请求日志，便于调试
