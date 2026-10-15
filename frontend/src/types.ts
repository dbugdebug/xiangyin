/** 用户角色：老人 / 家属 / 村协管员 */
export type Role = 'elder' | 'family' | 'villager'

/** 一条对话消息。offline=true 表示大模型接口不可用时的本地演示回复 */
export interface ChatMsg {
  id: string
  from: 'user' | 'ai'
  text: string
  offline?: boolean
}

/** 一轮语音对话的四个阶段（适老化要求：每个环节单独提示，不能合并成一个"加载中"） */
export type Stage = 'idle' | 'listening' | 'recognizing' | 'generating' | 'speaking'

/* ==================================================================
 * 三端共享的领域模型（老人端风险上报 / 家属端 / 村协管员端共用）
 * 原型阶段数据全部来自本地演示数据层（lib/demoStore.ts），
 * 字段口径沿用 REST 风格，将来接真实后端时页面无需改动。
 * ================================================================== */

/** 风险等级三档：暖红（高风险待处置）/ 琥珀（关注）/ 青绿（平稳） */
export type RiskLevel = 'red' | 'yellow' | 'green'

/** 老人档案 */
export interface Elder {
  id: number
  name: string
  age: number
  /** 方言片区（如"前院村"），村协端按此分组 / 筛选 */
  dialect: string
  /** 居住状态：独居 / 留守 / 与子女同住 */
  living: string
  /** 绑定家属姓名 */
  family_name: string
  /** 绑定关系：孙女 / 子女 / 儿子 … */
  relation: string
  /** 上次通话时间（展示用文案） */
  last_call: string
  risk_level: RiskLevel
  /** 最近一次活跃时间（"今天 09:40" / "3 天前"） */
  last_active: string
  /** AI 陪聊小结（家属端"本周"卡片） */
  mood_summary?: string
  /** 待处置预警数（列表接口附带） */
  pending_count?: number
  /** 距今天数（列表 / 详情接口附带） */
  days_inactive?: number
  /** 今日是否对话过（村协端"今日是否对话"筛选） */
  today_active?: boolean
  /** 最近情绪标签：平和 / 低落 / 需关注 */
  mood?: string
  /** 是否已完成情绪筛查（村协端筛查统计） */
  screened?: boolean
}

/** 每日陪伴统计 + 情绪分（"今日陪伴概况"与"近 7 天情绪趋势"数据源） */
export interface DailyStat {
  id?: number
  elder_id: number
  date: string
  /** 当日对话轮次 */
  rounds: number
  /** 当日陪伴时长（分钟） */
  duration_min: number
  /** 当日活跃时段：上午 / 中午 / 下午 / 晚间 */
  active_slot: string
  /** 情绪分：-2(很低落) ~ +2(很好) */
  mood: number
  /** AI 生成的一日话题摘要（脱敏，不含逐字内容） */
  note?: string | null
}

/** 处置记录（处置闭环审计：谁、什么时间、做了什么） */
export interface Disposal {
  id: number
  alert_id: number
  method: string
  note: string
  handler: string
  created_at: string
}

/** 风险预警 */
export interface AlertItem {
  id: number
  elder_id: number
  elder_name: string
  created_at: string
  /** 命中的风险词 / 消极表达 */
  keyword: string
  /** AI 生成的一句话摘要 */
  summary: string
  status: '待处理' | '已处理'
  /** 严重程度（村协端预警看板排序用；缺省按"高"处理） */
  severity?: 'high' | 'mid'
  /** 处置方式标签（已处理时展示，便于列表速读） */
  method?: string
  disposal?: Disposal | null
}

/** 家属关怀留言 */
export interface CareMessage {
  id: number
  elder_id: number
  content: string
  /** 0=未转达 1=已由乡音转达 */
  conveyed: number
  created_at: string
}

/** 全村统计卡数据 */
export interface Stats {
  total: number
  today_active: number
  pending_alerts: number
  weekly_new_risks: number
  /** 高风险人数（红档） */
  high_risk: number
}

/** 脱敏对话回放的单个气泡 */
export interface ChatTurn {
  from: 'elder' | 'ai'
  text: string
}

/** 历次对话摘要（家属端 / 村协端"对话摘要"页：只给摘要 + 脱敏气泡回放，不给逐字记录） */
export interface Summary {
  id: number
  elder_id: number
  time: string
  mood: string
  summary: string
  turns: ChatTurn[]
}

/** 转介对象类型：乡镇卫生院 / 村医 / 家属 */
export interface Referral {
  id: number
  elder_id: number
  elder_name: string
  /** 转介对象：乡镇卫生院 · 心理咨询 / 村医 · 上门随访 … */
  target: string
  time: string
  status: '已联系' | '随访中' | '已完成' | '待跟进'
}

/** 筛查与统计（村协端） */
export interface ScreenStat {
  total: number
  screened: number
  /** 筛查完成率 0~1 */
  rate: number
  byLevel: Record<RiskLevel, number>
}
