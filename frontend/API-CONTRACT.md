# 乡音心伴 · 前端接口契约（供后端对接参考）

> 线上业务 API 由 Cloudflare Worker 提供，Supabase 只作为 PostgreSQL 数据库。配置见 `src/lib/api.ts`、`src/lib/workerAuth.ts`。本地未设置 Worker URL 时才使用 mock。

## 通用约定

- 基础路径：`/api`
- 请求方法：GET / POST
- 请求体：`Content-Type: application/json`
- 响应体：JSON
- 错误处理：建议返回 HTTP 200 并在 body 中携带 `{ ok: false, message: '...' }`；前端会 catch 异常并展示友好占位。
- 在线业务调用携带 Worker 签名的 `Authorization: Bearer ...`；localStorage 的 `xy_role` 仅控制 UI。

## 登录和演示角色切换

### `POST /api/register` 和 `POST /api/demo-login`

注册请求先通过 `/api/register` 写入现有用户表，再调用 `/api/demo-login`。登录请求体包括手机号、任意非空 `code` 和已注册的 `role`。验证码仅作演示输入，不发送短信；成功响应包含 `access_token`、`refresh_token`、`expires_at` 和用户资料。

演示角色切换使用预先注册的三个固定演示账号重新调用 `/api/demo-login`。切换账号必须存在且数据库 role 匹配。

---

## 1. 全村统计

### `GET /api/stats`

**用途**：村协端顶部四个统计卡。

**响应**：`Stats`

```json
{
  "total": 12,
  "today_active": 8,
  "pending_alerts": 3,
  "weekly_new_risks": 4,
  "high_risk": 2
}
```

字段说明见 `src/types.ts` 的 `Stats`。

---

## 2. 筛查统计

### `GET /api/screen-stats`

**用途**：村协端「筛查统计」视图。

**响应**：`ScreenStat`

```json
{
  "total": 12,
  "screened": 10,
  "rate": 0.83,
  "byLevel": { "red": 3, "yellow": 4, "green": 5 }
}
```

---

## 3. 老人花名册

### `GET /api/elders`

**用途**：村协端老人花名册列表。

**响应**：`Elder[]`

前端期望列表**已按风险等级降序排好**（红 → 黄 → 绿），村协端不再二次排序。  
每位老人的 `pending_count`、`today_active`、`mood` 等字段由后端计算后一并返回。

### `GET /api/elders/:id`

**用途**：村协端点击老人进入单人详情。

**响应**：

```json
{
  "elder": { /* Elder */ },
  "daily_stats": [ /* DailyStat[]，近 7 天，按日期升序 */ ]
}
```

---

## 4. 风险预警

### `GET /api/alerts?status=&elder_id=`

**用途**：家属端「风险预警」、村协端「预警看板」。

**查询参数**：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `'待处理' \| '已处理'` | 可选，不传返回全部 |
| `elder_id` | number | 可选，不传返回全村 |

**响应**：`AlertItem[]`，按时间倒序（最新在前）。

```json
[
  {
    "id": 7,
    "elder_id": 6,
    "elder_name": "郑阿妹",
    "created_at": "2026-10-12 08:15",
    "keyword": "不想活",
    "summary": "老人表达了轻生念头，情绪极度低落",
    "status": "待处理",
    "severity": "high"
  }
]
```

### `POST /api/alerts/:id/handle`

**用途**：处置闭环。提交后预警状态变「已处理」，老人风险等级自动下调一档（红 → 黄 → 绿），并写入处置记录。

**请求体**：

```json
{
  "method": "电话回访",
  "note": "已联系上老人儿子，今晚回家看看",
  "handler": "村协管员 · 老李"
}
```

**method 可选值**（前端按钮文案，后端可扩展）：
- `电话回访`
- `上门探访`
- `已联系家属`
- `建议转介乡镇卫生院`
- `暂不处置需继续观察`

**响应**：

```json
{
  "ok": true,
  "elder": { /* 更新后的 Elder，risk_level 已下调 */ },
  "alert": { /* 更新后的 AlertItem，status='已处理' */ }
}
```

---

## 5. 风险上报（老人端触发）

### `POST /api/risk-report`

**用途**：老人端对话命中消极表达时，由前端静默上报。

**请求体**：

```json
{
  "elder_id": 6,
  "keyword": "不想活",
  "summary": "老人表达了轻生念头"
}
```

**响应**：

```json
{ "ok": true, "alert_id": 7 }
```

**后端联动**：新增一条待处理预警，并将该老人 `risk_level` 置为 `red`。

---

## 6. 活跃上报（老人端触发）

### `POST /api/activity`

**用途**：老人端每完成一轮对话，前端静默上报活跃度。

**请求体**：

```json
{
  "elder_id": 1,
  "rounds": 2
}
```

**响应**：

```json
{ "ok": true }
```

后端应累加「今日对话轮次」并更新 `last_active`。

---

## 7. 对话摘要

### `GET /api/summaries?elder_id=1`

**用途**：家属端 / 村协端「对话摘要」列表。

