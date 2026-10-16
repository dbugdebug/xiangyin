# 部署配置速查

部署拓扑：Cloudflare Pages 托管 React 前端；Cloudflare Python Workers 托管 Flask API；Supabase 只提供 PostgreSQL，Worker 通过 Hyperdrive 连接。业务 API 仍使用既有 `/api/...` 路径。

## Pages

- Root directory：`frontend`
- Build command：`npm run build`
- Build output directory：`dist`
- Git 集成的 Deploy command 留空。
- Production variables：`VITE_WORKER_API_URL=https://api.ccup.us.ci`。演示角色切换才需要 `VITE_DEMO_ROLE_SWITCH_ENABLED=true` 和三个已注册演示账号的 `VITE_DEMO_*_PHONE`。

## Worker

源代码目录为 `deploy/`。`deploy/wrangler.toml` 中 `DB_MODE=postgres`、`AUTH_MODE=demo`，Hyperdrive binding 必须指向已有 Supabase 数据库。Cloudflare Worker Secret 名称为 `DEMO_AUTH_SECRET`；保留现有值可避免使已发出的 token 失效。

    cd deploy
    uv sync --group dev
    uv run pywrangler deploy

如果虚拟环境从旧目录移动过，先运行 `uv sync --reinstall --group dev` 重建命令启动器。发布后 `/api/ping` 应返回成功。

## 数据库与认证

- 保持现有 Supabase 表和数据，不要为切换部署拓扑重新建表。
- Supabase Auth、Supabase Edge Function 不参与当前请求链路。
- 登录和注册走 Worker：`POST /api/register`、`POST /api/demo-login`；登录后业务请求携带 Worker 签名 Bearer token。
- 演示验证码只接受非空输入，不发送短信，不验证手机号归属。只用于比赛演示。

Cloudflare Pages 构建字段说明见[官方文档](https://developers.cloudflare.com/pages/configuration/build-configuration/)；Worker Python 发布说明见[官方文档](https://developers.cloudflare.com/workers/languages/python/)。
