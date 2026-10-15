# 乡音心伴后端

乡音心伴后端是一个 Flask API，部署在 Cloudflare Python Workers，通过 Hyperdrive 访问 Supabase PostgreSQL。前端已经独立部署，使用跨域请求访问本后端。

## 当前线上地址

| 项目 | 地址 / 配置 |
|---|---|
| 前端主域名 | <https://ccup.us.ci> |
| 前端 Pages 域名 | <https://xiangyin.pages.dev> |
| 后端 API | <https://api.ccup.us.ci> |
| Cloudflare Worker | `xiangyin-xinban-api` |
| 数据库 | Supabase PostgreSQL，经 Cloudflare Hyperdrive 连接 |
| Hyperdrive binding | `HYPERDRIVE` |

## 现在的工作状态

- Cloudflare Python Worker 使用 `worker.py` 启动 Flask WSGI 应用。
- `db_compat.py` 在本地可以使用 SQLite；Cloudflare 请求从 WSGI environ 读取 `HYPERDRIVE`，再用 pg8000 连接 PostgreSQL。
- 线上缺少 Hyperdrive 时会报错，不会退回 Worker 上易失的 SQLite 文件。
- 原有业务 API 路由继续保留；新增 `/api/demo-login` 与 `/api/me`，支持已部署前端的演示验证码登录流程。
- CORS 允许 `https://ccup.us.ci` 和 `https://xiangyin.pages.dev`。
- Supabase 表结构未修改；程序使用现有的 `"user"`、`elders`、`alerts`、`care_messages` 等表。
- 不需要改前端 API URL，也不需要因为后端更新而重新发布 Pages。

## 文件说明

| 文件 | 用途 |
|---|---|
| `app.py` | Flask 应用、原业务 API、注册档案 API、CORS、演示登录和当前用户 API |
| `worker.py` | Cloudflare Python Workers 的 WSGI 入口 |
| `wrangler.jsonc` | Worker 名称、Python Workers 兼容日期、Hyperdrive binding 和公开变量 |
| `pyproject.toml` | Python Worker 构建依赖；`uv run pywrangler` 使用 |
| `db_compat.py` | SQLite / PostgreSQL 连接适配层 |
| `sqlite_backend.py` | 本地 SQLite 数据库初始化及演示数据 |
| `schema.sql` | 当前数据库表结构参考；**已有线上库时不要重复执行** |
| `ai_service.py` | AI 对话与摘要；未配置大模型时使用本地 mock 回复 |
| `.env.example` | 本地开发的环境变量模板，不含真实凭据 |
| `requirements.txt` | 普通 Python 本地运行依赖 |
| `requirements-postgres.txt` | 本机直接运行 PostgreSQL 模式时额外安装的驱动 |
| `frontend_dist/` | 旧版前端构建产物；Cloudflare 后端 Worker 不使用此目录 |
| `后端部署-Cloudflare-保姆级教程.md` | Cloudflare 后端部署的详细逐步教程 |
| `给同学-对接说明.md` | 早期同学本机直连数据库的历史说明，非当前 Cloudflare 部署文档 |

## API 与前端契约

后端地址为 `https://api.ccup.us.ci`。前端继续按原 URL 调用 `/api/...` 路径。

### 登录相关

#### `POST /api/demo-login`

请求体示例：

```json
{
  "phone": "13800000001",
  "code": "123456",
  "role": "elder",
  "name": "演示用户",
  "village": "前院村",
  "elder_phone": "",
  "registering": false
}
```

- 当前为演示验证码模式：`code` 只要求非空，不会实际发送或核验短信。
- `registering: true` 表示注册：新手机号会写入现有 `"user"` 表；已存在手机号返回 409。
- `registering: false` 表示登录：已注册手机号可登录；未注册手机号返回 404。
- 成功返回 `access_token`、`refresh_token`、`expires_at` 和 `user`。
- 注册村协管员时需要填写 `village`。

#### `GET /api/me`

登录后请求头需要携带：

```text
Authorization: Bearer <access_token>
```

成功响应包含 `ok`、`user_id`、`role`、`elder_id` 和 `user`。不带有效 token 时返回 HTTP 401 和「登录已失效，请重新登录」；这是预期行为，不代表 API 故障。

