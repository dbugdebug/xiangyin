interface Props {
  emoji: string
  label: string
  desc: string
  selected: boolean
  onSelect: () => void
}

/** 适老化角色大卡片：点选即用，不用下拉框 */
export default function RoleCard({ emoji, label, desc, selected, onSelect }: Props) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex h-full flex-col items-center justify-center rounded-2xl border-2 px-2 py-5 transition-all active:scale-[0.97]
        ${selected
          ? 'border-orange-500 bg-orange-50 shadow-md shadow-orange-200/60'
          : 'border-stone-200 bg-white'}`}
    >
      <span className="text-4xl leading-none">{emoji}</span>
      <span className={`mt-2 text-lg font-bold ${selected ? 'text-orange-600' : 'text-stone-700'}`}>
        {label}
      </span>
      <span className="mt-0.5 text-xs text-stone-400">{desc}</span>
    </button>
  )
}
