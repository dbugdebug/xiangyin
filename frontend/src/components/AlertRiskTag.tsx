import { CATEGORY_ICON } from '../lib/assessment'
import type { RiskCategory } from '../types'

interface Props {
  /** 风险类型：只能取五个标准分类之一 */
  category: RiskCategory
  status: '待处理' | '已处理'
  /** 紧凑模式（弹层 / 移动端） */
  compact?: boolean
}

/**
 * 预警记录的**唯一风险描述口径**（家属端 / 村协管员端共用）
 * ================================================================
 * 隐私合规：这里**只渲染「风险类型（五大标准分类）」+「状态」**，
 * 不渲染任何老人原话、风险词、对话摘要或分类之外的描述性文字。
 *
 * 展示形态：风险类型：情绪与自我价值 | 状态：待处理
 */
export default function AlertRiskTag({ category, status, compact = false }: Props) {
  const pending = status === '待处理'
  return (
    <div
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${
        compact ? 'text-base' : 'text-lg'
      }`}
    >
      <span className="text-stone-500">风险类型：</span>
      <span
        className={`rounded-full px-2.5 py-1 font-bold ${
          pending ? 'bg-[#fbe7e2] text-[#b93f2b]' : 'bg-[#e3f2ec] text-[#20765c]'
        }`}
      >
        {CATEGORY_ICON[category]} {category}
      </span>
      <span className="text-stone-300">|</span>
      <span className="text-stone-500">状态：</span>
      <span className={`font-bold ${pending ? 'text-[#b93f2b]' : 'text-[#20765c]'}`}>{status}</span>
    </div>
  )
}
