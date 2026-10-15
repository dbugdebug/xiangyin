# 乡音心伴后端部署教程（Cloudflare Workers + Supabase Hyperdrive）

适用目录：本文件所在的「乡音心伴-共享后端版」。本教程只重新部署后端；**已经部署的前端不用改，API 域名和接口路径不变**。

- 前端：`https://ccup.us.ci`（Pages 备用域名 `https://xiangyin.pages.dev` 也允许跨域）
- 后端：`https://api.ccup.us.ci`
- 数据库：现有 Supabase PostgreSQL，通过 Cloudflare Hyperdrive 连接
- 登录：演示验证码模式，手机号 + 任意非空验证码，不会发送短信

## 开始前先知道

1. `schema.sql` **不要再执行**。程序沿用现有表，不新增、不改表结构；用户写入现有的 `"user"` 表。
2. Wrangler 配置关联现有 Hyperdrive id `665804f817b44c82a7e1456dc1521502`；如果你账户里这个 id 不存在，去 Cloudflare → Workers & Pages → Hyperdrive 检查/新建并替换 `wrangler.jsonc` 中的 id。
3. 演示验证码只用于联调/演示：输入任何非空字符串都能通过。不要把它当作真实手机号验证或生产级账号安全机制。
4. 老人、预警、绑定等现有 `/api/*` 路由保留；新增的 `/api/demo-login` 和 `/api/me` 对齐当前线上前端。部署不需要重新发布 Pages。

## 第 1 步：安装本机工具

Mac 打开「终端」，检查工具：

```bash
uv --version
node --version
npm --version
```

