# 乡音心伴：Supabase API MVP

> 本文说明如何连接后端、调用接口、处理登录态和错误。无需直接访问 Supabase 数据库。
>
> 当前版本：Supabase Edge Function API（竞赛演示 / MVP）。接口以部署中的 `api` Function 为准；后端实现更新，将同步更新本文。

## 0.正在部署，下文已经过时请不要参考

## 1. 接口地址与环境变量

Supabase Edge Function 的基础地址：

```text
https://krfltnayoivscrorvjrx.supabase.co/functions/v1/api
```

前端项目根目录创建 `.env.local`：

```env
VITE_SUPABASE_URL=https://krfltnayoivscrorvjrx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_2ezNRoIQgIVh-Ijyk5tnhg_PwnZXwaq
```

然后重启开发服务器。`VITE_SUPABASE_ANON_KEY` 是公开客户端 key，不是 `service_role` key。**禁止将 `SUPABASE_SERVICE_ROLE_KEY` 放进前端环境变量、浏览器代码或 Git 仓库。**

### 请求约定

- 请求与响应均使用 JSON；查询参数除外。
- 业务接口需要登录，必须携带 `Authorization: Bearer <access_token>`。
- 请求头建议始终携带 `apikey: <publishable/anon key>` 和 `Content-Type: application/json`。
- 成功时通常直接返回业务对象或数组；失败时返回 `{ "ok": false, "message": "错误原因" }`。
- 不能假定所有成功响应都有 `ok: true`：部分查询接口直接返回数组或统计对象。

## 2. 复制前端 API 封装

项目是 Vite + TypeScript 时，可以将后端工程中的 `src/lib/api.ts` 复制到前端项目的同一路径。最小使用方式：

```ts
import { api, register, login, logout, getMe } from '@/lib/api';

// 注册
await register('demo@example.com', 'your-password', '演示用户');

// 登录：成功后封装会自动保存 access_token
const result = await login('demo@example.com', 'your-password');
console.log(result.user);

// 请求需要登录的接口
const me = await getMe();
const elders = await api<Elder[]>('/elders');
const alerts = await api<AlertItem[]>('/alerts?status=%E5%BE%85%E5%A4%84%E7%90%86');

// 退出：封装会清除浏览器本地保存的 token
await logout();
```

`api<T>()` 会在 HTTP 状态码非 2xx 或响应 `ok === false` 时抛出 `Error`。页面请使用 `try/catch`，不要让 Promise 错误直接导致页面崩溃：

```ts
try {
  const data = await api<Stats>('/stats');
  // 更新页面状态
} catch (error) {
  const message = error instanceof Error ? error.message : '请求失败，请稍后重试';
  // 用项目现有的 Toast / Message 组件提示 message
}
```

> 当前封装将 access token 存在 `localStorage`，适合演示 MVP。真实敏感数据场景需要评估 XSS 风险与更安全的会话管理方案。

## 3. 登录与用户接口

### 注册 `POST /auth/register`

无需登录。

请求体：

```json
{
  "email": "demo@example.com",
  "password": "至少 8 位的密码",
  "display_name": "演示用户"
}
```

成功响应（示例）：

```json
{
  "ok": true,
  "user": { "id": "用户 UUID", "email": "demo@example.com" },
  "message": "注册申请已提交，请查收验证邮件后登录"
}
```

- 密码至少 8 位。
- 是否需要先验证邮箱，取决于 Supabase Auth 配置；如果开启邮箱验证，注册成功不代表可以立即登录。
- 新注册用户默认角色为 `elder`。前端不能通过注册参数指定 `community` 或 `admin`。

### 登录 `POST /auth/login`

无需登录。

请求体：

```json
{ "email": "demo@example.com", "password": "至少 8 位的密码" }
```

成功响应（字段示例）：

```json
{
  "ok": true,
  "access_token": "JWT access token",
  "refresh_token": "refresh token",
  "expires_at": 1790000000,
  "user": {
    "id": "用户 UUID",
    "email": "demo@example.com",
    "display_name": "演示用户",
    "role": "elder"
  }
}
```

前端封装 `login()` 会保存 token。后续请求自动附带 `Authorization`。请勿把 token 输出到日志、埋点或页面上。

### 当前用户 `GET /auth/me`

需要登录。成功响应：

```json
{
  "ok": true,
  "user": {
    "id": "用户 UUID",
    "email": "demo@example.com",
    "display_name": "演示用户",
    "role": "elder"
  }
}
```

