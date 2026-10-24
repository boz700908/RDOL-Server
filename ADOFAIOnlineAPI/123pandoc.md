# 123云盘开放平台 - 获取 access_token

## 接口说明
API：`POST` 域名 + `/api/v1/access_token`

⚠️ 注：此接口有访问频率限制。请获取到 `access_token` 后本地保存使用，并在 `access_token` 过期前及时重新获取。`access_token` 有效期根据返回的 `expiredAt` 字段判断。

---

## Header 参数

| 名称 | 类型 | 是否必填 | 说明 |
|------|------|----------|------|
| Platform | string | 是 | open_platform |

---

## Body 参数

| 名称 | 类型 | 是否必填 | 说明 |
|------|------|----------|------|
| clientID | string | 必填 | - |
| clientSecret | string | 必填 | - |

---

## 返回数据

| 名称 | 类型 | 是否必填 | 说明 |
|------|------|----------|------|
| accessToken | string | 必填 | 访问凭证 |
| expiredAt | string | 必填 | access_token 过期时间 |

---

## 请求示例

### Curl
```shell
curl --location 'https://open-api.123pan.com/api/v1/access_token' \
--header 'Platform: open_platform' \
--header 'Content-Type: application/json' \
--data '{
"clientID": "123456789",
"clientSecret": "123456789"
}'
```



## 响应示例

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyxxxxx...",
    "expiredAt": "2025-03-23T15:48:37+08:00"
  },
  "x-traceID": "16f60c4d-f022-42d3-b3df-85d1fe2a3ac5_kong-db-5898fdd8c6-wgsts"
}
```

---




# 创建目录
## 接口信息
- **请求方式**：POST
- **接口地址**：`/upload/v1/file/mkdir`

## 请求头（Header）参数
| 名称          | 类型    | 是否必填 | 说明                     |
| ------------- | ------- | -------- | ------------------------ |
| Authorization | string  | 是       | 鉴权 access_token        |
| Platform      | string  | 是       | 固定值：open_platform    |

## 请求体（Body）参数
| 名称      | 类型    | 是否必填 | 说明                                   |
| --------- | ------- | -------- | -------------------------------------- |
| name      | string  | 是       | 目录名称，不可重名                     |
| parentID  | number  | 是       | 父目录 ID，上传至根目录时填写 0        |

## 响应参数
| 名称  | 类型   | 是否必填 | 说明           |
| ----- | ------ | -------- | -------------- |
| dirID | number | 是       | 创建成功的目录 ID |

## 响应结构说明
- 正常返回包含 `code`、`message`、`data` 及 `x-traceID` 字段，其中 `data` 中返回创建的目录 ID。



【上传流程说明】
# 上传流程说明

## 分片上传

### 1. 创建文件
- 调用创建文件接口，接口返回 `reuse` 为 `true` 时，表示秒传成功，上传结束。
- 非秒传情况将会返回预上传ID `preuploadID` 与分片大小 `sliceSize`，请将文件根据分片大小切分。
- 非秒传情况下返回 `servers` 为后续上传文件的对应域名（重要），多个任选其一。

### 2. 上传分片
- 按照 `sliceSize` 将文件切分，并计算每个分片的MD5。
- 调用上传分片接口，传入对应参数，此步骤 `Content-Type: multipart/form-data`。

### 3. 上传完毕
- 调用上传完毕接口，若接口返回 `completed` 为 `true` 且 `fileID` 不为0时，上传完成。
- 若接口返回 `completed` 为 `false` 时，则需间隔1秒继续轮询此接口，获取上传最终结果。

---

## 单步上传

### 1. 获取上传域名
- 调用该接口，在接口返回中获得多个上传域名，后续上传任务需要使用。

### 2. 发起上传
- 计算文件MD5；
- 使用获取到的上传域名发起上传；
- 此步骤 `Content-Type: multipart/form-data`。


【创建文件】
# 123云盘开放平台 - 创建文件（V2）
## 接口信息
- **接口地址**：POST 域名 + `/upload/v2/file/create`
- **接口说明**：用于创建文件并启动上传流程，支持秒传、分片上传等能力

## 文件名与大小约束
1. 文件名长度小于 256 字符
2. 禁止包含字符：`"\/:*?|><`
3. 文件名不能全部为空格
4. 单文件大小限制：10GB

## Header 参数
| 名称          | 类型   | 是否必填 | 说明                     |
| ------------- | ------ | -------- | ------------------------ |
| Authorization | string | 必填     | 鉴权 access_token        |
| Platform      | string | 必填     | 固定值：`open_platform`  |

## Body 参数
| 名称         | 类型    | 是否必填 | 说明                                                                 |
| ------------ | ------- | -------- | -------------------------------------------------------------------- |
| parentFileID | number  | 必填     | 父目录 ID，上传至根目录时填 `0`                                       |
| filename     | string  | 必填     | 文件名（<255字符，禁止特殊字符，不可重名）；`containDir=true` 时可传路径+文件名 |
| etag         | string  | 必填     | 文件 MD5 值                                                          |
| size         | number  | 必填     | 文件大小，单位：byte（字节）                                          |
| duplicate    | number  | 非必填   | 同名文件处理策略：1-保留两者（新文件自动加后缀）；2-覆盖原文件        |
| containDir   | bool    | 非必填   | 是否包含路径，默认 `false`                                            |