### 原有业务接口

原有老人、对话、情绪、统计、预警、关怀留言、转介和绑定接口仍在 `app.py` 中，包括：

- 对话与 AI：`POST /api/chat`、`GET /api/ai/status`、`POST /api/summary/generate`
- 老人与统计：`GET /api/elders`、`GET /api/elders/<id>`、`GET /api/stats`、`GET /api/screen-stats`
- 情绪与活动：`POST /api/activity`、`GET /api/summaries`、`POST /api/risk-report`
- 预警：`GET /api/alerts`、`POST /api/alerts/<id>/handle`
- 关怀留言：`GET/POST /api/care-messages`、`GET /api/care-message/pending`、`POST /api/care-messages/<id>/conveyed`
- 家属功能：`GET /api/family/elders`、`GET /api/family/elders/<id>/trend`、`GET /api/family/notifications`
- 绑定与转介：`POST /api/bind-elder`、`POST /api/unbind-elder`、`GET /api/bindings`、`POST /api/bind-elders/batch`、`GET /api/referrals`
- 健康检查：`GET /api/ping`
- 账号档案：`POST /api/register`、`GET /api/profile`

具体参数和响应以 `app.py` 中路由实现为准。未列出的辅助路由也没有因本次部署整理而删除。

## 数据库要求

### 表结构

数据库表不变。线上数据继续使用现有 Supabase 项目和既有表，包括：

`"user"`、`elders`、`emotion_records`、`activities`、`alerts`、`family_relations`、`care_messages`、`referrals`、`health_profile`、`emergency_contact`、`elder_binding`。

`schema.sql` 是参考文件。线上表已经存在时不要再执行建表脚本，不要 DROP、TRUNCATE 或 ALTER 这些表。

### Cloudflare 连接

`wrangler.jsonc` 当前绑定名称为 `HYPERDRIVE`，使用此前配置的 Hyperdrive id。若换了 Cloudflare 账号或 Hyperdrive 配置，应先在 Cloudflare Dashboard 确认正确的配置，再替换该 id。

Cloudflare 上 `DB_MODE=postgres`。`db_compat.py` 在请求上下文内读取 Worker binding；Hyperdrive 提供 host、port、user、password、database。不要将 Supabase 数据库密码写入仓库。

### 本地配置

若要在本机运行，可复制 `.env.example` 为 `.env`。默认 `DB_MODE=sqlite`，适合本地演示。若本机直接连 PostgreSQL，再按 `.env.example` 填写连接变量并安装 `requirements-postgres.txt`。本地 `.env` 不要提交到代码仓库。

## Cloudflare 部署

完整步骤和面板截图位置说明见 [后端部署-Cloudflare-保姆级教程.md](后端部署-Cloudflare-保姆级教程.md)。快速步骤如下。

### 1. 进入本目录

```bash
cd ~/Downloads/youlai/1-给同学的后端包/乡音心伴-共享后端版
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

在浏览器授权部署后端的 Cloudflare 账号。

### 3. 设置 Worker 登录签名密钥

生成随机密钥：

```bash
openssl rand -hex 32
```

再运行：

```bash
npx wrangler secret put AUTH_SECRET --name xiangyin-xinban-api
```

将随机值粘贴到提示中。`AUTH_SECRET` 是 Cloudflare Secret，不能写到 `wrangler.jsonc` 或发到群里。若此前已经设置过该 Secret，不需要重复生成。

### 4. 部署

```bash
uv run pywrangler deploy
```

不要在命令后加 `--log-level debug`。发布后在 Cloudflare Dashboard → Workers & Pages → `xiangyin-xinban-api` → Settings → Domains & Routes，确认 `api.ccup.us.ci` 指向该 Worker。

### 配置文件中的关键值

- Worker 名称：`xiangyin-xinban-api`
- `compatibility_date`：`2026-10-15`
- `compatibility_flags`：`python_workers`
- Hyperdrive binding：`HYPERDRIVE`
- `DB_MODE`：`postgres`
- `AUTH_MODE`：`demo`

不要设置 Supabase 密码为普通公开变量。数据库凭据由 Hyperdrive binding 提供，签名密钥由 Worker Secret 提供。

## 部署后的 curl 检查

### 健康检查

```bash
curl -i https://api.ccup.us.ci/api/ping
```

预期 HTTP 200，响应为 `{"ok":true,"service":"xiangyin"}`。

### 浏览器跨域预检

```bash
curl -i -X OPTIONS 'https://api.ccup.us.ci/api/me' \
  -H 'Origin: https://ccup.us.ci' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