### 退出 `POST /auth/logout`

需要登录。成功响应：

```json
{ "ok": true, "message": "已退出当前客户端会话；请清除本地 token" }
```

当前后端接口不会立即撤销已签发的 access token；前端调用后应清除本地 token 并跳转登录页。`logout()` 封装已在 `finally` 中清除 token。

## 4. 业务接口总表

以下接口均需登录。`id` 为接口返回的业务记录 ID，不是用户 UUID。

| 方法 | 路径 | 用途 | 成功响应形态 |
|---|---|---|---|
| GET | `/stats` | 管理看板统计 | 统计对象 |
| GET | `/screen-stats` | 老人筛查统计 | 统计对象 |
| GET | `/elders` | 老人列表 | 老人对象数组 |
| GET | `/elders/:id` | 老人档案及近 7 天活动 | `{ elder, daily_stats }` |
| GET | `/alerts` | 预警列表 | 预警对象数组 |
| POST | `/alerts/:id/handle` | 处置预警 | `{ ok, elder, alert }` |
| POST | `/risk-report` | 提交风险报告并创建预警 | `{ ok, alert_id }` |
| POST | `/activity` | 记录活动轮次 | `{ ok: true }` |
| GET | `/summaries?elder_id=:id` | 查看对话摘要 | 摘要数组 |
| GET | `/care-messages?elder_id=:id` | 查看关怀消息 | 消息数组 |
| GET | `/care-messages?elder_id=:id&pending=1` | 只查看待传达消息 | 消息数组 |
| GET | `/care-message/pending?elder_id=:id` | 取一条待传达消息 | 消息对象或 `null` |
| POST | `/care-message` | 创建关怀消息 | `{ ok, id }` |
| POST | `/care-messages` | 同上，兼容复数路径 | `{ ok, id }` |
| POST | `/care-messages/:id/conveyed` | 标记消息已传达 | `{ ok: true }` |
| GET | `/referrals` | 转介记录列表 | 转介对象数组 |
| POST | `/mock-call` | 模拟拨号文案 | `{ ok, message }` |

### 4.1 看板统计 `GET /stats`

仅 `community` / `admin` 角色可用。

响应字段：

```ts
interface Stats {
  total: number;             // 当前可统计范围内的老人总数
  today_active: number;      // 当前 MVP 固定返回 0，暂不可用于真实运营统计
  pending_alerts: number;    // 待处理预警数
  weekly_new_risks: number;  // 最近 7 天创建的风险事件数
  high_risk: number;         // risk_level === 'red' 的人数
}
```

### 4.2 筛查统计 `GET /screen-stats`

仅 `community` / `admin` 角色可用。

```ts
interface ScreenStats {
  total: number;
  screened: number;
  rate: number; // 百分比整数，例如 75 表示 75%，不是 0.75
  byLevel: { red: number; yellow: number; green: number };
}
```

### 4.3 老人列表 `GET /elders`

仅 `community` / `admin` 角色可用。后端按风险等级排序：红色、黄色、绿色。

```ts
interface Elder {
  id: number;
  name: string;
  age: number | null;
  dialect: string;
  living: string;
  family_name: string;
  relation: string;
  last_call: string | null;    // ISO 时间字符串
  risk_level: 'red' | 'yellow' | 'green';
  last_active: string | null;  // ISO 时间字符串
  mood: string;
  screened: boolean;
  pending_count: number;       // 待处理预警数
  today_active: number;        // 今日累计活动轮次
}
```

成功响应是 `Elder[]`，不是 `{ data: Elder[] }`。

### 4.4 老人详情 `GET /elders/:id`

需要对该老人有访问权限。响应：

```ts
interface ElderDetailResponse {
  elder: Elder;
  daily_stats: Array<{
    elder_id: number;
    date: string;             // YYYY-MM-DD
    rounds: number;
    duration_min: number;
    active_slot: string;
    mood: string;
    note: string;
  }>;
}
```

`daily_stats` 是近 7 天活动记录；`active_slot` 当前为空字符串，前端不要把它当作已实现的时间段数据。

### 4.5 预警列表 `GET /alerts`

可选查询参数：

- `status=待处理` 或 `status=已处理`
- `elder_id=老人记录 ID`

示例：`/alerts?status=%E5%BE%85%E5%A4%84%E7%90%86&elder_id=1`

响应字段：

