import type { RiskLevel } from '../lib/api'

/** 三档风险等级的统一配色（暖红 / 琥珀 / 青绿，避免刺目纯红） */
export const RISK: Record<RiskLevel, { label: string; text: string; bg: string; dot: string }> = {
  red: { label: '高风险', text: 'text-[#b93f2b]', bg: 'bg-[#fbe7e2]', dot: 'bg-[#c2452f]' },
  yellow: { label: '关注', text: 'text-[#a2680a]', bg: 'bg-[#fdf3dc]', dot: 'bg-[#e2952f]' },
  green: { label: '平稳', text: 'text-[#20765c]', bg: 'bg-[#e3f2ec]', dot: 'bg-[#2f9e77]' },
}

/** 风险等级排序权重（高→低），花名册用 */
export const RISK_ORDER: RiskLevel[] = ['red', 'yellow', 'green']

/** 风险等级小徽章：状态色充足对比，一眼可见 */
export default function RiskBadge({ level, big = false }: { level: RiskLevel; big?: boolean }) {
  const r = RISK[level]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-bold ${r.bg} ${r.text} ${
        big ? 'px-4 py-1.5 text-lg' : 'px-3 py-1 text-base'
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${r.dot}`} />
      {r.label}
    </span>
  )
}
