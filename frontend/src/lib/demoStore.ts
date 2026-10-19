/**
 * 纯前端本地 mock 数据层（路演模式：无需任何后端服务）
 * ================================================================
 * 三端（老人端 / 家属端 / 村协管员端）共用同一份数据 + 同一个"风险预警"数据流：
 *
 *   老人端对话命中消极表达
 *        └─ reportRisk()  →  新增预警(待处理) + 该老人置红
 *                               ├─ 家属端 listAlerts() 立刻看到红色预警与摘要
 *                               └─ 村协端 listAlerts() 待办里看到该老人
 *                                      └─ handleAlert() → 预警转「已处理」+ 风险下调一档(红→黄→绿)
 *
 * 数据保存在模块级单例中，页面之间切换不丢失（路由跳转会重新挂载页面 → 读到最新数据）；
 * 同时提供 subscribe()，页面挂载期间数据变化可实时刷新。
 * 所有写操作都会 emit()，保证"现场能看见红点变绿"。
 *
 * 本文件即本原型的**全部数据来源**（纯前端，无任何后端服务）。
 * 数据访问统一经 lib/api.ts 暴露给页面；将来若接真实后端，只需替换 api.ts 的取数实现。
 */
import type {
  AlertItem,
  CareMessage,
  DailyStat,
  Disposal,
  Elder,
  Referral,
  RiskCategory,
  RiskLevel,
  ScreenStat,
  Stats,
  Summary,
} from '../types'
import { asRiskCategory } from './assessment'

/* ------------------------------------------------------------------ 时间工具 */

const pad = (n: number) => String(n).padStart(2, '0')