```ts
interface AlertItem {
  id: number;
  elder_id: number;
  elder_name: string;
  created_at: string;
  keyword: string;
  summary: string;
  status: '待处理' | '已处理';
  severity: 'red' | 'yellow' | 'green';
  disposal: null | {
    id: number;
    method: string;
    note: string;
    handler_name: string;
    created_at: string;
    // 其他数据库返回字段可能存在；页面只依赖明确使用的字段
  };
}
```

`disposal` 为最近一条处置记录，没有处置记录时为 `null`。

### 4.6 处置预警 `POST /alerts/:id/handle`

请求体：

```json
{
  "method": "电话回访",
  "note": "已联系本人，约定后续复访",
  "handler": "社区工作人员A"
}
```

`method` 只能是以下值之一：

- `电话回访`
- `上门探访`
- `已联系家属`
- `建议转介乡镇卫生院`
- `暂不处置需继续观察`

成功响应：`{ "ok": true, "elder": Elder, "alert": AlertItem }`。

注意：处置成功表示该条预警被标记为已处理，不代表老人风险已消除。**前端不得因完成处置而自动把 `risk_level` 改成绿色。** 选择 `建议转介乡镇卫生院` 会创建一条转介记录。

### 4.7 提交风险报告 `POST /risk-report`

请求体：

```json
{
  "elder_id": 1,
  "keyword": "情绪低落",
  "summary": "演示数据：近期对话中表达持续低落。"
}
```

成功响应（HTTP 201）：

```json
{ "ok": true, "alert_id": 123 }
```

提交后后端会创建待处理预警，并将老人风险等级标记为 `red`。只有具备该老人写入权限的账号才能提交。

### 4.8 记录活动 `POST /activity`

请求体：

```json
{ "elder_id": 1, "rounds": 2 }
```

`rounds` 必须为 1–100 的整数。成功响应：`{ "ok": true }`。

### 4.9 对话摘要 `GET /summaries?elder_id=:id`

响应为数组，最多返回最近 20 条：

```ts
interface ConversationSummary {
  id: number;
  elder_id: number;
  time: string;
  mood: string;
  summary: string;
  turns: unknown[]; // 最多 8 项；具体元素结构请按实际数据渲染
}
```

此接口返回摘要，不是完整聊天记录。

### 4.10 家属关怀消息

查询消息：`GET /care-messages?elder_id=1`

仅查询待传达：`GET /care-messages?elder_id=1&pending=1`

取一条待传达：`GET /care-message/pending?elder_id=1`，返回消息对象或 `null`。

```ts
interface CareMessage {
  id: number;
  elder_id: number;
  content: string;
  conveyed: boolean;
  created_at: string;
}
```

创建消息：`POST /care-message`（或 `/care-messages`）

```json
{ "elder_id": 1, "content": "天气转凉，请注意添衣。" }
```

`content` 长度为 1–2000 个字符。成功响应：`{ "ok": true, "id": 123 }`。

标记已传达：`POST /care-messages/:id/conveyed`，无需请求体，成功响应 `{ "ok": true }`。

### 4.11 转介列表 `GET /referrals`

仅 `community` / `admin` 角色可用。响应数组字段：

```ts
interface Referral {
  id: number;
  elder_id: number;
  elder_name: string;
  target: string;
  time: string;
  status: string;
}
```

### 4.12 模拟拨号 `POST /mock-call`

仅 `community` / `admin` 角色可用。

请求体：`{ "name": "张阿姨" }`

响应示例：`{ "ok": true, "message": "已模拟拨打给 张阿姨" }`。

这是**纯模拟接口**，不会发起真实电话呼叫。

## 5. 错误码与页面处理建议

| HTTP 状态 | 常见含义 | 前端建议 |
|---|---|---|
| 400 | 参数缺失、参数格式不合法或业务校验失败 | 展示 `message`，提示用户修正输入 |
| 401 | 未登录、token 无效/过期，或登录凭据错误 | 清理本地会话并跳转登录页；登录页自身错误不要循环跳转 |
| 403 | 角色不足、老人归属/授权不匹配，或用户资料未初始化 | 展示无权限提示；不要自动重试 |
| 404 | 接口路径或目标记录不存在 | 展示未找到状态 |
| 500 | 服务端处理失败 | 提示稍后重试，并记录 request 失败信息；不要展示密钥或内部堆栈 |

错误响应格式：

```json
{ "ok": false, "message": "无权查看老人名册" }
```

如果出现 `WORKER_ERROR`，这是 Edge Function 运行时错误，前端无法单独修复；请把发生时间、请求路径、HTTP 状态和响应内容发给后端开发者，并由后端查看 Supabase Function Logs。不要发送密码、access token 或任何 secret。