**响应**：`Summary[]`

```json
[
  {
    "id": 1,
    "elder_id": 1,
    "time": "2026-10-12 09:30",
    "mood": "平和",
    "summary": "今天主要聊了庄稼收成，情绪平稳"
  }
]
```

> 隐私红线：该接口**不再返回任何逐字对话内容**（`turns` 字段已移除）。
> 子女端 / 社区端一律只呈现 AI 语义分析后的结构化结论，详见下方 `/api/assessment`。

---

## 8. 家属关怀留言

### `GET /api/care-messages?elder_id=1&pending=1`

**用途**：老人端拉取待转达的留言。

- `pending=1`：只返回未转达的留言。

### `GET /api/care-message/pending?elder_id=1`

**用途**：老人端进入时检查有没有家属留言要转达。

**响应**：一条 `CareMessage` 或 `null`。

### `POST /api/care-message`（或 `/api/care-messages`）

**用途**：家属端提交关怀留言。

**请求体**：

```json
{
  "elder_id": 1,
  "content": "妈，记得吃药，晚上我给你打电话。"
}
```

**响应**：

```json
{ "ok": true, "id": 5 }
```

### `POST /api/care-messages/:id/conveyed`

**用途**：老人端已把留言转达给老人后，标记为已转达。

**响应**：

```json
{ "ok": true }
```

---

## 9. 转介记录

### `GET /api/referrals`

**用途**：村协端「转介记录」表格。

**响应**：`Referral[]`

```json
[
  {
    "id": 1,
    "elder_id": 6,
    "elder_name": "郑阿妹",
    "target": "乡镇卫生院 · 心理咨询",
    "time": "2026-10-12 10:00",
    "status": "待跟进"
  }
]
```

> 当村协端处置预警选择 `method='建议转介乡镇卫生院'` 时，后端可自动新增一条转介记录。

---

## 10. 模拟外呼（mock）

### `POST /api/mock-call`

**用途**：家属端「一键回拨」、村协端快捷处置按钮等场景的纯提示反馈，**不真正拨号**。

**请求体**：

```json
{ "name": "张秀英" }
```

**响应**：

```json
{ "ok": true, "message": "已模拟拨打给 张秀英" }
```

---

## 数据类型速查

完整 TypeScript 类型定义见 `src/types.ts`，核心字段如下：

| 类型 | 关键字段 |
| --- | --- |
| `Elder` | `id, name, age, dialect, living, family_name, relation, last_call, risk_level, last_active, mood, screened` |
| `DailyStat` | `elder_id, date, rounds, duration_min, active_slot, mood, note` |
| `AlertItem` | `id, elder_id, elder_name, created_at, keyword, summary, status, severity, disposal` |
| `Disposal` | `id, alert_id, method, note, handler, created_at` |
| `CareMessage` | `id, elder_id, content, conveyed, created_at` |
| `Summary` | `id, elder_id, time, mood, summary`（**无逐字内容**） |
| `Referral` | `id, elder_id, elder_name, target, time, status` |
| `Stats` | `total, today_active, pending_alerts, weekly_new_risks, high_risk` |
| `ScreenStat` | `total, screened, rate, byLevel` |

---

## 结构化风险评估 `GET /api/assessment?elder_id=1`

家属端 / 村协管员端展示老人状态的**唯一数据来源**（替代原先的"对话回放"）。
只返回 AI 对老人话语做语义分析后得出的**结构化结论**，不含任何原始对话内容。

```json
{
  "elder_id": 1,
  "elder_name": "王桂兰",
  "updated_at": "2026-10-18 15:40",
  "overall": "red",
  "conclusion": "综合评估：高风险。当前风险主要集中在「情绪与自我价值、家庭与社交适应」，建议优先跟进。",
  "dimensions": [
    {
      "key": "emotion",
      "title": "情绪与自我价值",
      "icon": "💗",
      "level": "red",
      "levelLabel": "高风险",
      "points": ["情绪走向：近 7 天情绪均值 -1.2（区间 -2 ~ +2）", "陪伴强度：近 7 天对话 18 轮 / 约 42 分钟"],
      "advice": "建议 48 小时内家属致电问候 + 村协上门探访，必要时转介乡镇卫生院心理门诊"
    }
  ]
}
```

五个维度固定为：

| key | 维度 |
| --- | --- |
| `emotion` | 情绪与自我价值 |
| `family` | 家庭与社交适应 |
| `health` | 健康与身体状态 |
| `cognition` | 认知与安全风险 |
| `economy` | 经济与生活压力 |

等级：`red` 高风险 / `yellow` 需关注 / `green` 平稳；`overall` 取五维度中最高一档。

---

## 最小改动接入方式

1. 后端实现上述接口（语言/框架不限，返回 JSON 即可）。
2. 修改 `src/lib/api.ts`：把 `mockRoute` 调用改为 `fetch('/api/...')`。
3. `src/lib/demoStore.ts` 可保留作为离线兜底（可选）。
4. 重新 `npm run build` 即可得到连接真实后端的产物。
