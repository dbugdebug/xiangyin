/**
 * 结构化风险评估（家属端 / 村协管员端共用）
 * ================================================================
 * 隐私保护底线：本模块**只输出 AI 对老人话语做语义分析后得出的结构化结论**
 * （情绪走向、风险信号、建议动作），**不输出任何原始对话内容、不输出逐字记录**。
 *
 * 五个维度（严格按照需求给定的分类与逻辑）：
 *   ① 情绪与自我价值  ② 家庭与社交适应  ③ 健康与身体状态
 *   ④ 认知与安全风险  ⑤ 经济与生活压力
 *
 * 数据输入：老人档案 + 近 7 天每日统计 + 该老人预警记录（全部为结构化数据）。
 */
import type { AlertItem, DailyStat, Elder, RiskCategory, RiskLevel } from '../types'

export type DimensionKey = 'emotion' | 'family' | 'health' | 'cognition' | 'economy'

/* ================================================================
 * 五大标准风险分类（唯一可展示口径）
 * ------------------------------------------------------------
 * 家属端 / 村协管员端的「预警记录」只允许展示这五个分类标签，
 * 不允许出现任何老人原话或分类之外的描述性文字。
 * ================================================================ */
export const RISK_CATEGORIES: RiskCategory[] = [
  '情绪与自我价值',
  '家庭与社交适应',
  '健康与身体状态',
  '认知与安全风险',
  '经济与生活压力',
]

/** 分类图标（仅作视觉辅助，不改变分类名称） */
export const CATEGORY_ICON: Record<RiskCategory, string> = {
  情绪与自我价值: '💗',
  家庭与社交适应: '🏠',
  健康与身体状态: '🩺',
  认知与安全风险: '🧭',
  经济与生活压力: '💰',
}

/** 兜底分类：任何无法归类 / 异常数据一律落到"情绪与自我价值"，绝不回退成原文 */
export const FALLBACK_CATEGORY: RiskCategory = '情绪与自我价值'

/** 把任意输入强制收敛到五个标准分类之一 */
export function asRiskCategory(v: unknown): RiskCategory {
  return (RISK_CATEGORIES as string[]).includes(String(v))
    ? (String(v) as RiskCategory)
    : FALLBACK_CATEGORY
}

/**
 * 语义信号 → 标准分类（供老人端本地关键词筛查使用）。
 * 注意：入参只是**命中的语义词**，映射结果只保留分类，
 * 原词不会离开老人端、不会写入任何共享数据流。
 */
export function categoryFromSignal(signal: string): RiskCategory {
  const s = String(signal ?? '')
  if (/(不想活|想不开|活着没|活着没啥|不活了|不如死|没盼头|没意思|没滋味|绝望)/.test(s))
    return '情绪与自我价值'
  if (/(孤单|冷清|没人管|没人说|想孩子|一个人|没人陪|孤独)/.test(s))
    return '家庭与社交适应'
  if (/(睡不着|睡不好|失眠|心里闷|闷得慌|难受|没胃口|不想吃|不想动|疼|痛|药|抽筋|头晕)/.test(s))
    return '健康与身体状态'
  if (/(摔|迷路|记不清|忘|煤气|走失|走丢|未对话|未活跃|联系不上)/.test(s))
    return '认知与安全风险'
  if (/(钱|药费|低保|花销|贵|补贴|看病)/.test(s)) return '经济与生活压力'
  return FALLBACK_CATEGORY
}

export interface AssessmentDimension {
  key: DimensionKey
  /** 维度名称 */
  title: string
  icon: string
  /** 该维度风险等级 */
  level: RiskLevel
  /** 等级文案：高风险 / 需关注 / 平稳 */
  levelLabel: string
  /** AI 语义分析得出的观察要点（结构化结论，**不含任何对话原文**） */
  points: string[]
  /** 建议动作 */
  advice: string
}

export interface Assessment {
  elder_id: number
  elder_name: string
  /** 评估更新时间 */
  updated_at: string
  /** 综合风险等级 = 五个维度中最高的一档 */
  overall: RiskLevel
  /** 一句话总体结论 */
  conclusion: string
  dimensions: AssessmentDimension[]
}

const RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 }
const BY_RANK: RiskLevel[] = ['green', 'yellow', 'red']
export const LEVEL_LABEL: Record<RiskLevel, string> = {
  red: '高风险',
  yellow: '需关注',
  green: '平稳',
}

const max = (a: RiskLevel, b: RiskLevel): RiskLevel => (RANK[a] >= RANK[b] ? a : b)

