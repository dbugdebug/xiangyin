# 乡音心伴线上部署

架构：Cloudflare Pages 托管 React 前端；Render 托管 Flask API；Supabase 提供共享 PostgreSQL。当前部署默认开启演示认证：用户填写手机号后，任意非空验证码均可通过，不调用 Supabase 手机验证。

## 1. 初始化 Supabase

1. 创建 Supabase 项目，保存数据库密码。
2. 在 SQL Editor 原样执行 [`deploy/schema.sql`](deploy/schema.sql)。它与原项目提供的文件一致，会建表并导入演示用老人、预警等种子数据；只在新项目初始化时执行一次。
3. 在 Supabase Connect 面板记下 PostgreSQL Session pooler 参数。
4. 不需要启用 Supabase Authentication 或配置短信服务商。手机号只作为 `user` 表里的账号标识，页面接受任意非空验证码。

## 2. 部署 API 到 Render

将代码推送到 GitHub，在 Render 选择 New → Blueprint，连接仓库并使用仓库根目录的 `render.yaml`。或手动建 Web Service：Root Directory `deploy`，Build Command `pip install -r requirements.txt`，Start Command `gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120`。

设置以下环境变量（`render.yaml` 已列出）：

- `DB_MODE=postgres`
- `DB_HOST`：Supabase Connect 中的 Session pooler host
- `DB_PORT=5432`、`DB_USER`：按 Supabase Session pooler 页面给出的连接参数填写
- `DB_PASSWORD`：创建项目时设置的数据库密码
- `DB_NAME=postgres`、`DB_SSLMODE=require`
- `AUTH_MODE=demo`、`DEMO_AUTH_SECRET`：`render.yaml` 会创建随机签名密钥
- `CORS_ORIGINS`：稍后 Pages 的正式域名，例如 `https://xiangyin-xinban.pages.dev`，多个域名用逗号分隔

部署完成后打开 `https://你的Render服务.onrender.com/api/ping`，应返回 `{"ok":true,"service":"xiangyin"}`。Render 免费服务可能在闲置后休眠，首次唤醒会有等待时间。

## 3. 部署前端到 Cloudflare Pages

创建 Pages 项目并连接同一 GitHub 仓库：

- Root directory：`deploy/frontend`
- Build command：`npm ci && npm run build`
- Build output directory：`dist`

配置 Pages 的 Production 和 Preview 环境变量：

- `VITE_API_BASE_URL`：Render 服务根 URL，不带末尾斜线
- `VITE_DEMO_OTP=true`：任意非空验证码都可以登录

演示模式下，前端不需要 Supabase URL 或 anon key。Render 用服务端随机密钥给演示会话签名；业务 API 仍验证该签名，再访问 Supabase 数据库。首次注册会在原有 `user` 表创建账号；登录必须使用已注册手机号。

保存后触发一次新构建。把 Pages 正式域名加入 Render 的 `CORS_ORIGINS` 并重新部署 API。`public/_redirects` 已配置 React Router 刷新路由回退。

## 4. 创建首个账号并验证多端

1. 用 Pages 域名打开应用，选择“注册”，填写姓名、手机号、角色和任意非空验证码。家属注册时还要填已注册老人的手机号。
2. 首次注册成功后，API 会按手机号创建业务用户；老人角色同时创建老人档案，家属角色自动绑定该老人。村协管员还需填写所属村镇。
3. 在第二台设备登录后，家属和村协管员看板每 30 秒从共享数据库刷新一次；聊天记录、风险预警和处置状态都会同步显示。
4. 注销后在另一台设备登录同一账号，确认角色和业务数据仍能读取。

## 本地开发

```sh
cd deploy/frontend
cp .env.production.example .env.local
npm ci
npm run dev
```

将 `.env.local` 中 API 地址指向已部署 Render 服务；Render 的 `CORS_ORIGINS` 需要包含本地 Vite 来源 `http://localhost:5173`。`.env.local` 不要提交到 Git。

## 重要的数据边界

- 数据库密码和演示会话签名密钥只保存在 Render 环境变量，不要放入前端配置。
- 演示模式不验证手机号所有权：任何人都可以用任意验证码注册，知道他人手机号的人也能登录其账号。签名令牌只维持会话完整性，不代表完成身份核验；请勿写入真实健康或个人数据。业务数据由 Flask 服务端访问 PostgreSQL，不开放浏览器直连数据库。
- 当前业务接口共用社区看板数据。若要处理真实健康档案或在不同机构间隔离数据，还需按用户角色和绑定关系细化每个接口的行级授权；现有 UI/API 的社区共享设计不是逐户隐私隔离。
- Render 免费 Web Service 闲置 15 分钟会休眠，首次唤醒约需一分钟；Supabase 免费项目低活跃 7 天可能暂停。免费方案适合演示和小规模试用，不保证生产可用性。[Render 限制](https://render.com/docs/free) · [Supabase 生产说明](https://supabase.com/docs/guides/deployment/going-into-prod)
- 免费配额、休眠策略和服务条款可能变化；上线前请在各平台控制台核对。AI 模型 API 也可能产生费用。