/** N 天前的日期（YYYY-MM-DD） */
export function dateAgo(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今天 YYYY-MM-DD */
export const TODAY = dateAgo(0)

/** 现在 "YYYY-MM-DD HH:MM" */
function now(): string {
  const d = new Date()
  return `${dateAgo(0)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 相对时间文案："今天 09:40" / "昨天 21:30" / "3 天前" */
function relLabel(daysAgo: number, hh = 9, mm = 40): string {
  if (daysAgo === 0) return `今天 ${pad(hh)}:${pad(mm)}`
  if (daysAgo === 1) return `昨天 ${pad(hh)}:${pad(mm)}`
  return `${daysAgo} 天前`
}

/** 近 N 天逐日时间标签（今天在前：与后端返回顺序一致） */
function relTimeList(daysAgo: number): string[] {
  if (daysAgo === 0) {
    const d = new Date()
    return [`今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`, '昨天 09:40', '2 天前 09:40']
  }
  return [relLabel(daysAgo, 9, 40), relLabel(daysAgo + 1, 20, 10), relLabel(daysAgo + 2, 15, 0)]
}

/* ------------------------------------------------------------------ 种子：老人档案 */

interface ElderSeed {
  id: number
  name: string
  age: number
  dialect: string
  living: string
  family_name: string
  relation: string
  risk: RiskLevel
  mood: string
  /** 距上次活跃天数：0=今天有对话，3 天以上 = 连续未活跃（演示"长时间未对话"预警） */
  inactiveDays: number
  screened: boolean
  moodSummary?: string
}

/**
 * 12 位老人：红 3 / 黄 4 / 绿 5；其中 3 位独居高龄（≥80 岁），
 * 2 位连续 3 天以上未活跃（孙守田 4 天、冯天顺 3 天），保证打开页面就有内容。
 */
const ELDER_SEED: ElderSeed[] = [
  {
    id: 1, name: '王桂兰', age: 78, dialect: '前院村', living: '独居', family_name: '李娟',
    relation: '孙女', risk: 'yellow', mood: '低落', inactiveDays: 0, screened: true,
    moodSummary: '王奶奶本周整体平稳，周三情绪偏低；风险归因为「家庭与社交适应」与「健康与身体状态」。',
  },
  {
    id: 2, name: '李福贵', age: 81, dialect: '后山村', living: '独居', family_name: '李梅',
    relation: '女儿', risk: 'red', mood: '需关注', inactiveDays: 0, screened: true,
    moodSummary: '李爷爷近三天情绪持续走低，AI 判定为「情绪与自我价值」类高风险，建议尽快上门探访。',
  },
  {
    id: 3, name: '张秀英', age: 76, dialect: '前院村', living: '与子女同住', family_name: '张强',
    relation: '儿子', risk: 'green', mood: '平和', inactiveDays: 0, screened: true,
    moodSummary: '张奶奶本周情绪平稳，最爱聊赶集和菜园子，胃口也不错。',
  },
  {
    id: 4, name: '赵铁柱', age: 73, dialect: '后山村', living: '留守', family_name: '赵丽',
    relation: '女儿', risk: 'yellow', mood: '低落', inactiveDays: 0, screened: true,
    moodSummary: '赵大爷风险归类为「健康与身体状态」，情绪略低，聊天时长短于往常。',
  },
  {
    id: 5, name: '陈桂香', age: 80, dialect: '前院村', living: '独居', family_name: '陈静',
    relation: '女儿', risk: 'green', mood: '平和', inactiveDays: 1, screened: true,
    moodSummary: '陈奶奶本周情绪平稳，昨天聊了腌菜和邻居串门。',
  },
  {
    id: 6, name: '孙守田', age: 84, dialect: '后山村', living: '独居', family_name: '孙伟',
    relation: '儿子', risk: 'red', mood: '需关注', inactiveDays: 4, screened: true,
    moodSummary: '孙爷爷已连续 4 天没有对话记录，系统自动生成"长时间未对话"预警。',
  },
  {
    id: 7, name: '周玉兰', age: 75, dialect: '前院村', living: '留守', family_name: '周强',
    relation: '儿子', risk: 'green', mood: '平和', inactiveDays: 0, screened: true,
    moodSummary: '周奶奶本周情绪很好，日常社交活动丰富（归类：家庭与社交适应）。',
  },
  {
    id: 8, name: '吴德贵', age: 79, dialect: '后山村', living: '留守', family_name: '吴芳',
    relation: '女儿', risk: 'yellow', mood: '平和', inactiveDays: 0, screened: true,
    moodSummary: '吴大爷情绪尚可，但近一周话变少了，建议家属多打电话。',
  },
  {
    id: 9, name: '何秀珍', age: 77, dialect: '前院村', living: '独居', family_name: '何亮',
    relation: '孙子', risk: 'red', mood: '低落', inactiveDays: 0, screened: false,
    moodSummary: '何奶奶风险归类为「健康与身体状态」，整体情绪偏低落。',
  },
  {
    id: 10, name: '马长顺', age: 82, dialect: '后山村', living: '与子女同住', family_name: '马丽',
    relation: '女儿', risk: 'green', mood: '平和', inactiveDays: 0, screened: true,
    moodSummary: '马爷爷本周情绪平稳，聊得最多的是孙子上学的事。',
  },
  {
    id: 11, name: '郑桂英', age: 74, dialect: '前院村', living: '独居', family_name: '郑小燕',
    relation: '女儿', risk: 'yellow', mood: '低落', inactiveDays: 1, screened: false,
    moodSummary: '郑奶奶风险归类为「家庭与社交适应」，情绪偏低，已由村协管员电话回访。',
  },
  {
    id: 12, name: '冯天顺', age: 85, dialect: '后山村', living: '独居', family_name: '冯建',
    relation: '儿子', risk: 'green', mood: '平和', inactiveDays: 3, screened: true,
    moodSummary: '冯爷爷 3 天未活跃，历史情绪平稳，已列入关注名单。',
  },
]

/* ------------------------------------------------------------------ 可变数据（单例） */

const elders: Elder[] = ELDER_SEED.map((s) => {
  const lc = relTimeList(s.inactiveDays)[0]
  return {
    id: s.id,
    name: s.name,
    age: s.age,
    dialect: s.dialect,
    living: s.living,
    family_name: s.family_name,
    relation: s.relation,
    last_call: lc,
    risk_level: s.risk,
    last_active: relLabel(s.inactiveDays, s.inactiveDays === 0 ? 9 : 16, s.inactiveDays === 0 ? 40 : 30),
    mood_summary: s.moodSummary,
    days_inactive: s.inactiveDays,
    today_active: s.inactiveDays === 0,
    mood: s.mood,
    screened: s.screened,
  }
})

/** 各档风险的情绪曲线（旧 → 新），给"近 7 天情绪趋势"用 */
const MOOD_BY_RISK: Record<RiskLevel, number[]> = {
  red: [-1, -1, -2, -1, -2, -1, -2],
  yellow: [0, -1, 0, -1, -1, 0, -1],
  green: [1, 0, 1, 0, 1, 1, 1],
}

/** 王桂兰（家属端演示主角）单独一条更"有故事"的曲线 */
const MOOD_ELDER1 = [-1, -1, 0, 1, 0, -2, -1]

const SLOTS = ['上午', '中午', '下午', '晚间']

/** 一日话题摘要（脱敏：只描述情绪与话题，不还原逐字对话） */
/**
 * 每日话题摘要（家属端 / 村协管员端「情绪趋势」会展示）
 * 隐私底线：**只写 AI 语义分析后的结构化归因与标准分类，绝不引用老人原话**。
 */
const NOTES: Record<number, Record<string, string>> = {
  1: {
    [dateAgo(0)]: '睡眠与情绪欠佳，社交连接偏弱（归类：健康与身体状态 / 家庭与社交适应）。',
    [dateAgo(1)]: '主动分享家庭喜事，情绪正向（归类：家庭与社交适应）。',
    [dateAgo(3)]: '用药依从性与食欲良好（归类：健康与身体状态）。',
    [dateAgo(4)]: '活动量下降，连续两日外出减少（归类：健康与身体状态）。',
  },
  2: {
    [dateAgo(0)]: '情绪明显低落，已触发高风险预警（归类：情绪与自我价值）。',
    [dateAgo(1)]: '家庭陪伴缺失，社会连接偏弱（归类：家庭与社交适应）。',
  },
  3: { [dateAgo(0)]: '晨间状态良好，有外出社交计划（归类：家庭与社交适应）。' },
  9: { [dateAgo(0)]: '夜间身体不适影响休息（归类：健康与身体状态）。' },
  6: { [dateAgo(4)]: '长时间未对话预警：近 48 小时无互动（归类：认知与安全风险）。' },
}

/** 生成某位老人近 7 天每日统计（今天在前，与后端返回顺序一致） */
function buildDailyStats(e: Elder): DailyStat[] {
  const curve = e.id === 1 ? MOOD_ELDER1 : MOOD_BY_RISK[e.risk_level]
  const out: DailyStat[] = []
  for (let i = 0; i < 7; i++) {
    const daysAgo = 6 - i // i=6 → 今天
    // 基础活跃度：情绪越低落、越久未活跃，聊得越少
    const base = e.risk_level === 'green' ? 6 : e.risk_level === 'yellow' ? 4 : 3
    const rounds = daysAgo === 0 && (e.days_inactive ?? 0) > 0
      ? 0
      : Math.max(1, base + ((e.id * 7 + i * 3) % 5) - 2)
    out.push({
      elder_id: e.id,
      date: dateAgo(daysAgo),
      rounds,
      // 每轮约 2 分钟
      duration_min: rounds * 2,
      active_slot: SLOTS[(e.id + i) % SLOTS.length],
      mood: curve[6 - daysAgo],
      note: NOTES[e.id]?.[dateAgo(daysAgo)] ?? null,
    })
  }
  return out
}

let dailyStats: DailyStat[] = elders.flatMap(buildDailyStats)

/* ------------------------------------------------------------------ 种子：预警 / 摘要 / 转介 / 留言 */

let alertSeq = 100

let alerts: AlertItem[] = [
  {
    id: 1, elder_id: 2, elder_name: '李福贵', created_at: `${dateAgo(0)} 09:42`,
    category: '情绪与自我价值', severity: 'high', status: '待处理',
  },
  {
    id: 2, elder_id: 1, elder_name: '王桂兰', created_at: `${dateAgo(0)} 08:26`,
    category: '健康与身体状态', severity: 'mid', status: '待处理',
  },
  {
    id: 3, elder_id: 6, elder_name: '孙守田', created_at: `${dateAgo(1)} 21:30`,
    category: '认知与安全风险', severity: 'high', status: '待处理',
  },
  {
    id: 4, elder_id: 9, elder_name: '何秀珍', created_at: `${dateAgo(0)} 09:55`,
    category: '健康与身体状态', severity: 'mid', status: '待处理',
  },
  {
    id: 5, elder_id: 11, elder_name: '郑桂英', created_at: `${dateAgo(1)} 15:20`,
    category: '家庭与社交适应', severity: 'mid', status: '已处理', method: '电话回访',
    disposal: {
      id: 1, alert_id: 5, method: '电话回访',
      note: '已电话回访，郑奶奶情绪已平稳，答应周末去女儿家吃饭。',
      handler: '村协管员 · 老李', created_at: `${dateAgo(1)} 16:05`,
    },
  },
  {
    id: 6, elder_id: 4, elder_name: '赵铁柱', created_at: `${dateAgo(2)} 10:15`,
    category: '健康与身体状态', severity: 'mid', status: '已处理', method: '建议转介乡镇卫生院',
    disposal: {
      id: 2, alert_id: 6, method: '建议转介乡镇卫生院',
      note: '已协助预约乡镇卫生院骨关节门诊，家属陪同前往。',
      handler: '村协管员 · 老李', created_at: `${dateAgo(2)} 11:00`,
    },
  },
  {
    id: 7, elder_id: 12, elder_name: '冯天顺', created_at: `${dateAgo(0)} 11:08`,
    category: '经济与生活压力', severity: 'mid', status: '待处理',
  },
]

let summaries: Summary[] = [
  {
    id: 1, elder_id: 1, time: relLabel(0, 8, 15), mood: '低落',
    summary: '睡眠与情绪状态欠佳，社交连接偏弱（归类：健康与身体状态 / 家庭与社交适应）。',
  },
  {
    id: 2, elder_id: 1, time: relLabel(1, 19, 30), mood: '平和',
    summary: '主动分享家庭喜事，情绪正向（归类：家庭与社交适应）。',
  },
  {
    id: 3, elder_id: 1, time: relLabel(3, 15, 2), mood: '平和',
    summary: '用药依从性与食欲良好（归类：健康与身体状态）。',
  },
  {
    id: 4, elder_id: 1, time: relLabel(4, 10, 47), mood: '需关注',
    summary: '活动量下降，连续两日外出减少（归类：健康与身体状态）。',
  },
  {
    id: 5, elder_id: 2, time: relLabel(0, 9, 40), mood: '需关注',
    summary: '情绪明显低落，已触发高风险预警（归类：情绪与自我价值）。',
  },
  {
    id: 6, elder_id: 2, time: relLabel(1, 20, 10), mood: '低落',
    summary: '家庭陪伴缺失，社会连接偏弱（归类：家庭与社交适应）。',
  },
  {
    id: 7, elder_id: 3, time: relLabel(0, 7, 58), mood: '平和',
    summary: '晨间状态良好，有外出社交计划（归类：家庭与社交适应）。',
  },
  {
    id: 8, elder_id: 9, time: relLabel(0, 9, 55), mood: '低落',
    summary: '夜间身体不适影响休息（归类：健康与身体状态）。',
  },
  {
    id: 9, elder_id: 6, time: relTimeList(4)[0], mood: '需关注',
    summary: '长时间未对话预警：近 48 小时无互动（归类：认知与安全风险）。',
  },
]

let referrals: Referral[] = [
  {
    id: 1, elder_id: 4, elder_name: '赵铁柱', target: '乡镇卫生院 · 骨关节门诊',
    time: `${dateAgo(2)} 11:00`, status: '已完成',
  },
  {
    id: 2, elder_id: 2, elder_name: '李福贵', target: '乡镇卫生院 · 心理咨询',
    time: `${dateAgo(3)} 09:20`, status: '随访中',
  },
  {
    id: 3, elder_id: 9, elder_name: '何秀珍', target: '村医 · 上门随访',
    time: `${dateAgo(5)} 10:30`, status: '已联系',
  },
  {
    id: 4, elder_id: 12, elder_name: '冯天顺', target: '村委 · 网格员定期探望',
    time: `${dateAgo(6)} 14:00`, status: '待跟进',
  },
]

let careMessages: CareMessage[] = [
  {
    id: 1, elder_id: 1, content: '奶奶，天冷了记得加衣裳，周末我尽量回来看您。',
    conveyed: 0, created_at: `${dateAgo(0)} 07:40`,
  },
]
let careSeq = 10

/* ------------------------------------------------------------------ 发布订阅（页面实时刷新） */

const listeners = new Set<() => void>()

/** 订阅数据变化；返回取消订阅函数 */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function emit() {
  listeners.forEach((cb) => cb())
}

/* ------------------------------------------------------------------ 查询 */

/** 补全派生字段（待处置预警数、未活跃天数随处置结果实时变化） */
function decorate(e: Elder): Elder {
  return {
    ...e,
    pending_count: alerts.filter((a) => a.elder_id === e.id && a.status === '待处理').length,
  }
}

export function listElders(): Elder[] {
  return elders.map(decorate)
}

export function getElder(id: number): Elder | undefined {
  const e = elders.find((x) => x.id === id)
  return e ? decorate(e) : undefined
}

export function elderDailyStats(id: number): DailyStat[] {
  return dailyStats.filter((s) => s.elder_id === id)
}

export function listAlerts(filter?: { status?: string; elder_id?: number }): AlertItem[] {
  return alerts
    .filter((a) => (filter?.status ? a.status === filter.status : true))
    .filter((a) => (filter?.elder_id ? a.elder_id === filter.elder_id : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) // 时间倒序
}

export function listSummaries(elderId?: number): Summary[] {
  return summaries
    .filter((s) => (elderId ? s.elder_id === elderId : true))
    .sort((a, b) => a.id - b.id)
}

export function listReferrals(): Referral[] {
  return [...referrals].sort((a, b) => (a.time < b.time ? 1 : -1))
}

export function listCareMessages(elderId: number, pendingOnly = false): CareMessage[] {
  return careMessages
    .filter((m) => m.elder_id === elderId)
    .filter((m) => (pendingOnly ? m.conveyed === 0 : true))
    .sort((a, b) => a.id - b.id)
}

export function getStats(): Stats {
  return {
    total: elders.length,
    today_active: elders.filter((e) => e.today_active).length,
    pending_alerts: alerts.filter((a) => a.status === '待处理').length,
    weekly_new_risks: alerts.length,
    high_risk: elders.filter((e) => e.risk_level === 'red').length,
  }
}

export function getScreenStats(): ScreenStat {
  const byLevel: Record<RiskLevel, number> = { red: 0, yellow: 0, green: 0 }
  elders.forEach((e) => {
    byLevel[e.risk_level] += 1
  })
  const screened = elders.filter((e) => e.screened).length
  return {
    total: elders.length,
    screened,
    rate: elders.length ? screened / elders.length : 0,
    byLevel,
  }
}

/* ------------------------------------------------------------------ 写操作 */

/** 风险等级下调一档：红 → 黄 → 绿（绿保持绿） */
const DOWN: Record<RiskLevel, RiskLevel> = { red: 'yellow', yellow: 'green', green: 'green' }

/**
 * 老人端对话触发风险（演示动线入口）：
 * 新增一条「待处理」预警 + 把该老人置为红 + 情绪标记"需关注"。
 */
export function reportRisk(input: { elder_id: number; category: RiskCategory }): AlertItem {
  // 无论上游传什么，都强制收敛到五个标准分类之一（不保存、不展示任何老人原话）
  const category = asRiskCategory(input.category)
  const e = elders.find((x) => x.id === input.elder_id)
  const alert: AlertItem = {
    id: ++alertSeq,
    elder_id: input.elder_id,
    elder_name: e?.name ?? '未知老人',
    created_at: now(),
    category,
    status: '待处理',
    severity: 'high',
  }
  alerts = [alert, ...alerts]
  if (e) {
    e.risk_level = 'red'
    e.mood = '需关注'
    e.today_active = true
    e.days_inactive = 0
    e.last_active = now()
    e.mood_summary = `AI 语义分析判定为「${category}」类风险，建议重点关注。`
  }
  // 同步写入一条结构化摘要（只记分类，不含任何逐字内容）
  summaries = [
    ...summaries,
    {
      id: Math.max(...summaries.map((s) => s.id)) + 1,
      elder_id: input.elder_id,
      time: now(),
      mood: '需关注',
      summary: `风险预警类型：${category}`,
    },
  ]
  emit()
  return alert
}

/** 老人端每轮对话上报活跃：轮次 +1、陪伴时长累计、刷新最后活跃时间 */
export function reportActivity(input: { elder_id: number; rounds?: number }): void {
  const e = elders.find((x) => x.id === input.elder_id)
  const rounds = input.rounds ?? 1
  const today = dailyStats.find((s) => s.elder_id === input.elder_id && s.date === TODAY)
  if (today) {
    today.rounds += rounds
    today.duration_min += rounds * 2
    today.active_slot = SLOTS[new Date().getHours() < 12 ? 0 : new Date().getHours() < 18 ? 2 : 3]
  } else {
    dailyStats = [
      ...dailyStats,
      {
        elder_id: input.elder_id,
        date: TODAY,
        rounds,
        duration_min: rounds * 2,
        active_slot: '上午',
        mood: 0,
        note: null,
      },
    ]
  }
  if (e) {
    e.today_active = true
    e.days_inactive = 0
    e.last_active = now()
    e.last_call = now()
  }
  emit()
}

/**
 * 处置闭环（村协端灵魂功能）：
 * ① 预警状态 → 「已处理」 ② 写入处置记录 ③ 老人风险等级自动下调一档（红→黄→绿）
 * ④ 「建议转介」类处置自动生成一条转介记录。
 */
export function handleAlert(
  alertId: number,
  input: { method: string; note: string; handler: string },
): { alert: AlertItem | undefined; elder: Elder | undefined } {
  const alert = alerts.find((a) => a.id === alertId)
  if (!alert) return { alert: undefined, elder: undefined }

  const disposal: Disposal = {
    id: alerts.reduce((n, a) => Math.max(n, a.disposal?.id ?? 0), 0) + 1,
    alert_id: alertId,
    method: input.method,
    note: input.note,
    handler: input.handler,
    created_at: now(),
  }
  alert.status = '已处理'
  alert.method = input.method
  alert.disposal = disposal

  const e = elders.find((x) => x.id === alert.elder_id)
  if (e) {
    e.risk_level = DOWN[e.risk_level]
    e.mood = e.risk_level === 'green' ? '平和' : e.mood
    e.mood_summary = `最近一次处置：${input.method}（已完成跟进）`
  }

  if (input.method.includes('转介')) {
    referrals = [
      ...referrals,
      {
        id: referrals.reduce((n, r) => Math.max(n, r.id), 0) + 1,
        elder_id: alert.elder_id,
        elder_name: alert.elder_name,
        target: '乡镇卫生院 · 转介随访',
        time: now(),
        status: '待跟进',
      },
    ]
  }

  emit()
  return { alert, elder: e ? decorate(e) : undefined }
}

/** 家属提交关怀留言：将于老人下次通话时由乡音自然转达 */
export function addCareMessage(elderId: number, content: string): CareMessage {
  const m: CareMessage = {
    id: ++careSeq,
    elder_id: elderId,
    content: content.trim(),
    conveyed: 0,
    created_at: now(),
  }
  careMessages = [...careMessages, m]
  emit()
  return m
}

/** 乡音已转达留言 → 标记，避免重复转达 */
export function conveyCareMessage(id: number): void {
  const m = careMessages.find((x) => x.id === id)
  if (m) m.conveyed = 1
  emit()
}

/** 家属/村协端的模拟外呼（一键回拨 / 联系村协管员）：仅返回提示文案，不真实拨号 */
export function mockCall(name: string): string {
  return `正在为您呼叫 ${name}…（演示模式，仅作提示）`
}