若没有 uv，按 [uv 官方安装说明](https://docs.astral.sh/uv/getting-started/installation/)安装；Node.js 可从 [nodejs.org](https://nodejs.org/)安装 LTS 版。安装后重新打开终端。

## 第 2 步：进入后端包目录

假设整个 youlai 文件夹在「下载」目录：

```bash
cd ~/Downloads/youlai/1-给同学的后端包/乡音心伴-共享后端版
```

如果目录不存在，终端输入 `cd `（cd 后有空格），将 Finder 中的「乡音心伴-共享后端版」文件夹拖进终端，再回车。确认关键文件：

```bash
pwd
ls
```

应能看到 `app.py`、`worker.py`、`wrangler.jsonc`、`pyproject.toml`。

## 第 3 步：登录 Cloudflare

```bash
npx wrangler login
```

浏览器弹出授权页时，登录部署了 `api.ccup.us.ci` 的同一个账号并点允许。后端从本机终端发布，不要在 Pages 的构建命令栏运行。

## 第 4 步：保存登录签名密钥

先生成随机密钥：

```bash
openssl rand -hex 32
```

复制输出的字符串，再运行：

```bash
npx wrangler secret put AUTH_SECRET --name xiangyin-xinban-api
```

提示输入时粘贴刚才的密钥并回车。屏幕不显示输入字符是正常的。密钥保存在 Cloudflare Worker Secrets，不在项目文件里。不要把密钥发给别人或写进 wrangler.jsonc。

若报找不到 Worker，先运行下一步部署，再重复设置 secret，然后重新部署一次。

## 第 5 步：发布后端

仍在后端包目录运行：

```bash
uv run pywrangler deploy
```

首次运行会下载 Python/Worker 构建依赖，请等待成功提示。确认部署目标名称是 `xiangyin-xinban-api`。

Wrangler 配置已设 `DB_MODE=postgres`、`AUTH_MODE=demo` 并绑定现有 Hyperdrive；这里不需要配置 `DB_HOST`、数据库密码或重新创建数据库。可用 `npx wrangler whoami` 检查当前 Cloudflare 登录账号。

### 命令报错时

- `Unknown arguments: log-level`：部署命令后不要追加 `--log-level debug`，使用上面那条命令。
- `Hyperdrive config not found`：检查 Wrangler 登录账号及 wrangler.jsonc 中的 Hyperdrive id。
- `AUTH_SECRET missing`：回到第 4 步设置 secret 后重新部署。
- 找不到 Python 入口或 Flask：确认当前目录是后端包目录，并能看到 `worker.py`、`pyproject.toml`。
- 发布成功但仍运行旧代码：Cloudflare → Workers & Pages → `xiangyin-xinban-api` → Deployments 查看最新部署状态和时间。

## 第 6 步：确认 API 自定义域名

打开 Cloudflare Dashboard：

1. 进入 **Workers & Pages** → `xiangyin-xinban-api` → **Settings** → **Domains & Routes**。
2. 确认 `api.ccup.us.ci` 指向这个 Worker。
3. 如果域名已经绑定在原 Worker 上，不要重复添加；更新同名 Worker 时绑定通常保留。如果没有，选择 **Add → Custom Domain**，输入 `api.ccup.us.ci` 并确认。
4. 等待域名状态显示 Active/已激活。

不要把前端 `ccup.us.ci` 改到 API Worker；Pages 站点继续留在原位置。

## 第 7 步：检查健康检查和跨域

浏览器打开：

- `https://api.ccup.us.ci/api/ping` 应显示 `{"ok":true,"service":"xiangyin"}`。
- `https://api.ccup.us.ci/api/me` 未登录时显示「登录已失效，请重新登录」，HTTP 401 是预期结果。

终端检查浏览器跨域预检：

```bash
curl -i -X OPTIONS 'https://api.ccup.us.ci/api/me' \
  -H 'Origin: https://ccup.us.ci' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

响应头应包含：

```text
Access-Control-Allow-Origin: https://ccup.us.ci
Access-Control-Allow-Headers: Authorization, Content-Type
```

`xiangyin.pages.dev` 是另一个被允许的 Origin。确认浏览器当前页面地址是 `ccup.us.ci` 或 `xiangyin.pages.dev`。

## 第 8 步：从前端注册并登录

在 `https://ccup.us.ci` 打开登录页：

1. 注册时填写手机号、姓名、角色等前端要求的资料。
2. 验证码框填任意非空内容，例如 `123456`；系统不会真的发送短信。
3. 注册成功后退出，再使用同一手机号和任意非空验证码登录。
4. 登录后前端会请求 `GET /api/me`，成功响应应包含 `ok: true`、`user_id`、`role`。401 表示 token 未发送或已过期；500 则查看下一节的 Worker Logs。
5. 用另一个浏览器或无痕窗口再注册一个账号，账号都应写入同一个 Supabase 数据库，说明多端已连通共享云数据。

## 常见故障定位

| 表现 | 先检查 | 处理方式 |
|---|---|---|
| `/api/ping` 404 | Worker 域名绑定 | `api.ccup.us.ci` 要绑定 `xiangyin-xinban-api` |
| 浏览器报 CORS | 页面地址和 Worker Logs | 页面 Origin 应为两个已放行的域名之一；确认最新 Worker 部署完成 |
| `/api/me` 返回 401 | 登录状态 | 先走前端登录，检查请求头是否含 `Authorization: Bearer ...`，确认 AUTH_SECRET 已设后重新登录 |
| 登录时报 500 | Workers → Logs → Real-time Logs | 查看 Python traceback；检查 Hyperdrive binding 和现有 `"user"` 表 |
| `Missing HYPERDRIVE binding` | Wrangler 配置 | Hyperdrive id 必须属于当前账号，binding 名必须是 `HYPERDRIVE` |
| `relation "user" does not exist` | Supabase 项目/表 | 确认 Hyperdrive 指向之前建表的 Supabase 项目；不要立即执行建表或改表 |
| 前端还是旧行为 | 浏览器缓存、Pages 状态 | 强制刷新；后端部署不触发 Pages 重建，前端接口地址无需改动 |

Cloudflare 日志位置：**Workers & Pages → xiangyin-xinban-api → Logs → Real-time Logs**。打开后再次操作登录，复制最新失败请求附近的 traceback。浏览器中的「Failed to fetch」只是 500/CORS 的表面现象。

## 文件各自负责什么

- `worker.py`：Flask 的 Cloudflare WSGI 入口。
- `wrangler.jsonc`：Worker 名称、兼容日期、Hyperdrive id 和非敏感变量。
- `pyproject.toml`：Cloudflare Python 构建依赖。
- `db_compat.py`：SQLite/PostgreSQL 适配；线上数据库配置错误会明确报错，不会将临时 SQLite 伪装成云数据库。
- `app.py`：原业务接口、CORS、演示注册登录 API。

后续修改后端，再在这个目录运行 `uv run pywrangler deploy` 更新同一个 Worker；前端仍调用 `https://api.ccup.us.ci/api/...`。
