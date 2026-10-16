# 乡音心伴

面向农村老人的方言 AI 语音陪伴与心理量表筛查项目。仓库只保留一套主开发源码：React 前端在 frontend/，Supabase 数据库迁移与 Edge Function 在 supabase/。Cloudflare Python Worker（deploy/）是兼容旧 API 的独立备选后端，不是前端或 Supabase 的副本。

## 目录约定

    frontend/        React + TypeScript + Vite，Cloudflare Pages 前端
    supabase/        数据库迁移、种子数据、Edge Function（主后端）
    deploy/          可选 Flask + Cloudflare Python Worker 后端，仅保留 Worker 源码
    docs/            架构、分工、开发说明与历史资料归档

前端调用的 API 路径保持 /api/...。主线前端使用 Supabase Auth 与 supabase/functions/api；deploy/ 的 Worker 使用另一套演示 Bearer token，不能混用两种会话。

## 开始开发

    cd frontend
    npm ci
    npm run dev

前端环境变量参考 frontend/.env.supabase.example。不要提交真实密钥或 .env.local。

Supabase Edge Function 本地调试及发布见 DEPLOY.md。提交规范、PR 流程、协作者权限与保护主分支设置见 CONTRIBUTING.md。

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
