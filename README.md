# 乡音心伴：Supabase API MVP

这是一套可部署的 Supabase Edge Function API 起步工程，包含 SQL schema、统一 API 函数和前端对接示例。它面向竞赛演示和合成数据验证；不是未经审查即可投入真实心理健康业务的生产系统。

## 目录

- `supabase/schema.sql`：表结构、索引、注册时自动创建 profiles、RLS 默认关闭直连访问。
- `supabase/functions/api/index.ts`：注册/登录/当前用户/退出，以及现有前端主要业务接口。
- `src/lib/api.ts`：Vite 前端 fetch 适配器示例。

## 一、部署

### 1. 创建 Supabase 项目

在 Supabase Dashboard 创建项目，记录 Project URL、publishable/anon key。不要把 `service_role` key 放进任何前端 `.env`、代码仓库或浏览器。

### 2. 建表

Dashboard → SQL Editor → New query，完整粘贴 `supabase/schema.sql`，点击 Run。若项目里已经有同名表/枚举，请先检查现有 schema，不要盲目重复执行。

### 3. 安装 Supabase CLI 并登录

在本机终端安装 CLI（任选官方支持方式），然后：

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### 4. 设置 Edge Function secrets

本函数需要：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

前两个通常由 Supabase Functions 运行环境提供；若未提供，显式设置。第三个只放在 Edge Function secrets 中：

```bash
supabase secrets set SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
supabase secrets set SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

不要把这些命令的真实密钥贴到群聊或==提交到 Git==。生产环境建议使用当前 Supabase 推荐的 publishable/secret key 管理方式，并只在服务器端保存高权限密钥。

### 5. 部署函数

```bash
supabase functions deploy api --no-verify-jwt
```

这里使用 `--no-verify-jwt`，是因为注册/登录路由本身必须允许未登录请求进入函数。安全边界由函数内的 `authUser()` 实施：所有业务接口都必须校验 Bearer token，缺失或无效时返回 401。部署后必须测试未登录业务请求返回 401；注册/登录应加限流，绝不能因为关闭网关验证而跳过函数内鉴权。

部署后函数基础 URL：

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/api`

例如老人列表接口 URL 为 `/elders`，不是自动变成网站同域 `/api/elders`。如果前端必须保留 `/api/*`，请用 Vite dev proxy / 部署平台 rewrite 转发，或在 `src/lib/api.ts` 将 BASE 指向函数 URL。

## 二、注册与登录

### POST `/auth/register`

请求 JSON：

```json
{"email":"demo@example.com","password":"at-least-8-chars","display_name":"演示用户"}
```

成功返回 `201`，包括 `user.id` 和提示。账号是否需要邮箱验证取决于 Supabase Auth 的 Email provider 设置。注册会走 Supabase Auth `signUp`，是否发送验证邮件由 Supabase Auth Email provider 配置决定。注册不会让客户端选择角色；新用户默认 `elder`。家属/社区/管理员角色应由管理员后台或受控流程赋予，不能信任前端传来的 `role`。

### POST `/auth/login`

请求：

```json
{"email":"demo@example.com","password":"at-least-8-chars"}
```

成功响应包含 `access_token`、`refresh_token`、`expires_at` 和用户基本资料。前端后续请求使用：

`Authorization: Bearer ACCESS_TOKEN`

示例 `src/lib/api.ts` 会把 token 存入 localStorage，便于竞赛 MVP 对接；面向真实敏感数据的产品更推荐 Supabase 官方客户端管理会话，或采用安全的 HttpOnly cookie 架构，避免 XSS 造成 token 泄露。

### GET `/auth/me`

需要登录，返回当前用户 ID、邮箱、展示名和数据库角色。

### POST `/auth/logout`

需要登录。当前实现是客户端退出：前端清除 token。它不保证让已签发的 access token 立即失效；若要全端撤销会话，应接入 Supabase Auth 的正式 sign-out/revoke 流程。

## 三、业务接口清单

除注册/登录外，以下接口均需要 `Authorization: Bearer ...`。

| Method | Path | 用途 |
|---|---|---|
| GET | `/stats` | 管理看板统计 |
| GET | `/screen-stats` | 筛查统计 |
| GET | `/elders` | 社区老人列表，按 red/yellow/green 排序 |
| GET | `/elders/:id` | 老人档案和近 7 天活动记录 |
| GET | `/alerts?status=待处理&elder_id=1` | 预警列表，可选筛选 |
| POST | `/alerts/:id/handle` | 处置预警并记录操作 |
| POST | `/risk-report` | 提交风险报告，创建待处理预警并将风险标记为 red |
| POST | `/activity` | 记录今日活动轮次 |
| GET | `/summaries?elder_id=1` | 对话摘要（不是完整聊天记录） |
| GET | `/care-messages?elder_id=1&pending=1` | 家属关怀消息 |
| GET | `/care-message/pending?elder_id=1` | 取一条待传达消息或 null |
| POST | `/care-message` 或 `/care-messages` | 创建关怀消息 |
| POST | `/care-messages/:id/conveyed` | 标记消息已传达 |
| GET | `/referrals` | 转介列表 |
| POST | `/mock-call` | 仅返回模拟拨号文案，不会真实拨号 |

