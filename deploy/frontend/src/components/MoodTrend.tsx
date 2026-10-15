import { useState } from 'react'
import type { DailyStat } from '../lib/api'

/**
 * 近 7 天情绪趋势（纯 CSS 柱状，不引 ECharts，移动端也轻快）：
 * 颜色由暖黄（平稳）→ 暖橙 → 暖红（低落）；点击柱子查看当天摘要。
 */
const moodColor = (m: number) =>
  m >= 1 ? '#2f9e77' : m === 0 ? '#e0a63c' : m === -1 ? '#df8941' : '#c2452f'

const moodLabel = (m: number) => (m >= 1 ? '情绪不错' : m === 0 ? '平稳' : m === -1 ? '略低落' : '低落')

export default function MoodTrend({ days }: { days: DailyStat[] }) {
  const list = [...days].reverse() // 后端按日期倒序返回，反转为 旧 → 今
  const [sel, setSel] = useState(Math.max(list.length - 1, 0))
  const selDay = list[Math.min(sel, list.length - 1)]

  if (!selDay) return null

  return (
    <div>
      <div className="flex h-32 items-end gap-1.5">
        {list.map((d, i) => (
          <button
            key={d.date}
            onClick={() => setSel(i)}
            aria-label={`${d.date} ${moodLabel(d.mood)}`}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
          >
            <span
              className={`w-full max-w-8 rounded-t-lg transition-transform ${
                i === sel ? 'scale-105 ring-2 ring-orange-400' : ''
              }`}
              style={{
                height: 22 + ((d.mood + 2) / 4) * 66,
                background: moodColor(d.mood),
              }}
            />
            <span className="text-sm text-stone-400">{d.date.slice(5)}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-base leading-relaxed text-stone-600">
        <span className="font-bold" style={{ color: moodColor(selDay.mood) }}>
          {selDay.date.slice(5)} · {moodLabel(selDay.mood)}
        </span>
        <span className="ml-2">{selDay.note ?? '当日暂无话题摘要'}</span>
      </p>
    </div>
  )
}