## 6. 角色与权限约定

当前角色包括：`elder`、`family`、`community`、`admin`。

- `elder`：默认注册角色，可访问自身且已绑定的老人数据范围；不具备管理看板/老人名册权限。
- `family`：需完成老人确认绑定，并有有效 `family_view` 授权后才可读取相关信息；当前不能以家属身份写入老人记录。
- `community`：需管理员批准社区成员关系，并且老人存在有效 `community_followup` 授权，才能访问相应数据；管理类列表接口仍需 `community` 角色。
- `admin`：管理角色，由可信管理员通过受控流程分配，不能由前端注册表单赋予。

若接口返回 403，不要在前端绕过权限或改用数据库直连。应确认测试账号角色、社区成员关系、老人绑定及 consent 授权是否已配置。

## 7. 与 mock 数据切换的建议

目前页面若使用 `src/lib/demoStore.ts`，建议按页面逐步替换，不要一次性全量重构：

1. 先接登录、注册、当前用户接口。
2. 把看板的统计读取切换到 `/stats` 和 `/screen-stats`。
3. 把老人列表/详情切换到 `/elders`、`/elders/:id`。
4. 把预警列表和处置动作切换到 `/alerts`、`/alerts/:id/handle`。
5. 最后接入活动、关怀消息、摘要和转介接口。
6. 每次替换后分别测试加载中、空数据、401、403、500 和网络断开状态。

页面中的字段名应与本文 TypeScript 接口保持一致。不要默认后端返回 `{ data: ... }` 包装层，也不要继续同时读写 mockStore 和后端，以免页面数据来源不一致。

## 8. 第一次测试：注册、登录、当前用户

先打开 Terminal，设置两个变量（替换成自己的值）：

```bash
export BASE='https://krfltnayoivscrorvjrx.supabase.co/functions/v1/api'
export ANON='sb_publishable_2ezNRoIQgIVh-Ijyk5tnhg_PwnZXwaq'
```

### 8.1 注册

```bash
curl -i "$BASE/auth/register" -X POST \
  -H "apikey: $ANON" \
  -H 'Content-Type: application/json' \
  -d '{"email":"你自己的测试邮箱@example.com","password":"DemoPass123!","display_name":"演示用户"}'
```

把邮箱替换为你能接收邮件的测试邮箱。密码示例仅用于演示，自己测试时请换一个不复用的密码。

可能出现两种正常结果：

- 返回注册成功，可直接登录。
- 返回已提交注册申请，需要验证邮箱；先去邮箱点验证链接。

若提示用户已存在，不要重复注册；直接进行登录测试。

### 8.2 登录并取得 access token

```bash
curl -s "$BASE/auth/login" -X POST \
  -H "apikey: $ANON" \
  -H 'Content-Type: application/json' \
  -d '{"email":"你自己的测试邮箱@example.com","password":"DemoPass123!"}'
```

成功响应中应有 `access_token`、`refresh_token` 和 `user`。复制 `access_token`，只在自己的终端临时使用，不要发给队友或提交到仓库。token 相当于登录凭证。

### 8.3 查询当前用户

把 `YOUR_ACCESS_TOKEN` 换成刚才的 token：

```bash
curl -i "$BASE/auth/me" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

预期：HTTP 200，JSON 中包含用户 id、邮箱、展示名和角色。新注册用户角色默认应为 `elder`。

### 8.4 测试未登录保护

```bash
curl -i "$BASE/elders" -H "apikey: $ANON"
```

预期：HTTP 401。由于普通用户默认不是社区工作人员或管理员，即使登录后直接请求 `/elders`，也应返回 403；这是权限保护，不代表部署失败。

## 9. 在前端配置 API

### 9.1 找到前端项目根目录

你的前端根目录通常包含 `package.json`、`src/`、`vite.config.ts`。**不要把本教程里的后端 `src/lib/api.ts` 直接覆盖前端整个 `src` 目录。** 只复制/合并这个适配器文件。

### 9.2 创建 `.env.local`

在前端项目根目录（与 `package.json` 同级）新建 `.env.local`：

```env
VITE_SUPABASE_URL=https://krfltnayoivscrorvjrx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_2ezNRoIQgIVh-Ijyk5tnhg_PwnZXwaq
```

变量名必须完全一致。不要加入 `SUPABASE_SERVICE_ROLE_KEY`。

### 9.3 复制 API 适配器

将本工程 `src/lib/api.ts` 的内容复制到前端项目的 `src/lib/api.ts`。如果原文件里已有 mock API，不要盲目覆盖；先备份，再把导出函数合并。此适配器会直接请求：

`VITE_SUPABASE_URL + /functions/v1/api + 具体路由`

### 9.4 重启前端开发服务器

Vite 只在启动时读取环境变量。先在运行前端的终端按 `Control + C` 停止服务，再执行你项目原本的启动命令，常见为：

```bash
npm install
npm run dev
```

以项目 `package.json` 的 scripts 为准。如果项目使用 `pnpm` 或 `bun`，就继续用项目原本的包管理器，不要混用。

### 9.5 在页面中调用

```ts
import { register, login, logout, getMe, api } from '@/lib/api';

