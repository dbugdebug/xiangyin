# 部署指南

本仓库主线部署为 Cloudflare Pages（React 前端）+ Supabase Auth/PostgreSQL/Edge Functions。API 页面路径仍为 /api/...；正式部署前核对 Pages 与 Supabase 环境变量。

## 一、部署 Supabase API

1. 在 Supabase 项目中确认现有数据库表和迁移状态。不要对已有线上库重复执行初始化 SQL，不要直接修改现有表。
2. 安装 Supabase CLI，并在仓库根目录登录及关联项目：

       supabase login
       supabase link --project-ref <项目引用>

3. 在 Supabase Dashboard → Edge Functions → Secrets 配置后端变量。演示角色切换需要 DEMO_ROLE_SWITCH_ENABLED=true、安全随机的 FAKE_OTP_SECRET；可选配置 DEMO_ELDER_PHONE、DEMO_FAMILY_PHONE、DEMO_VILLAGER_PHONE。secret 不要提交仓库。
4. 发布函数：

       supabase functions deploy api

5. 在 Function 日志中确认发布成功。可通过浏览器 Network 检查登录、GET /api/me 及 OPTIONS 预检。演示号码与现有账号冲突时，配置专用号码；不要覆盖真实用户资料。

## 二、部署 Cloudflare Pages 前端

Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git，选择本仓库。构建设置：

- Root directory：frontend
- Build command：npm run build
- Build output directory：dist
- Deploy command：留空（Pages 的 Git 集成会自动发布构建产物）

在 Pages 的 Production environment variables 设置：

- VITE_SUPABASE_URL：Supabase 项目 URL
- VITE_SUPABASE_ANON_KEY：项目 publishable/anon key
- VITE_DEMO_ROLE_SWITCH_ENABLED：比赛演示时设为 true，正式环境设为 false

这些 VITE_* 值在构建时进入浏览器；只能放公开 anon/publishable key，不能放 service role 或数据库密码。保存环境变量后重新触发部署。

本地检查：

    cd frontend
    cp .env.supabase.example .env.local
    # 编辑 .env.local 后：
    npm ci
    npm run build

## 三、验证

1. 打开 Pages 地址，检查注册/演示登录。
2. 登录后刷新页面，确认会话仍有效；检查 GET /api/me 返回当前用户。
3. 演示环境打开角色切换，验证切换后 /api/me 的角色随 Supabase 会话更新。
4. 用另一台设备登录同一账号，确认读写数据同步。
5. 浏览器 Network 出错时先核对请求 URL、Origin、OPTIONS 响应和 Supabase Function 日志。CORS 允许头需要包含 authorization、apikey、content-type。

## 可选：旧版 Cloudflare Worker API

deploy/ 保留独立 Flask + Python Workers + Hyperdrive 实现，用于需要继续提供旧 Worker API 时单独发布。它不是当前 Supabase Edge Function 主线。配置、认证与数据库连接方式见 [历史 Worker 部署资料](docs/archive/legacy-cloudflare-worker/Cloudflare-部署教程.md)。不要将 Worker 演示 token 与 Supabase Auth JWT 混用。
