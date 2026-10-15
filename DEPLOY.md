# 乡音心伴：零信用卡部署指南

本指南把前端部署到 Cloudflare Pages，把现有 Flask API 部署为 Cloudflare Python Worker，再通过 Hyperdrive 连接 Supabase PostgreSQL。所有设备都访问同一个 API 和数据库，因此注册账号、聊天、预警和处理状态使用同一份数据。原 `user` 等表结构不改，初始化 SQL 直接使用 [`deploy/schema.sql`](deploy/schema.sql)。

> 方案选择：Cloudflare Workers/Pages 和 Supabase 都有免费层，正常创建免费项目不要求先绑定信用卡；平台配额和规则会调整，注册时若控制台提示需要付款验证，请先停止，不要添加付款方式。Cloudflare 的 Python Workers 和 Hyperdrive Python 支持当前仍为 Beta。官方说明：[Workers 免费计划](https://www.cloudflare.com/plans/)、[Flask on Workers](https://developers.cloudflare.com/workers/languages/python/packages/flask/)、[Python Workers + Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/python-workers/)。

## 最后会得到什么

- 一个 `*.pages.dev` 前端地址，手机、电脑都可访问。
- 一个 `*.workers.dev` Flask API 地址，所有设备共用。
- 一个 Supabase PostgreSQL 数据库，保持项目原来的表名和字段。
- 注册和登录页面仍输入手机号与验证码；演示模式只要求验证码非空，不发送短信、不验证手机号归属。新手机号先注册，之后才可登录。

## 0. 准备账号和工具

1. 注册 Cloudflare 和 Supabase 免费账号。不要选择付费套餐。
2. 把项目推送到自己的 GitHub 仓库。不要提交数据库密码、Worker Secret 或 `.env.local`。
3. 在电脑安装 Node.js 20 或更高版本、Git、`uv`。终端执行 `node -v`、`git --version` 和 `uv --version` 确认可用。
4. 克隆仓库，进入项目目录：

   ```bash
   git clone <你的 GitHub 仓库地址>
   cd <克隆出来的目录>
   ```

以下命令均从仓库根目录执行，除非另有说明。

## 1. 建立 Supabase 数据库

1. Supabase 控制台选择 **New project**，组织选 Free，设置项目名、数据库密码和最近的区域。把数据库密码保存在密码管理器中。
2. 等待项目状态变为可用，打开左侧 **SQL Editor → New query**。
3. 在本地打开 `deploy/schema.sql`，全选复制到 SQL Editor，点 **Run**。这一步执行原文件，包括其原有演示种子数据；不要手工改表、删字段或重复执行到已有数据的项目。
4. 打开 **Project Settings → Database → Connection string**，选择 **Session pooler**，复制连接信息。记下 host、port、database、user 和 password。Supabase 的 pooler 账号通常带有项目引用后缀，照控制台原样使用。此处稍后用来创建 Cloudflare Hyperdrive。
5. Supabase Auth 不需要开启手机号验证，也不需要配置短信供应商。本方案的演示登录由 Flask API 签发 7 天会话令牌，Supabase 只提供业务数据库。

**不要**把 Supabase `service_role` key、数据库密码放到 Pages 的 `VITE_*` 变量里或前端代码中。前端只请求 Worker。

## 2. 配置并部署 Cloudflare Worker API

### 2.1 登录 Cloudflare

在仓库根目录打开终端：

```bash
cd deploy
uv sync
uv run pywrangler login
```

浏览器会打开 Cloudflare 授权页面。授权后回到终端。`uv sync` 会建立本地 Python Worker 开发环境。

### 2.2 创建 Hyperdrive 到 Supabase 的连接

在终端执行以下命令，把尖括号内容替换成 Supabase Session pooler 信息：

```bash
uv run pywrangler hyperdrive create xiangyin-supabase \
  --connection-string="postgres://<用户>:<URL编码后的密码>@<pooler主机>:<端口>/postgres?sslmode=require" \
  --caching-disabled
```

如果控制台给出的 database 不是 `postgres`，使用控制台的实际值。密码里有 `@ : / ? # %` 等字符时，先做 URL 百分号编码（例如 `@` 编为 `%40`），否则连接串会被错误解析。Hyperdrive 会输出配置 ID。它会管理 Worker 到数据库的连接池；关闭查询缓存是为了确保刚保存的聊天和预警马上能在其他设备看到。

将输出的 ID 粘贴到 `deploy/wrangler.toml` 的：

```toml
id = "REPLACE_WITH_HYPERDRIVE_ID"
```

改成真实 ID，保存文件。此 ID 不是数据库密码，可以随代码部署。

### 2.3 添加登录签名密钥并发布 API

生成足够随机的会话签名密钥并保存到 Cloudflare Secret：

```bash
uv run pywrangler secret put DEMO_AUTH_SECRET
```

终端会提示输入值。可用密码管理器生成至少 32 字节随机密钥。此值只存 Cloudflare，不要写入 `wrangler.toml`、GitHub 或文档。

发布 Worker：

```bash
uv run pywrangler deploy
```

命令结束时会显示 Worker URL，形如 `https://xiangyin-xinban-api.<你的子域>.workers.dev`。浏览器打开其 `/api/ping`，例如 `https://...workers.dev/api/ping`，应该返回：

```json
{"ok":true,"service":"xiangyin"}
```

若提示数据库连接失败，检查 Hyperdrive ID、Session pooler host/user/password/port、数据库密码编码和 `schema.sql` 是否已成功运行。

## 3. 部署 React 前端到 Cloudflare Pages

1. Cloudflare 控制台打开 **Workers & Pages → Create → Pages → Connect to Git**，授权并选择项目仓库。
2. 构建设置填写：

   - **Root directory**：`deploy/frontend`
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`

3. 在 Pages 项目 **Settings → Environment variables** 的 Production 环境添加：

   - `VITE_API_BASE_URL` = 第 2 步 Worker 的完整根 URL（`https://...workers.dev`，不要加 `/api`，不要加末尾 `/`）
   - `VITE_DEMO_OTP` = `true`

4. 保存并触发部署。等待状态变成 Success 后打开 `https://<项目名>.pages.dev`。
5. 若使用 Pages Preview 地址进行测试，Preview 环境也添加同样的两个变量，再触发一次 Preview 构建。

前端变量在构建时写入静态资源，因此改变量后必须重新部署。`public/_redirects` 已处理前端路由刷新回退。

Cloudflare Pages 会先自动安装依赖，再执行 Build command；不要在 Build command 里再运行一次 `npm ci`。如果安装日志提示 `esbuild@0.21.5` 的 `postinstall` 未批准，仓库的 `package.json` 已将这个构建必需脚本加入精确版本白名单。提交这项修改后重新部署。npm 的 `allowScripts` 机制会跳过未批准依赖脚本，而 esbuild 需要该脚本准备平台二进制文件。[npm allowScripts 说明](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/)

## 4. 注册、登录与多端验证

1. 在 Pages 网站选择“注册”，输入姓名、手机号、任意非空验证码及角色要求的信息。验证码无需真实短信；输入 `123456` 即可。
2. 家属注册还需要输入已经注册的老人手机号。村协管员还需要填写村镇名。
3. 登出后用同一手机号和任意非空验证码登录。若尚未注册，应先注册；已注册手机号不能再次注册。
4. 在另一台手机或电脑打开相同 Pages 地址，用相同账号登录。双方从 Supabase 读取同一社区业务数据。家属和村协管员看板每 30 秒刷新；重新打开页面也会读取云端最新状态。
5. 可在不同设备新增聊天、预警或处置记录，然后刷新另一端确认同步。

## 5. 常见问题

### 浏览器提示跨域或请求失败

确认 `VITE_API_BASE_URL` 指向 Worker 域名且没有 `/api` 后缀；Pages 环境变量更改后重新构建。确认 Worker 的 `/api/ping` 可打开。开发者工具 Network 中看具体失败请求。

### `/api/ping` 正常，登录时数据库错误

`/api/ping` 只检查 Worker 活着，不会查询数据库。回到 Supabase SQL Editor 确认脚本执行成功，再检查 Hyperdrive 的数据库连接信息。可重新创建 Hyperdrive 后更新 toml ID 并再次部署。

### 登陆后刷新页面又退出

重新运行 `uv run pywrangler secret put DEMO_AUTH_SECRET` 会使旧令牌失效。保持同一个 Worker Secret，除非需要强制所有设备退出。

### 想加真实短信登录

目前没有验证用户是否拥有该手机号，任何人都可用任意手机号和任意非空验证码注册；知道他人手机号的人也能登录对应账号。切勿放入真实健康、身份或紧急联系人数据。真实短信登录需要短信供应商和 Supabase Auth OTP 配置，也要将业务账号与已验证 Auth 用户安全关联。

## 免费方案边界

- Cloudflare Workers Free 当前每日最多 100,000 次请求、每次 10 ms CPU；Hyperdrive Free 当前每天最多 100,000 条数据库语句。Flask 冷启动或复杂 API 可能撞到 10 ms CPU 上限；出现 Worker 错误 1102 时，免费层可能无法稳定承载该路由。Python Workers/Hyperdrive 支持还在 Beta。大模型 API（如果配置）可能单独收费。首次发布先用少量账号实测完整流程。
- Supabase 免费项目可能因长期不活跃被暂停，免费层不等同于有 SLA 的生产数据库。按需备份重要数据并查看控制台配额。
- 目前用户表和业务表沿用原程序结构。演示登录仅是降低试用门槛，API 并未据此实现逐户数据隔离；不要用作真实医疗或个人隐私业务。

官方配额页面：[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[Hyperdrive 定价](https://developers.cloudflare.com/hyperdrive/platform/pricing/)、[Supabase 生产部署说明](https://supabase.com/docs/guides/deployment/going-into-prod)。
