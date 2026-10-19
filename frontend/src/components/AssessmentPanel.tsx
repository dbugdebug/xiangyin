import type { RiskLevel } from '../types'
import type { Assessment, AssessmentDimension } from '../lib/assessment'
import { LEVEL_LABEL } from '../lib/assessment'

/** 等级样式：红（高风险）/ 琥珀（需关注）/ 青绿（平稳） */
const LEVEL_STYLE: Record<RiskLevel, { chip: string; bar: string; text: string }> = {
  red: {
    chip: 'bg-[#fbe7e2] text-[#b93f2b]',
    bar: 'bg-[#c2452f]',
    text: 'border-[#e6c3bb] bg-[#fdf1ee]',
  },
  yellow: {
    chip: 'bg-[#fdf3dc] text-[#a2680a]',
    bar: 'bg-[#e2952f]',
    text: 'border-[#ecd6a8] bg-[#fdf8ea]',
  },
  green: {
    chip: 'bg-[#e3f2ec] text-[#20765c]',
    bar: 'bg-[#2f9e77]',
    text: 'border-teal-100 bg-[#eef8f4]',
  },
}

function DimensionCard({ d }: { d: AssessmentDimension }) {
  const st = LEVEL_STYLE[d.level]
  return (
    <div className={`rounded-2xl border-2 p-4 ${st.text}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl">{d.icon}</span>
        <p className="text-lg font-bold text-stone-800">{d.title}</p>
        <span className={`ml-auto rounded-full px-3 py-1 text-sm font-bold ${st.chip}`}>
          {d.levelLabel}
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {d.points.map((p, i) => (
          <li key={i} className="flex gap-2 text-base leading-relaxed text-stone-600">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${st.bar}`} />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 rounded-xl bg-white/70 px-3 py-2 text-base leading-relaxed text-stone-600">
        <span className="font-bold text-stone-700">建议 · </span>
        {d.advice}
      </p>
    </div>
  )
}

/**
 * AI 结构化风险评估面板（家属端 / 村协管员端共用）：
 * 严格按照「情绪与自我价值 / 家庭与社交适应 / 健康与身体状态 / 认知与安全风险 / 经济与生活压力」
 * 五个维度呈现老人状态，**不含任何原始对话内容**。
 */
export default function AssessmentPanel({
  assessment,
  compact = false,
}: {
  assessment: Assessment | null
  /** 紧凑模式：用于村协端单人详情弹层 */
  compact?: boolean
}) {
  if (!assessment) {
    return (
      <p className="mt-2 text-base text-stone-400">正在生成结构化评估…</p>
    )
  }

  const st = LEVEL_STYLE[assessment.overall]

  return (
    <section className={`rounded-2xl border border-orange-100 bg-white p-4 shadow-sm ${compact ? '' : 'md:p-5'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-bold text-stone-700">🧠 AI 结构化风险评估</p>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${st.chip}`}>
          综合：{LEVEL_LABEL[assessment.overall]}
        </span>
        <span className="ml-auto text-sm text-stone-400">更新于 {assessment.updated_at.slice(5)}</span>
      </div>

      <p className="mt-2 rounded-2xl bg-orange-50/70 px-3 py-2.5 text-base leading-relaxed text-stone-700">
        {assessment.conclusion}
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {assessment.dimensions.map((d) => (
          <DimensionCard key={d.key} d={d} />
        ))}
      </div>

      <p className="mt-3 border-t border-orange-50 pt-3 text-sm leading-relaxed text-stone-400">
        🔒 隐私与尊严设计：本面板仅呈现 AI 对老人话语做语义分析后得出的结构化结论与建议，
        全程不展示、不存储老人的原始对话内容；老人端亦无任何"被查看"提示。
      </p>
    </section>
  )
}
