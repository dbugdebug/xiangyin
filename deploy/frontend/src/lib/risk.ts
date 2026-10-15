/**
 * 轻量情绪筛查（演示版关键词检测）
 * ================================================================
 * 老人端每轮对话结束后调用：命中消极 / 高风险表述 → 生成风险上报，
 * 写入共享预警数据流（lib/demoStore.ts），家属端与村协管员端会同步看到红色预警。
 * 这是整场路演的核心叙事起点。
 */

/** 高风险：疑似轻生 / 绝望念头（演示"红色预警 + 立即转介"） */
const HIGH_RISK = ['不想活', '想不开', '活着没', '活着没啥', '不活了', '不如死', '没盼头']

/** 中风险：情绪低落 / 孤独 / 身体不适（演示"关注 + 家属多联系"） */
const MID_RISK = [
  '睡不着', '睡不好', '失眠', '心里闷', '闷得慌', '孤单', '没人管', '没人说',
  '难受', '没胃口', '不想吃', '不想动', '冷清', '想孩子', '没滋味', '没意思',
]

export interface RiskMatch {
  level: 'high' | 'mid'
  /** 命中的风险词，用于展示"命中的风险词或消极表达" */
  keyword: string
}

/** 命中则返回风险等级 + 风险词；未命中返回 null */
export function matchRisk(text: string): RiskMatch | null {
  const high = HIGH_RISK.find((k) => text.includes(k))
  if (high) return { level: 'high', keyword: high }
  const mid = MID_RISK.find((k) => text.includes(k))
  if (mid) return { level: 'mid', keyword: mid }
  return null
}

/** 兼容旧用法：只取风险等级 */
export function detectRisk(text: string): 'high' | 'mid' | null {
  return matchRisk(text)?.level ?? null
}

/** 风险等级 → 展示文案 */
export const RISK_KEYWORD_LABEL: Record<'high' | 'mid', string> = {
  high: '疑似轻生 / 绝望表达',
  mid: '情绪低落 / 孤独表达',
}