await register(email, password, displayName);
await login(email, password);
const me = await getMe();
const elders = await api('/elders');
await logout();
```

`api()` 在失败时会抛出 `Error`，页面应使用 `try/catch` 并显示错误信息。普通用户调用管理端接口返回 403 是预期行为。

## 10. 为什么注册登录成功了，老人列表仍然报 403？

这是最容易卡住的一步。注册登录和业务角色是两件事：

- 注册成功：说明 Auth 账号已创建。
- 登录成功：说明凭证有效。
- 能查看社区老人名册：还需要社区工作人员/管理员角色，以及相应的社区归属和授权数据。

新用户默认 `elder`，不能直接查看社区管理列表。开发演示时，可由项目负责人在 Supabase Dashboard 的 SQL Editor 中，以受控管理员操作配置演示账号；不要在产品中开放普通用户自助提升角色。

### 10.1 查找测试账号 UUID

登录后运行：

```sql
select id, display_name, role, created_at
from public.profiles
order by created_at desc;
```

复制测试账号的 `id`（UUID）。

### 10.2 将测试账号设为社区角色（仅演示环境）

```sql
update public.profiles
set role = 'community'
where id = '替换成测试账号UUID';
```

这只改变角色，不会自动给账号分配社区，也不会自动授权访问老人数据。不要在正式环境中把普通用户直接升级为管理员。

### 10.3 创建合成社区、老人档案和授权数据

以下脚本仅适用于空白演示环境。先把 `COMMUNITY_USER_UUID` 替换成上一步的测试账号 UUID，再整体运行：

```sql
-- 1. 创建演示社区
insert into public.communities (name)
values ('演示社区')
returning id;
```

复制返回的社区 UUID，替换下方 `COMMUNITY_UUID`：

```sql
-- 2. 为社区工作人员建立已审批的社区成员关系
insert into public.community_memberships (community_id, user_id, approved)
values ('COMMUNITY_UUID', 'COMMUNITY_USER_UUID', true);

-- 3. 创建一个完全虚构的老人档案
insert into public.elder_profiles
  (name, age, dialect, living, family_name, relation, community_id, risk_level, mood, screened)
values
  ('演示老人甲', 72, '粤语', '与配偶同住', '演示家属', '女儿', 'COMMUNITY_UUID', 'yellow', '一般', true)
returning id;
```

复制返回的老人档案 `id`，替换 `ELDER_ID`。然后给该老人创建社区跟进授权：

```sql
insert into public.consents
  (elder_id, granted_by, consent_type, granted)
values
  (ELDER_ID, 'COMMUNITY_USER_UUID', 'community_followup', true);
```

注意：这里为了快速演示，SQL 把 `granted_by` 设为测试账号，实际产品必须让授权记录反映真实授权主体和真实授权流程，不能伪造老人同意。

完成后重新登录，测试：

```bash
curl -i "$BASE/elders" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

预期返回包含 `演示老人甲` 的 JSON 数组。若仍是 403，请依次检查：用户 `profiles.role` 是否为 `community`、`community_memberships.approved` 是否为 `true`、社区 UUID 是否一致、老人是否有 `community_id`。

## 11. 常见错误排查表