### 处置预警请求样例

```json
{"method":"电话回访","note":"已联系本人，约定后续复访","handler":"社区工作人员A"}
```

`method` 可选：`电话回访`、`上门探访`、`已联系家属`、`建议转介乡镇卫生院`、`暂不处置需继续观察`。选择转介时会创建转介记录。处置只关闭该条预警，不自动降低老人风险等级；风险等级应由后续筛查或经授权的专业评估更新。

### 风险报告请求样例

```json
{"elder_id":1,"keyword":"情绪低落","summary":"演示数据：近几次对话中表达持续低落。"}
```

只有该老人本人、管理员或经授权的写入角色才应提交；当前 MVP 的授权逻辑刻意较严格，社区端需要有获批社区归属及 `community_followup` 同意记录。建议在测试前先按你的注册角色与绑定流程补齐管理员配置。

## 四、前端接入

把 `src/lib/api.ts` 复制/合并到项目的 `src/lib/api.ts`。在前端根目录 `.env.local` 添加：

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

重启开发服务器。**这里只能放 publishable/anon key，不能放 service role key。**

页面示例：

```ts
import { login, api } from '@/lib/api';

await login(email, password); // 成功后自动保存 access token
const elders = await api<Elder[]>('/elders');
const alerts = await api<AlertItem[]>('/alerts?status=待处理');
```

错误会抛出 `Error(message)`，页面用 try/catch 展示即可。现有 `mockStore` 页面可逐个把读取/写入调用换成 `api()`，不要一次性大改所有组件。

## 五、必须先知道的限制

1. **角色配置**：注册只产生 `elder` 角色。要让账号成为 `family` 或 `community`，应由可信管理员在受控 SQL/管理后台修改 `profiles.role`，并创建获批的家庭绑定/社区成员关系。不要给普通用户开放改角色接口。
2. **家庭绑定**：当前表结构支持审批，但这份 API 未实现完整的“发起绑定—老人确认—撤销绑定”工作流，需要后续补接口。
3. **同意记录**：家属查看和社区跟进要求 `consents` 有相应授权记录；需要在产品流程中让老人明确授权、可撤回，并记录时间与授权范围。
4. **RLS 与高权限 key**：Edge Function 使用 service role 绕过 RLS，因此每条业务路由必须先校验身份、角色、老人归属、授权记录。当前代码是竞赛 MVP 骨架，不能未经安全审计直接接入真实健康数据；尤其应进一步审查社区列表过滤、统计聚合、分页、限流和审计策略。
5. **统计口径**：`today_active` 当前返回 0，是待按产品定义补齐的演示字段；统计接口也需根据社区范围统一过滤所有底层数据。不要把它作为真实运营报表。
6. **登录安全**：配置 Supabase Auth 的邮箱验证、密码策略、速率限制；上线前补上注册/登录限流、错误日志脱敏与账号恢复流程。
7. **退出登录**：当前 `/auth/logout` 仅提示客户端清除 token，access token 在过期前可能仍有效。真实系统需要实现完整会话撤销。
8. **心理健康场景**：使用合成数据演示。不要在竞赛版中录入可识别真实老人的心理量表、对话或风险信息；真实部署前需进行隐私、授权、数据保留、人工处置与危机响应流程评估。

## 六、最小验收流程

1. 创建 Supabase 项目，执行 SQL，部署函数。
2. 注册一个测试账号，再登录，保存 access token。
3. 调用 `GET /auth/me`，确认身份有效。
4. 由管理员配置测试社区、老人档案、社区成员关系及 consent 记录。
5. 测试 `/elders`、`/alerts`、`/risk-report`、`/alerts/:id/handle`、`/referrals`。
6. 用另一个无授权账号重复请求同一 `elder_id`，应返回 `403`。
7. 用缺失 token 的请求访问业务接口，应返回 `401`。
8. 确认浏览器 bundle 和 Git 仓库中没有 `service_role` key。

## 七、测试请求

```bash
export BASE='https://YOUR_PROJECT_REF.supabase.co/functions/v1/api'
export ANON='YOUR_PUBLISHABLE_OR_ANON_KEY'

curl -i "$BASE/auth/register" -X POST \
  -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"at-least-8-chars","display_name":"演示用户"}'

curl -i "$BASE/auth/login" -X POST \
  -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"at-least-8-chars"}'

curl -i "$BASE/auth/me" -H "apikey: $ANON" -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```
