import { useEffect, useState } from 'react'
import AppHeader from '../components/AppHeader'
import MoodTrend from '../components/MoodTrend'
import RiskBadge from '../components/RiskBadge'
import BackendNotice from '../components/BackendNotice'
import Toast from '../components/Toast'
import { api, fmtTime } from '../lib/api'
import type { AlertItem, DailyStat, Elder, Summary } from '../lib/api'
import { getElderId } from '../lib/session'

/** 今日活跃日期（本地时区） */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 家属端（FamilyDashboard）：单个老人的亲情视角。
 * 亲情卡片 → 今日陪伴概况 → AI 陪聊小结 → 情绪趋势 → 主动关怀（留言 / 快捷关怀 / 电话提醒）
 * → 风险预警（一键回拨 / 标记已处理）→ 对话摘要（脱敏，点击看气泡回放）→ 联系村协管员。
 *
 * 伦理设计（答辩加分点）：本端**只展示 AI 生成的情绪与话题摘要**，不展示老人的逐字对话记录。
 */
export default function FamilyDashboard() {
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [elder, setElder] = useState<Elder | null>(null)
  const [stats, setStats] = useState<DailyStat[]>([])
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [openSummary, setOpenSummary] = useState<number | null>(null)
  const [careText, setCareText] = useState('')
  const [careSent, setCareSent] = useState(false)
  const [quickSent, setQuickSent] = useState('')
  const [phoneReminder, setPhoneReminder] = useState(false)
  const [busyAlert, setBusyAlert] = useState<number | null>(null)
  const [notice, setNotice] = useState('')

  const load = async () => {
    setError(false)
    try {
      const [detail, alertList, summaryList] = await Promise.all([
        api.get<{ elder: Elder; daily_stats: DailyStat[] }>(`/api/elders/${getElderId()}`),
        api.get<AlertItem[]>(`/api/alerts?elder_id=${getElderId()}`),
        api.get<Summary[]>(`/api/summaries?elder_id=${getElderId()}`),
      ])
      setElder(detail.elder)
      setStats(detail.daily_stats)
      setAlerts(alertList)
      setSummaries([...summaryList].reverse()) // 最近的在前
      setLoaded(true)
    } catch {
      setError(true)
      setLoaded(true)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 2800)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!quickSent) return
    const t = setTimeout(() => setQuickSent(''), 4000)
    return () => clearTimeout(t)
  }, [quickSent])

  /** 家属标记预警已处理（状态更新并同步数据） */
  const markHandled = async (id: number) => {
    setBusyAlert(id)
    try {
      await api.post(`/api/alerts/${id}/handle`, {
        method: '家属已联系',
        note: '家属已确认关注并联系老人',
        handler: `家属 · ${elder?.family_name ?? ''}`,
      })
      await load()
      setNotice('已标记为已处理')
    } catch {
      setNotice('操作失败，请稍后重试')
    }
    setBusyAlert(null)
  }

  /** 一键回拨：模拟拨打老人电话（演示用，仅提示） */
  const callElder = async () => {
    try {
      const res = await api.post<{ message: string }>('/api/mock-call', { name: `${elder?.name ?? ''}奶奶` })
      setNotice(res.message)
    } catch {
      setNotice(`正在为您呼叫 ${elder?.name ?? ''}奶奶…（演示）`)
    }
  }

  /** 联系村协管员：形成「家属 ↔ 村协」联动 */
  const callOfficer = async () => {
    try {
      const res = await api.post<{ message: string }>('/api/mock-call', { name: '村协管员 · 老李' })
      setNotice(res.message)
    } catch {
      setNotice('正在为您接通村协管员 · 老李…（演示）')
    }
  }

  /** 远程关怀快捷操作：把这句话写进"待转达"，乡音会在下次通话时自然说出来 */
  const quickCare = async (label: string, content: string) => {
    try {
      await api.post('/api/care-message', { elder_id: getElderId(), content })
      setQuickSent(label)
    } catch {
      setNotice('发送失败，请稍后重试')
    }
  }

  /** 提交关怀留言：由 AI 在老人下次对话中自然转达 */
  const submitCare = async () => {
    if (!careText.trim()) return
    try {
      await api.post('/api/care-message', { elder_id: getElderId(), content: careText })
      setCareText('')
      setCareSent(true)
      setTimeout(() => setCareSent(false), 5000)
    } catch {
      setNotice('提交失败，请稍后重试')
    }
  }

  /** 「今日提醒我打电话」开关：原型用浏览器 Notification / 纯提示模拟 */
  const toggleReminder = () => {
    if (!phoneReminder) {
      try {
        if ('Notification' in window) {
          Notification.requestPermission().then((p) => {
            if (p === 'granted') {
              new Notification('乡音心伴提醒', {
                body: `今天记得给${elder?.name ?? '奶奶'}打个电话哦 ❤️`,
              })
            }
          })
        }
      } catch {
        /* 忽略：纯提示模拟即可 */
      }
      setNotice('已开启今日电话提醒（演示）')
    }
    setPhoneReminder((v) => !v)
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader subtitle="家属端 · 亲情守护" />
        <main className="flex-1 overflow-y-auto bg-[#fdf8ef]">
          <BackendNotice onRetry={load} />
        </main>
      </div>
    )
  }

  const today = stats.find((s) => s.date === todayStr())
  const daysInactive = elder?.days_inactive ?? 0
  const silent = daysInactive >= 3 // 超过 3 天未对话 → 醒目提醒
  const pendingAlerts = alerts.filter((a) => a.status === '待处理').length

  return (
    <div className="flex h-full flex-col">
      <AppHeader subtitle="家属端 · 亲情守护" />
      <main className="flex-1 overflow-y-auto bg-[#fdf8ef] px-4 py-5 pb-10 md:px-8">
        {!loaded ? (
          <p className="mt-12 text-center text-lg text-stone-400">正在加载守护数据…</p>
        ) : !elder ? null : (
          <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-2">
            {/* ===== 亲情卡片 ===== */}
            <section className="md:col-span-2 flex items-center gap-4 rounded-3xl border border-orange-100 bg-gradient-to-r from-orange-100 via-amber-50 to-yellow-50 p-5 shadow-sm md:p-6">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white text-5xl shadow-md">
                👵
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-bold text-stone-800">{elder.name}奶奶</h2>
                  <RiskBadge level={elder.risk_level} />
                  <span className="rounded-full bg-white px-3 py-1 text-base font-semibold text-stone-500">
                    {elder.mood ?? '平和'}
                  </span>
                  {silent && (
                    <span className="animate-breathe rounded-full bg-[#fbe7e2] px-3 py-1 text-base font-bold text-[#b93f2b]">
                      ⚠️ 已 {daysInactive} 天未说话
                    </span>
                  )}
                </div>
                <p className="mt-1 text-base text-stone-500">
                  {elder.age} 岁 · {elder.living} · {elder.dialect}
                </p>
                <p className="mt-1 text-base text-stone-500">
                  我是她{elder.relation}（{elder.family_name}）· 上次通话：{elder.last_call}
                </p>
              </div>
              <button
                onClick={callElder}
                className="hidden h-12 shrink-0 rounded-full bg-white px-5 text-base font-bold text-orange-600 shadow transition active:scale-95 md:block"
              >
                📞 一键回拨
              </button>
            </section>

            {/* ===== 今日陪伴概况 ===== */}
            <section className="md:col-span-2 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-orange-100 bg-white p-4 text-center shadow-sm">
                <p className="text-4xl font-bold text-orange-500">{today?.rounds ?? 0}</p>
                <p className="mt-1 text-base text-stone-500">今日对话轮次</p>
              </div>
              <div className="rounded-2xl border border-orange-100 bg-white p-4 text-center shadow-sm">
                <p className="text-4xl font-bold text-amber-500">{Math.round(today?.duration_min ?? 0)}</p>
                <p className="mt-1 text-base text-stone-500">今日陪伴（分钟）</p>
              </div>
              <div className="rounded-2xl border border-orange-100 bg-white p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-teal-600">{today?.active_slot ?? '—'}</p>
                <p className="mt-1 text-base text-stone-500">今日活跃时段</p>
              </div>
              <div className="rounded-2xl border border-orange-100 bg-white p-4 text-center shadow-sm">
                <p className={`text-2xl font-bold ${silent ? 'text-[#c2452f]' : 'text-teal-600'}`}>
                  {silent ? `已 ${daysInactive} 天` : '今日有陪伴'}
                </p>
                <p className="mt-1 text-base text-stone-500">{silent ? '未活跃提醒' : '老人状态'}</p>
              </div>
            </section>

            {/* ===== AI 陪聊小结 ===== */}
            {elder.mood_summary && (
              <section className="md:col-span-2 rounded-2xl border border-teal-100 bg-[#e9f6f1] p-4 md:p-5">
                <p className="text-base font-bold text-teal-700">💡 AI 陪聊小结（本周）</p>
                <p className="mt-1 text-base leading-relaxed text-stone-600">{elder.mood_summary}</p>
              </section>
            )}

            {/* ===== 情绪趋势（近 7 天）===== */}
            <section className="rounded-2xl border border-orange-100 bg-white p-4 shadow-sm md:p-5">
              <p className="text-base font-bold text-stone-700">近 7 天情绪温度计</p>
              <p className="mb-2 text-sm text-stone-400">暖黄 = 平稳，暖红 = 低落；点击柱子看当天摘要</p>
              <MoodTrend days={stats} />
            </section>

            {/* ===== 远程关怀操作 ===== */}
            <section className="rounded-2xl border border-orange-100 bg-white p-4 shadow-sm md:p-5">
              <p className="text-base font-bold text-stone-700">远程关怀（一点即达）</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button
                  onClick={() => quickCare('语音问候', '奶奶，我刚想起您了，您今天过得怎么样呀？')}
                  className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-orange-50 text-base font-semibold text-orange-600 transition active:scale-95"
                >
                  <span className="text-2xl">🗣️</span>语音问候
                </button>
                <button
                  onClick={() => quickCare('提醒吃药喝水', '记得按时吃药、多喝些热水，天冷了别着凉。')}
                  className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-amber-50 text-base font-semibold text-[#a2680a] transition active:scale-95"
                >
                  <span className="text-2xl">💊</span>提醒吃药
                </button>
                <button
                  onClick={() => setNotice('已为您打开留言框，写完点「捎给奶奶」就行')}
                  className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-teal-50 text-base font-semibold text-teal-700 transition active:scale-95"
                >
                  <span className="text-2xl">✍️</span>写留言
                </button>
              </div>
              {quickSent && (
                <p className="bubble-in mt-2 rounded-2xl bg-[#e3f2ec] px-3 py-2 text-base text-[#20765c]">
                  ✅ {quickSent}已发送，将于下次通话时由乡音转达
                </p>
              )}

              <textarea
                value={careText}
                onChange={(e) => setCareText(e.target.value)}
                rows={3}
                placeholder="给奶奶捎句话，AI 会在下次通话时自然转达…"
                className="mt-3 w-full rounded-2xl border-2 border-orange-100 bg-orange-50/40 p-3 text-base leading-relaxed text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none"
              />
              <button
                onClick={submitCare}
                className="mt-2 h-12 w-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-lg font-bold text-white transition active:scale-95"
              >
                捎给奶奶 ❤️
              </button>
              {careSent && (
                <p className="bubble-in mt-2 rounded-2xl bg-[#e3f2ec] px-3 py-2 text-base text-[#20765c]">
                  ✅ 已记录，将于奶奶下次通话时自然转达
                </p>
              )}
              <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-between rounded-2xl bg-amber-50 px-3">
                <span className="text-base font-semibold text-stone-700">📞 今日提醒我打电话</span>
                <input
                  type="checkbox"
                  checked={phoneReminder}
                  onChange={toggleReminder}
                  className="h-6 w-6 accent-orange-500"
                />
              </label>
            </section>

            {/* ===== 风险预警（置顶展示，可一键回拨 / 标记已处理）===== */}
            <section className="md:col-span-2 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-bold text-stone-700">风险预警记录（{alerts.length}）</p>
                {pendingAlerts > 0 && (
                  <span className="animate-breathe rounded-full bg-[#fbe7e2] px-3 py-1 text-sm font-bold text-[#b93f2b]">
                    {pendingAlerts} 条待处理
                  </span>
                )}
              </div>
              {alerts.length === 0 && (
                <p className="mt-3 text-base text-stone-400">暂无预警记录，一切安好 😊</p>
              )}
              <div className="mt-3 space-y-3">
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    className={`rounded-2xl border-l-4 bg-orange-50/60 p-3 ${
                      a.status === '待处理' ? 'border-[#c2452f]' : 'border-teal-500'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base text-stone-400">{fmtTime(a.created_at)}</span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-sm font-semibold text-[#b93f2b]">
                        {a.keyword}
                      </span>
                      <span
                        className={`ml-auto rounded-full px-2.5 py-1 text-sm font-bold ${
                          a.status === '待处理'
                            ? 'bg-[#fbe7e2] text-[#b93f2b]'
                            : 'bg-[#e3f2ec] text-[#20765c]'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                    <p className="mt-1.5 text-base leading-relaxed text-stone-700">{a.summary}</p>
                    {a.status === '待处理' ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={callElder}
                          className="h-11 rounded-full border-2 border-[#c2452f] bg-white px-5 text-base font-bold text-[#b93f2b] transition active:scale-95"
                        >
                          📞 一键回拨
                        </button>
                        <button
                          onClick={() => markHandled(a.id)}
                          disabled={busyAlert === a.id}
                          className="h-11 rounded-full bg-orange-500 px-5 text-base font-bold text-white transition active:scale-95 disabled:opacity-50"
                        >
                          {busyAlert === a.id ? '处理中…' : '✓ 标记已处理'}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-stone-400">
                        处置：{a.disposal?.method ?? a.method ?? '已处理'} · {a.disposal?.handler ?? ''}{' '}
                        {a.disposal ? `· ${fmtTime(a.disposal.created_at)}` : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* ===== 对话摘要（脱敏：只给摘要 + 点击查看气泡回放）===== */}
            <section className="md:col-span-2 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm md:p-5">
              <p className="text-base font-bold text-stone-700">对话摘要（历次）</p>
              <p className="mt-0.5 text-sm text-stone-400">点击任一条，查看 AI 脱敏后的对话回放</p>
              <div className="mt-3 space-y-2">
                {summaries.length === 0 && <p className="text-base text-stone-400">暂无摘要</p>}
                {summaries.map((s) => (
                  <div key={s.id} className="overflow-hidden rounded-2xl border border-orange-100 bg-orange-50/40">
                    <button
                      onClick={() => setOpenSummary((v) => (v === s.id ? null : s.id))}
                      className="flex w-full items-start gap-2 p-3 text-left transition active:scale-[0.99]"
                    >
                      <span className="shrink-0 text-base font-semibold text-stone-400">{s.time}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-bold ${
                          s.mood === '低落' || s.mood === '需关注'
                            ? 'bg-[#fbe7e2] text-[#b93f2b]'
                            : 'bg-[#e3f2ec] text-[#20765c]'
                        }`}
                      >
                        {s.mood}
                      </span>
                      <span className="min-w-0 flex-1 text-base leading-relaxed text-stone-700">
                        {s.summary}
                      </span>
                      <span className="shrink-0 text-stone-400">{openSummary === s.id ? '▲' : '▼'}</span>
                    </button>
                    {openSummary === s.id && (
                      <div className="bubble-in space-y-2 border-t border-orange-100 bg-white p-3">
                        {s.turns.length === 0 ? (
                          <p className="text-base text-stone-400">
                            该条来自系统自动预警，无对话回放内容。
                          </p>
                        ) : (
                          s.turns.map((t, i) => (
                            <div
                              key={i}
                              className={`flex ${t.from === 'elder' ? 'justify-end' : 'justify-start'}`}
                            >
                              <span
                                className={`max-w-[80%] rounded-2xl px-3 py-2 text-base leading-relaxed ${
                                  t.from === 'elder'
                                    ? 'rounded-tr-sm bg-orange-100 text-stone-700'
                                    : 'rounded-tl-sm bg-stone-100 text-stone-600'
                                }`}
                              >
                                {t.text}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t border-orange-50 pt-3 text-sm leading-relaxed text-stone-400">
                🔒 隐私与尊严设计：为尊重老人隐私，家属端仅展示 AI 生成的情绪与话题摘要（脱敏回放），
                不提供老人的完整逐字对话记录。该脱敏策略可在后续版本交由老人自主授权开放。
              </p>
            </section>

            {/* ===== 联系村协管员（家属 ↔ 村协联动）===== */}
            <section className="md:col-span-2 flex flex-wrap items-center gap-3 rounded-2xl border border-teal-100 bg-[#e9f6f1] p-4 md:p-5">
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-teal-800">需要村协帮忙？</p>
                <p className="mt-0.5 text-base text-stone-600">
                  您可一键联系网格协管员「老李」，由其上门探访或协助转介乡镇卫生院。
                </p>
              </div>
              <button
                onClick={callOfficer}
                className="h-12 shrink-0 rounded-full bg-teal-600 px-6 text-lg font-bold text-white transition active:scale-95"
              >
                🧑‍🌾 联系村协管员
              </button>
            </section>

            <p className="md:col-span-2 text-center text-sm text-stone-400">
              本 Demo 全部数据来自本地演示数据，不上传服务器
            </p>
          </div>
        )}
      </main>
      <Toast text={notice} />
    </div>
  )
}