| 现象                            | 常见原因                           | 处理方式                                                     |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| `supabase: command not found`   | CLI 未安装或终端未刷新             | 检查 `supabase --version`；重新打开终端；检查 Homebrew 安装结果 |
| `Project not linked`            | 没有在正确目录执行 link            | `cd` 到包含 `supabase/` 的工程根目录，再执行 `supabase link --project-ref ...` |
| SQL 报错 `already exists`       | 重复执行或已有旧表/枚举            | 检查现有 schema，不要直接删表；空项目才按教程首次执行        |
| 注册成功但登录失败              | 邮箱尚未验证，或密码不匹配         | 检查邮箱确认邮件和 Auth 日志；确认邮箱与密码一致             |
| API 返回 401                    | token 缺失、过期、未加 Bearer 前缀 | 登录后重新取 token，使用 `Authorization: Bearer ...`         |
| API 返回 403                    | 账号角色或老人归属/授权不满足      | 按第 11 节检查角色、社区成员关系和 consent                   |
| API 返回 500                    | 数据库字段/函数部署/密钥有问题     | Dashboard → Edge Functions → `api` → Logs，查看错误；不要公开粘贴密钥 |
| 浏览器 CORS 报错                | 请求地址或部署配置不正确           | 检查 `.env.local`、函数是否部署、BASE 地址是否包含 `/functions/v1/api`；重启 Vite |
| 修改 `.env.local` 不生效        | Vite 没重启                        | `Control + C` 停止后重新 `npm run dev`                       |
| `/stats` 的 `today_active` 是 0 | 当前 MVP 尚未实现该统计口径        | 这是已知待补项，不代表数据库没写入；正式展示前补齐统计逻辑   |

## 12. API 快速对照

所有请求都发到：

`https://krfltnayoivscrorvjrx.supabase.co/functions/v1/api`

| 方法 | 路径                                 | 是否需要登录              | 说明                                           |
| ---- | ------------------------------------ | ------------------------- | ---------------------------------------------- |
| POST | `/auth/register`                     | 否                        | 邮箱注册                                       |
| POST | `/auth/login`                        | 否                        | 邮箱密码登录                                   |
| GET  | `/auth/me`                           | 是                        | 当前用户                                       |
| POST | `/auth/logout`                       | 是                        | 客户端清除 token；并非完整撤销所有已签发 token |
| GET  | `/stats`                             | 是，社区/管理员           | 看板统计                                       |
| GET  | `/screen-stats`                      | 是，社区/管理员           | 筛查统计                                       |
| GET  | `/elders`                            | 是，社区/管理员           | 老人名册                                       |
| GET  | `/elders/:id`                        | 是，且须有访问权限        | 老人档案及近 7 天活动                          |
| GET  | `/alerts`                            | 是，社区/管理员           | 风险预警列表                                   |
| POST | `/alerts/:id/handle`                 | 是，社区/管理员且须有权限 | 处置预警；不自动降低风险等级                   |
| POST | `/risk-report`                       | 是，且须有写入权限        | 创建风险预警                                   |
| POST | `/activity`                          | 是，且须有写入权限        | 记录活动轮次                                   |
| GET  | `/summaries?elder_id=...`            | 是，且须有访问权限        | 对话摘要                                       |
| GET  | `/care-messages?elder_id=...`        | 是，且须有访问权限        | 家属关怀消息                                   |
| GET  | `/care-message/pending?elder_id=...` | 是，且须有访问权限        | 获取一条待传达消息                             |
| POST | `/care-message`                      | 是，且须有访问权限        | 创建关怀消息                                   |
| POST | `/care-messages/:id/conveyed`        | 是，且须有写入权限        | 标记已传达                                     |
| GET  | `/referrals`                         | 是，社区/管理员           | 转介列表                                       |
| POST | `/mock-call`                         | 是，社区/管理员           | 只模拟拨号，不会真实拨打电话                   |

## 13. 联调验收清单

- [ ] `.env.local` 配置正确，重启 Vite 后环境变量生效。
- [ ] 注册、邮箱验证（如开启）、登录流程正常。
- [ ] 登录后 `/auth/me` 返回正确角色。
- [ ] 未登录调用业务接口返回 401。
- [ ] 老人列表、详情、预警列表字段与页面类型一致。
- [ ] 处置预警后刷新列表，状态更新为 `已处理`，但风险等级不会因处置自动变绿。
- [ ] 无权限账号访问其他老人数据时返回 403。
- [ ] 所有异常都能显示用户可理解的提示。
- [ ] 前端源码、`.env.local`、构建产物和 Git 历史中均不存在 `service_role` key。

## 14. 数据与演示安全

本项目涉及心理健康筛查和风险跟进，目前仅用于竞赛演示及合成数据验证。请使用虚构老人信息；不要把真实老人的身份信息、心理量表答案、聊天内容或风险记录放入测试环境。真实上线前必须补齐并审查授权撤回、社区数据隔离、审计、限流、会话撤销、危机响应与数据保留策略。