/** 维度 → 标准风险分类（保证评估面板与预警记录口径完全一致） */
export const DIMENSION_CATEGORY: Record<DimensionKey, RiskCategory> = {
  emotion: '情绪与自我价值',
  family: '家庭与社交适应',
  health: '健康与身体状态',
  cognition: '认知与安全风险',
  economy: '经济与生活压力',
}

function fmtDateTime(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 生成一位老人的五分类结构化评估。
 * @param elder  老人档案
 * @param stats  近 7 天每日陪伴统计（情绪分 / 轮次 / 活跃时段）
 * @param alerts 该老人的风险预警记录
 */
export function buildAssessment(
  elder: Elder,
  stats: DailyStat[],
  alerts: AlertItem[],
): Assessment {
  /* 只统计「某标准分类下有几条预警」——完全基于结构化分类，
     不再读取任何文本字段，从源头杜绝老人原话进入评估链路。 */
  const catCount = (c: RiskCategory) => alerts.filter((a) => a.category === c).length
  const emotionHits = catCount('情绪与自我价值')
  const familyHits = catCount('家庭与社交适应')
  const healthHits = catCount('健康与身体状态')
  const cognitionHits = catCount('认知与安全风险')
  const economyHits = catCount('经济与生活压力')

  const recent = [...stats].slice(-7)
  const moodAvg = recent.length
    ? recent.reduce((s, d) => s + (d.mood || 0), 0) / recent.length
    : 0
  const rounds7 = recent.reduce((s, d) => s + (d.rounds || 0), 0)
  const minutes7 = recent.reduce((s, d) => s + (d.duration_min || 0), 0)
  const slots = [...new Set(recent.map((d) => d.active_slot).filter(Boolean))]
  const inactive = elder.days_inactive ?? 0

  /* ---------------- ① 情绪与自我价值 ---------------- */
  let emotion: RiskLevel = elder.risk_level ?? 'green'
  if (elder.mood === '低落') emotion = max(emotion, 'red')
  else if (elder.mood === '需关注') emotion = max(emotion, 'yellow')
  if (moodAvg <= -1.5) emotion = max(emotion, 'red')
  else if (moodAvg <= -0.5) emotion = max(emotion, 'yellow')
  if (emotionHits >= 1) emotion = max(emotion, 'yellow')

  const emotionPoints: string[] = []
  emotionPoints.push(
    `情绪走向：近 ${recent.length || 0} 天情绪均值 ${moodAvg.toFixed(1)}（区间 -2 ~ +2）`,
  )
  emotionPoints.push(
    `风险归类：该分类下预警 ${emotionHits} 条`,
  )
  emotionPoints.push(
    rounds7 > 0
      ? `陪伴强度：近 7 天对话 ${rounds7} 轮 / 约 ${Math.round(minutes7)} 分钟`
      : `陪伴强度：近 7 天无对话记录`,
  )
  emotionPoints.push(
    emotion === 'red'
      ? '语义分析：消极表达与"无价值感"倾向明显，自我肯定感偏低'
      : emotion === 'yellow'
        ? '语义分析：整体平稳，偶有低落与孤独表述'
        : '语义分析：正向表达为主，未见明显消极倾向',
  )

  /* ---------------- ② 家庭与社交适应 ---------------- */
  let family: RiskLevel = 'green'
  if (inactive >= 3) family = max(family, 'red')
  else if (inactive >= 2) family = max(family, 'yellow')
  if (elder.living === '独居' || elder.living === '留守') family = max(family, 'yellow')
  const missFamily = familyHits
  if (missFamily > 0) family = max(family, 'yellow')

  const familyPoints: string[] = [
    `居住情况：${elder.living || '未知'}`,
    `最近活跃：${inactive === 0 ? '今天有对话' : `已 ${inactive} 天未对话`}`,
    missFamily > 0
      ? '社交信号：该分类下存在待关注风险，社会连接偏弱'
      : '社交信号：日常社会连接基本正常',
  ]

  /* ---------------- ③ 健康与身体状态 ---------------- */
  const health: RiskLevel = healthHits >= 2 ? 'red' : healthHits === 1 ? 'yellow' : 'green'

  const healthPoints: string[] = [
    healthHits > 0
      ? `身体信号：该分类下检出 ${healthHits} 条风险预警（睡眠 / 疼痛 / 用药方向）`
      : '身体信号：未检出明显身体不适表述',
    slots.length ? `日常作息：活跃时段集中在 ${slots.join('、')}` : '日常作息：近 7 天无稳定活跃时段',
    health === 'red'
      ? '综合判断：身体不适表述集中，建议结合线下随访确认'
      : health === 'yellow'
        ? '综合判断：存在轻度不适信号，建议持续观察'
        : '综合判断：身体状态表述正常',
  ]

  /* ---------------- ④ 认知与安全风险 ---------------- */
  let cognition: RiskLevel = 'green'
  if (cognitionHits >= 1) cognition = 'red'
  if (elder.living === '独居') cognition = max(cognition, 'yellow')

  const cognitionPoints: string[] = [
    elder.living === '独居'
      ? '居家安全：独居，跌倒 / 用火用电隐患需重点关注'
      : '居家安全：日常有人照应，居家风险较低',
    cognitionHits > 0
      ? `认知信号：检出 ${cognitionHits} 处记忆 / 定向 / 意外相关的风险归类`
      : '认知信号：对话连贯，未见明显记忆或定向异常',
    inactive >= 3 ? '可达性：连续多日无应答，建议尽快确认人身安全' : '可达性：近期可正常取得联系',
  ]

  /* ---------------- ⑤ 经济与生活压力 ---------------- */
  const economy: RiskLevel = economyHits >= 1 ? 'yellow' : 'green'
  const economyPoints: string[] = [
    economyHits > 0
      ? `生活压力：检出 ${economyHits} 处该分类下的风险信号`
      : '生活压力：未检出经济压力相关表述',
    elder.living === '留守' ? '照护资源：子女长期在外，照护资源相对不足' : '照护资源：家庭照护资源基本到位',
  ]

  const dimensions: AssessmentDimension[] = [
    {
      key: 'emotion',
      title: '情绪与自我价值',
      icon: '💗',
      level: emotion,
      levelLabel: LEVEL_LABEL[emotion],
      points: emotionPoints,
      advice:
        emotion === 'red'
          ? '建议 48 小时内家属致电问候 + 村协上门探访，必要时转介乡镇卫生院心理门诊'
          : emotion === 'yellow'
            ? '建议家属本周增加 1 次电话或视频问候，保持陪伴节奏'
            : '维持当前陪伴节奏，无需额外干预',
    },
    {
      key: 'family',
      title: '家庭与社交适应',
      icon: '🏡',
      level: family,
      levelLabel: LEVEL_LABEL[family],
      points: familyPoints,
      advice:
        family === 'red'
          ? '建议协调子女近期返乡或固定通话时间，村协安排上门陪伴'
          : family === 'yellow'
            ? '建议本周安排一次邻里探访或亲属通话，增强社会连接'
            : '家庭联系正常，保持现有往来即可',
    },
    {
      key: 'health',
      title: '健康与身体状态',
      icon: '🩺',
      level: health,
      levelLabel: LEVEL_LABEL[health],
      points: healthPoints,
      advice:
        health === 'red'
          ? '建议村医上门随访，必要时协助转介乡镇卫生院'
          : health === 'yellow'
            ? '提醒按时服药、规律作息，可由家属电话提醒'
            : '维持现有作息与用药节奏',
    },
    {
      key: 'cognition',
      title: '认知与安全风险',
      icon: '🛡️',
      level: cognition,
      levelLabel: LEVEL_LABEL[cognition],
      points: cognitionPoints,
      advice:
        cognition === 'red'
          ? '建议尽快上门查看，排查跌倒、用火用电等隐患'
          : cognition === 'yellow'
            ? '建议加装夜灯 / 防滑垫，村协纳入定期巡访名单'
            : '未见明显安全风险，按常规巡访即可',
    },
    {
      key: 'economy',
      title: '经济与生活压力',
      icon: '🧧',
      level: economy,
      levelLabel: LEVEL_LABEL[economy],
      points: economyPoints,
      advice:
        economy === 'yellow'
          ? '可协助核对医保报销与慢性病用药补助政策，减轻用药负担'
          : '暂无经济帮扶需求',
    },
  ]

  const overall = dimensions.reduce<RiskLevel>(
    (acc, d) => max(acc, d.level),
    'green',
  ) as RiskLevel

  // 综合结论：点名风险最高的维度
  const risky = dimensions
    .filter((d) => d.level !== 'green')
    .sort((a, b) => RANK[b.level] - RANK[a.level])
  const conclusion = risky.length
    ? `综合评估：${LEVEL_LABEL[overall]}。当前风险主要集中在「${risky.map((d) => d.title).join('、')}」，建议优先跟进。`
    : `综合评估：平稳。五个维度均未检出明显风险信号，保持日常陪伴即可。`

  return {
    elder_id: elder.id,
    elder_name: elder.name,
    updated_at: fmtDateTime(),
    overall,
    conclusion,
    dimensions,
  }
}

/** 等级 → 排序（红在前），供列表展示 */
export const LEVEL_ORDER: RiskLevel[] = ['red', 'yellow', 'green']
export { BY_RANK }
