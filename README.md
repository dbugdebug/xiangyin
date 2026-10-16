# 乡音心伴

面向农村老人的方言 AI 语音陪伴与心理量表筛查项目。React 前端位于 frontend/，Cloudflare Python Worker API 位于 deploy/，Supabase 只提供 PostgreSQL 数据库，Worker 通过 Hyperdrive 访问。

## 目录约定

    frontend/        React + TypeScript + Vite，Cloudflare Pages 前端
    supabase/        PostgreSQL 迁移、种子数据和 Supabase 项目配置
    deploy/          Flask + Cloudflare Python Worker API 和 Hyperdrive 配置
    docs/            架构、分工、开发说明与历史资料归档

前端和 Worker 沿用 /api/... 接口。手机号和假验证码由 Worker 演示登录处理，Supabase Auth/Edge Function 不参与当前登录链路。Worker 使用 HMAC Bearer 会话并通过 Hyperdrive 访问 Supabase PostgreSQL。

## 开始开发

    cd frontend
    npm ci
    npm run dev

前端环境变量参考 frontend/.env.worker.example。不要提交真实密钥或 .env.local。

Pages、Worker、Hyperdrive 和数据库交接步骤见 DEPLOY.md。提交规范、PR 流程、协作者权限与保护主分支设置见 CONTRIBUTING.md。

## 团队文档

- [整体架构与团队开发文档](docs/项目整体架构与团队开发文档.md)
- [前端开发说明](docs/前端同学开发说明.md)
- [后端开发说明](docs/后端同学开发说明.md)
- [算法开发说明](docs/算法同学开发说明.md)

## 安全与数据

- 不改现有业务表结构；新增数据需求先提交迁移文件并评审。
- 浏览器只使用 Supabase publishable/anon key；service role、验证码签名密钥和模型密钥只能放在服务端 secrets。
- 演示验证码与角色切换只用于比赛演示。不要在演示环境存放真实健康、身份或紧急联系人信息。
- 量表用于筛查，不构成临床诊断；高风险提示需要真人复核。
