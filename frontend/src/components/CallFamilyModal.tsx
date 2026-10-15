import { useEffect, useState } from 'react'

const CONTACTS = [
  { emoji: '👨', name: '儿子 · 王建国' },
  { emoji: '👩', name: '女儿 · 王秀兰' },
  { emoji: '🧑‍🌾', name: '村协管员 · 老李' },
]

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * "一键呼叫家人"弹层：对应产品的求助 / 风险预警转介功能。
 * 演示：点任一联系人即模拟"拨号 + 推送提醒"。
 */
export default function CallFamilyModal({ open, onClose }: Props) {
  const [notified, setNotified] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setNotified(null)
  }, [open])

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 px-4"
      onClick={onClose}
    >
      <div
        className="bubble-in w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-2xl font-bold text-stone-800">📞 呼叫家人</h2>
        <p className="mt-1 text-center text-base text-stone-400">有事儿别憋着，家里人惦记您呢</p>

        <div className="mt-5 space-y-3">
          {CONTACTS.map((c) => (
            <button
              key={c.name}
              onClick={() => setNotified(c.name)}
              className="flex h-16 w-full items-center rounded-2xl border-2 border-orange-200 bg-orange-50 px-5 transition active:scale-[0.99]"
            >
              <span className="text-3xl">{c.emoji}</span>
              <span className="ml-4 text-xl font-semibold text-stone-700">{c.name}</span>
              <span
                className={`ml-auto text-lg font-bold ${notified === c.name ? 'text-emerald-600' : 'text-orange-500'}`}
              >
                {notified === c.name ? '✅ 已通知' : '呼叫'}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-4 text-center text-base text-stone-400">
          （演示：点击联系人即模拟拨打并推送提醒）
        </p>
        <button
          onClick={onClose}
          className="mt-5 h-14 w-full rounded-full bg-stone-100 text-xl font-semibold text-stone-500 transition active:scale-[0.99]"
        >
          关闭
        </button>
      </div>
    </div>
  )
}