## 返回数据
| 名称        | 类型    | 是否必填 | 说明                                                         |
| ----------- | ------- | -------- | ------------------------------------------------------------ |
| fileID      | number  | 非必填   | 文件 ID；文件已存在（秒传）时返回，全局唯一                   |
| preuploadID | string  | 必填     | 预上传 ID；`reuse=true` 时该字段不存在                       |
| reuse       | boolean | 必填     | 是否秒传，`true` 表示文件已存在、上传直接成功                |
| sliceSize   | number  | 必填     | 分片大小，需按此大小拆分文件后上传                           |
| servers     | array   | 必填     | 上传地址列表                                                 |

【上传分片】
# 上传分片

## 接口信息
- **请求方式**：POST
- **接口地址**：上传域名 + `/upload/v2/file/slice`
  - 上传域名取自 **创建文件** 接口响应中的 `servers` 字段
- **Content-Type**：`multipart/form-data`

## Header 参数

| 名称          | 类型   | 是否必填 | 说明                     |
| ------------- | ------ | -------- | ------------------------ |
| Authorization | string | 是       | 鉴权 `access_token`      |
| Platform      | string | 是       | 固定值：`open_platform`  |

## Body 参数

| 名称        | 类型   | 是否必填 | 说明                           |
| ----------- | ------ | -------- | ------------------------------ |
| preuploadID | string | 是       | 预上传ID                       |
| sliceNo     | number | 是       | 分片序号，从 1 开始自增        |
| sliceMD5    | string | 是       | 当前分片文件 MD5 值            |
| slice       | file   | 是       | 分片二进制流（文件分片）       |

## 返回数据
无业务数据返回，仅返回通用响应结构。

## 响应说明
- 正常响应：`code: 0`，`message: "ok"`，`data: null`
- 异常场景：返回对应错误码与错误描述

【上传完毕】
# 123云盘开放平台 API 文档 - 上传完毕
## 接口信息
- **接口地址**：`POST 域名 + /upload/v2/file/upload_complete`
- **说明**：分片上传完成后请求

---

## Header 参数
| 名称            | 类型   | 是否必填 | 说明                     |
| --------------- | ------ | -------- | ------------------------ |
| Authorization   | string | 必填     | 鉴权 access_token        |
| Platform        | string | 必填     | 固定为: open_platform    |

---

## Body 参数
| 名称         | 类型   | 是否必填 | 说明       |
| ------------ | ------ | -------- | ---------- |
| preuploadID  | string | 必填     | 预上传ID   |

---

## 返回数据
| 名称        | 类型   | 是否必填 | 说明           |
| ----------- | ------ | -------- | -------------- |
| completed   | bool   | 必填     | 上传是否完成   |
| fileID      | number | 必填     | 上传完成文件id |

【获取上传域名】
# 获取上传域名
## 接口信息
- 请求方式：`GET`
- 接口地址：`/upload/v2/file/domain`

## 请求头（Header）参数
| 名称            | 类型     | 是否必填 | 说明                     |
| --------------- | -------- | -------- | ------------------------ |
| Authorization   | string   | 必填     | 鉴权 access_token        |
| Platform        | string   | 必填     | 固定值：open_platform    |

## 请求体（Body）参数
无

## 响应参数
| 名称  | 类型  | 是否必填 | 说明                     |
| ----- | ----- | -------- | ------------------------ |
| data  | array | 必填     | 上传域名列表，可任选其一 |

## 响应说明
接口返回上传域名数组，业务侧可从返回结果中选取任意一个域名用于后续文件上传操作。

【单步上传】
# 单步上传

## 接口信息
- **请求方式**：POST
- **接口地址**：上传域名 + `/upload/v2/file/single/create`
- **说明**：
  - 文件名要小于256个字符且不能包含以下任何字符：`"\/:*?|><`
  - 文件名不能全部是空格
  - 此接口限制开发者上传单文件大小为 1GB
  - 上传域名是「获取上传域名」接口响应中的域名
  - 此接口用于实现小文件单步上传，一次 HTTP 请求交互即可完成上传

---

## Header 参数

| 名称          | 类型   | 是否必填 | 说明                     |
| ------------- | ------ | -------- | ------------------------ |
| Authorization | string | 必填     | 鉴权 access_token        |
| Platform      | string | 必填     | 固定为：`open_platform`  |

---

## Body 参数

| 名称         | 类型    | 是否必填 | 说明                                                         |
| ------------ | ------- | -------- | ------------------------------------------------------------ |
| parentFileID | number  | 必填     | 父目录 id，上传到根目录时填写 0                              |
| filename     | string  | 必填     | 文件名要小于255个字符且不能包含以下任何字符：`'\/:*?|><`（注：不能重名）；containDir 为 true 时，传入路径+文件名，例如：`/你好/123/测试文件.mp4` |
| etag         | string  | 必填     | 文件 md5                                                     |
| size         | number  | 必填     | 文件大小，单位为 byte 字节                                   |
| file         | file    | 必填     | 文件二进制流                                                 |
| duplicate    | number  | 非必填   | 当有相同文件名时，文件处理策略（1 保留两者，新文件名将自动添加后缀；2 覆盖原文件） |
| containDir   | bool    | 非必填   | 上传文件是否包含路径，默认 false                             |

---

## 返回数据

| 名称      | 类型   | 是否必填 | 说明                                                         |
| --------- | ------ | -------- | ------------------------------------------------------------ |
| fileID    | number | 必填     | 文件 ID。当123云盘已有该文件，则会发生秒传。此时会将文件 ID 字段返回，唯一 |
| completed | bool   | 必填     | 是否上传完成（completed 为 true 时，表示上传完成）           |