预期 HTTP 204，包含 `Access-Control-Allow-Origin: https://ccup.us.ci` 和 `Access-Control-Allow-Headers: authorization`。

### 未登录状态

```bash
curl -i https://api.ccup.us.ci/api/me
```

预期 HTTP 401。必须先通过前端登录获得 token，随后在 `/api/me` 请求中发送 `Authorization: Bearer ...`。

### 当前线上检查记录

2026-10-15 使用 curl 检查时：

- `/api/ping` 返回 HTTP 200。
- `ccup.us.ci` 和 `xiangyin.pages.dev` 两个 Origin 的 `/api/me` 预检均返回 HTTP 204。
- 使用已存在的演示老人手机号走非注册登录，`/api/demo-login` 返回 HTTP 200；临时 token 未输出或保存。
- 将该 token 传给 `/api/me`，返回 HTTP 200。
- 不带 token 请求 `/api/me` 返回 HTTP 401，符合预期。
- 从 `https://ccup.us.ci/` 读取到前端 bundle `index-CM79uYLB.js`，确认其请求 `https://api.ccup.us.ci`、`/api/demo-login` 和 `/api/me`，与当前后端路径一致。

这些是上述时间点的线上请求结果，不代表未来 Cloudflare 配置或浏览器状态不会变化。若用户浏览器仍失败，请在开发者工具 Network 中查看失败请求的 HTTP 状态码、Response 和 Request Headers；仅有 `Failed to fetch` 不足以定位。

## 常见问题

| 现象 | 可能原因 | 检查方式 |
|---|---|---|
| `Unknown arguments: log-level` | Wrangler deploy 不接受该参数 | 使用 `uv run pywrangler deploy` |
| `/api/ping` 404 | 自定义域名绑到别的 Worker | 检查 `api.ccup.us.ci` 的 Domains & Routes |
| 浏览器提示 CORS | Origin 不在允许列表、Worker 尚未更新或页面用了其他域名 | 查看实际页面 Origin 和 OPTIONS 响应头 |
| `/api/me` 401 | 未登录、token 没发送、签名密钥变化或 token 过期 | 重新登录，并确认 Authorization 请求头 |
| 注册返回 409 | 该手机号已在 `"user"` 表注册 | 切换登录流程，不要重复注册 |
| 登录返回 404 | 该手机号尚未注册 | 先选注册流程 |
| 登录返回 500 | Hyperdrive、数据库或 Secret 配置问题 | Cloudflare Worker → Logs → Real-time Logs 查看完整 traceback |
| 数据库表不存在 | Hyperdrive 指向了另一个 Supabase 项目 | 核对 Hyperdrive 的目标数据库；不要盲目重建表 |

## 已知限制与安全注意

- 当前假验证码只检查非空，任何人都能用自己的手机号文本注册演示账号；它不是 SMS OTP，也不证明手机号所有权。
- HMAC Bearer token 有效期为 30 天。更换 `AUTH_SECRET` 会使旧 token 失效，需要重新登录。
- 演示登录不提供短信发送、验证码限流、找回账号或真实身份核验。
- 项目中同时保留 `/api/register` 的密码注册 API；线上前端当前演示模式使用 `/api/demo-login`。
- `frontend_dist/` 是历史产物，实际 Pages 发布不由本 Worker 负责。
- Cloudflare Worker Logs 才包含服务端 traceback；浏览器控制台里的 `Failed to fetch` 或 CORS 报错有时只是服务端 500 的结果。

## 排错时请提供

如果 curl 检查与浏览器表现不同，请提供：

1. 浏览器当前完整页面地址。
2. Network 中失败的请求 URL、HTTP 状态码、Response、Request Headers（删除 Bearer token 和手机号等个人信息后再分享）。
3. 同一时间 Cloudflare Worker Logs 的完整错误堆栈。

不要公开分享 `AUTH_SECRET`、Hyperdrive 数据库凭据、登录 token 或真实手机号。
