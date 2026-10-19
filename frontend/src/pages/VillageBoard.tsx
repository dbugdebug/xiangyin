import { useEffect, useMemo, useState } from 'react'
import AppHeader from '../components/AppHeader'
import MoodTrend from '../components/MoodTrend'
import RiskBadge, { RISK, RISK_ORDER } from '../components/RiskBadge'
import AlertRiskTag from '../components/AlertRiskTag'
import AssessmentPanel from '../components/AssessmentPanel'
import BackendNotice from '../components/BackendNotice'
import Toast from '../components/Toast'
import { api, fmtTime } from '../lib/api'
import type { AlertItem, Assessment, DailyStat, Elder, Referral, RiskLevel, ScreenStat, Stats } from '../lib/api'

/** 处置方式（处置闭环表单 / 预警看板快捷动作） */
const METHODS = [
  '电话回访',
  '上门探访',
  '已联系家属',
  '建议转介乡镇卫生院',
  '暂不处置需继续观察',
]

/** 预警看板快捷动作：一键完成处置（演示"红点变绿"最快路径） */
const QUICK_ACTIONS = ['电话回访', '上门探访', '建议转介乡镇卫生院', '暂不处置需继续观察']

type RiskFilter = 'all' | 'attention' | RiskLevel
type TodayFilter = 'all' | 'yes' | 'no'
type Tab = 'overview' | 'alerts' | 'screen' | 'referrals'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: '📊 全村总览' },
  { key: 'alerts', label: '🚨 预警看板' },
  { key: 'screen', label: '📋 筛查统计' },
  { key: 'referrals', label: '🏥 转介记录' },
]

/**
 * 村协管员端（VillageBoard）：全村网格化管理视角。
 * 工作总览（四统计卡）→ 花名册（三色 / 筛选 / 搜索 / 今日需关注 / 片区分布）
 * → 预警看板（全村预警，按时间或严重程度排序，可快捷处置）
 * → 筛查统计（完成率 + 风险占比）→ 转介记录
 * → 单人详情（趋势 + 全部预警 + 处置记录 + 处置闭环表单，现场可见"红点变绿"）。
 */
export default function VillageBoard() {
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [elders, setElders] = useState<Elder[]>([])
  const [allAlerts, setAllAlerts] = useState<AlertItem[]>([])
  const [screen, setScreen] = useState<ScreenStat | null>(null)
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [livingFilter, setLivingFilter] = useState('all')
  const [dialectFilter, setDialectFilter] = useState('all')
  const [todayFilter, setTodayFilter] = useState<TodayFilter>('all')
  const [query, setQuery] = useState('')
  const [alertSort, setAlertSort] = useState<'time' | 'severity'>('severity')
  const [notice, setNotice] = useState('')

  // 单人详情
  const [detail, setDetail] = useState<{ elder: Elder; daily_stats: DailyStat[] } | null>(null)
  const [detailAlerts, setDetailAlerts] = useState<AlertItem[]>([])
  const [detailAssessment, setDetailAssessment] = useState<Assessment | null>(null)
  const [expandForm, setExpandForm] = useState<number | null>(null) // 展开处置表单的预警 id
  const [method, setMethod] = useState(METHODS[0])
  const [note, setNote] = useState('')
  const [handling, setHandling] = useState(false)

  const load = async () => {
    setError(false)
    try {
      const [s, e, a, sc, r] = await Promise.all([
        api.get<Stats>('/api/stats'),
        api.get<Elder[]>('/api/elders'),
        api.get<AlertItem[]>('/api/alerts'),
        api.get<ScreenStat>('/api/screen-stats'),
        api.get<Referral[]>('/api/referrals'),
      ])
      setStats(s)
      setElders(e)
      setAllAlerts(a)
      setScreen(sc)
      setReferrals(r)
      setLoaded(true)
    } catch {
      setError(true)
      setLoaded(true)
    }
  }

  useEffect(() => {
    load()
    // 让老人端新产生的预警和家属端的处理结果在其他设备上自动同步。
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 10000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(t)
  }, [notice])

  /** 打开单人详情：档案 + 情绪趋势 + 全部预警（含处置记录） */
  const openDetail = async (id: number) => {
    setExpandForm(null)
    setNote('')
    try {
      const [d, a, assess] = await Promise.all([
        api.get<{ elder: Elder; daily_stats: DailyStat[] }>(`/api/elders/${id}`),
        api.get<AlertItem[]>(`/api/alerts?elder_id=${id}`),
        api.get<Assessment>(`/api/assessment?elder_id=${id}`),
      ])
      setDetail(d)
      setDetailAlerts(a)
      setDetailAssessment(assess)
    } catch {
      setNotice('详情加载失败，请重试')
    }
  }

  /**
   * 处置闭环（村协端灵魂功能）：
   * 提交后 → 预警状态转「已处理」→ 写入处置记录 → 老人风险等级自动下调一档（红→黄→绿）。
   */
  const submitDisposal = async (alertId: number, fixMethod?: string, fixNote?: string) => {
    setHandling(true)
    const useMethod = fixMethod ?? method
    const useNote = fixNote ?? note
    try {
      const res = await api.post<{ elder?: Elder }>(`/api/alerts/${alertId}/handle`, {
        method: useMethod,
        note: useNote,
        handler: '村协管员 · 老李',
      })
      const e = res.elder
      setNotice(
        e
          ? `处置成功！${e.name} 风险等级已下调为「${RISK[e.risk_level].label}」`
          : '处置成功',
      )
      setExpandForm(null)
      setNote('')
      // 刷新看板统计 + 花名册 + 预警看板 + 详情，现场可见"红点变绿"
      await load()
      if (detail) await openDetail(detail.elder.id)
    } catch {
      setNotice('处置失败，请稍后重试')
    }
    setHandling(false)
  }

  /** 导出「今日需关注」清单为 CSV（加分项，原型级实现） */
  const exportCsv = () => {
    const list = filtered.filter((e) => e.risk_level !== 'green')
    if (list.length === 0) {
      setNotice('当前没有需关注的老人')
      return
    }
    const head = '\ufeff序号,姓名,年龄,状态,方言片区,最近活跃,风险等级,待处置预警\n'
    const rows = list
      .map(
        (e, i) =>
          `${i + 1},${e.name},${e.age},${e.living},${e.dialect},${e.last_active},${RISK[e.risk_level].label},${e.pending_count ?? 0}`,
      )
      .join('\n')
    const blob = new Blob([head + rows], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `今日需关注名单_${new Date().toLocaleDateString('zh-CN')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 花名册：按风险等级从高到低排序（同档按待处置数）
  const filtered = useMemo(() => {
    return [...elders]
      .sort(
        (a, b) =>
          RISK_ORDER.indexOf(a.risk_level) - RISK_ORDER.indexOf(b.risk_level) ||
          (b.pending_count ?? 0) - (a.pending_count ?? 0),
      )
      .filter((e) => {
        const riskOk =
          riskFilter === 'all'
            ? true
            : riskFilter === 'attention'
              ? e.risk_level !== 'green'
              : e.risk_level === riskFilter
        const livingOk = livingFilter === 'all' || e.living === livingFilter
        const dialectOk = dialectFilter === 'all' || e.dialect === dialectFilter
        const todayOk =
          todayFilter === 'all' ? true : todayFilter === 'yes' ? !!e.today_active : !e.today_active
        const queryOk = !query || e.name.includes(query)
        return riskOk && livingOk && dialectOk && todayOk && queryOk
      })
  }, [elders, riskFilter, livingFilter, dialectFilter, todayFilter, query])

  // 方言片区分布（加分项：片区计数，点击即筛选）
  const dialects = useMemo(() => {
    const m = new Map<string, number>()
    elders.forEach((e) => m.set(e.dialect, (m.get(e.dialect) ?? 0) + 1))
    return [...m.entries()]
  }, [elders])

  // 预警看板：按严重程度（默认）或时间排序；同严重程度内时间倒序
  const sortedAlerts = useMemo(() => {
    const sev = (a: AlertItem) => (a.severity === 'mid' ? 1 : 0)
    const list = [...allAlerts]
    if (alertSort === 'severity') {
      list.sort(
        (a, b) =>
          Number(a.status === '已处理') - Number(b.status === '已处理') ||
          sev(a) - sev(b) ||
          (a.created_at < b.created_at ? 1 : -1),
      )
    } else {
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    }
    return list
  }, [allAlerts, alertSort])

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader subtitle="村协管员端 · 全村守护" />
        <main className="flex-1 overflow-y-auto bg-[#fdf8ef]">
          <BackendNotice onRetry={load} />
        </main>
      </div>
    )
  }

  const d = detail?.elder

  return (
    <div className="flex h-full flex-col">
      <AppHeader subtitle="村协管员端 · 全村守护" />

      <main className="flex-1 overflow-y-auto bg-[#fdf8ef] px-4 py-5 pb-10 md:px-8">
        {!loaded ? (
          <p className="mt-12 text-center text-lg text-stone-400">正在加载全村数据…</p>
        ) : (
          <div className="mx-auto max-w-6xl">
            {/* ===== 工作总览：四个统计卡 ===== */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-orange-100 bg-white p-4 text-center shadow-sm">
                <p className="text-4xl font-bold text-stone-700">{stats?.total ?? 0}</p>
                <p className="mt-1 text-base text-stone-500">在册老人总数</p>
              </div>
              <div className="rounded-2xl border border-orange-100 bg-white p-4 text-center shadow-sm">
                <p className="text-4xl font-bold text-teal-600">{stats?.today_active ?? 0}</p>
                <p className="mt-1 text-base text-stone-500">今日活跃人数</p>
              </div>
              <div className="rounded-2xl border border-[#eab5aa] bg-[#fbe7e2] p-4 text-center shadow-sm">
                <p className="text-4xl font-bold text-[#b93f2b]">{stats?.pending_alerts ?? 0}</p>
                <p className="mt-1 text-base text-[#8a4a38]">待处置预警数</p>
              </div>
              <div className="rounded-2xl border border-[#f0cf9a] bg-[#fdf3dc] p-4 text-center shadow-sm">
                <p className="text-4xl font-bold text-[#a2680a]">{stats?.high_risk ?? 0}</p>
                <p className="mt-1 text-base text-[#8a6a2a]">高风险人数</p>
              </div>
            </div>

            {/* ===== 视图切换 ===== */}
            <div className="mt-4 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`h-11 rounded-full px-4 text-base font-bold transition active:scale-95 ${
                    tab === t.key ? 'bg-orange-500 text-white shadow' : 'bg-white text-stone-600 shadow-sm'
                  }`}
                >
                  {t.label}
                  {t.key === 'alerts' && (stats?.pending_alerts ?? 0) > 0 && (
                    <span className="ml-2 rounded-full bg-white/90 px-2 py-0.5 text-sm text-[#b93f2b]">
                      {stats?.pending_alerts}
                    </span>
                  )}
                </button>
              ))}
              <button
                onClick={exportCsv}
                className="ml-auto h-11 rounded-full border-2 border-orange-300 bg-white px-4 text-base font-bold text-orange-500 transition active:scale-95"
              >
                ⬇️ 导出关注名单
              </button>
            </div>

            {/* ============== 视图一：全村总览（花名册） ============== */}
            {tab === 'overview' && (
              <>
                {/* 筛选与搜索 */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {/* 今日需关注：一键只看红+黄 */}
                  <button
                    onClick={() => setRiskFilter((v) => (v === 'attention' ? 'all' : 'attention'))}
                    className={`h-11 rounded-full px-4 text-base font-bold transition active:scale-95 ${
                      riskFilter === 'attention'
                        ? 'bg-[#c2452f] text-white'
                        : 'bg-[#fbe7e2] text-[#b93f2b]'
                    }`}
                  >
                    ⚡ 今日需关注（红 + 黄）
                  </button>
                  <select
                    value={riskFilter === 'attention' ? 'all' : riskFilter}
                    onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
                    className="h-11 rounded-full border-2 border-orange-100 bg-white px-3 text-base text-stone-600"
                  >
                    <option value="all">全部风险等级</option>
                    <option value="red">高风险</option>
                    <option value="yellow">关注</option>
                    <option value="green">平稳</option>
                  </select>
                  <select
                    value={todayFilter}
                    onChange={(e) => setTodayFilter(e.target.value as TodayFilter)}
                    className="h-11 rounded-full border-2 border-orange-100 bg-white px-3 text-base text-stone-600"
                  >
                    <option value="all">今日是否对话</option>
                    <option value="yes">今日已对话</option>
                    <option value="no">今日未对话</option>
                  </select>
                  <select
                    value={livingFilter}
                    onChange={(e) => setLivingFilter(e.target.value)}
                    className="h-11 rounded-full border-2 border-orange-100 bg-white px-3 text-base text-stone-600"
                  >
                    <option value="all">全部状态</option>
                    <option value="独居">独居</option>
                    <option value="留守">留守</option>
                    <option value="与子女同住">与子女同住</option>
                  </select>
                  <select
                    value={dialectFilter}
                    onChange={(e) => setDialectFilter(e.target.value)}
                    className="h-11 rounded-full border-2 border-orange-100 bg-white px-3 text-base text-stone-600"
                  >
                    <option value="all">全部片区</option>
                    {dialects.map(([name, count]) => (
                      <option key={name} value={name}>
                        {name}（{count}人）
                      </option>
                    ))}
                  </select>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="🔍 搜索姓名"
                    className="h-11 min-w-32 flex-1 rounded-full border-2 border-orange-100 bg-white px-4 text-base placeholder:text-stone-400 focus:border-orange-400 focus:outline-none"
                  />
                </div>

                {/* 方言片区分布（加分项） */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {dialects.map(([name, count]) => (
                    <button
                      key={name}
                      onClick={() => setDialectFilter((v) => (v === name ? 'all' : name))}
                      className={`h-9 rounded-full px-3 text-sm transition ${
                        dialectFilter === name
                          ? 'bg-orange-500 font-bold text-white'
                          : 'bg-orange-50 text-stone-500'
                      }`}
                    >
                      {name} · {count} 人
                    </button>
                  ))}
                </div>

                {/* 老人花名册（按风险从高到低） */}
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => openDetail(e.id)}
                      className={`flex items-center gap-3 rounded-2xl border-l-8 bg-white p-4 text-left shadow-sm transition hover:shadow-md active:scale-[0.99] ${
                        e.risk_level === 'red'
                          ? 'border-[#c2452f]'
                          : e.risk_level === 'yellow'
                            ? 'border-[#e2952f]'
                            : 'border-[#2f9e77]'
                      }`}
                    >
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-50 text-3xl">
                        {e.age >= 75 ? '👵' : '👴'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-stone-800">{e.name}</span>
                          {(e.pending_count ?? 0) > 0 && (
                            <span className="rounded-full bg-[#fbe7e2] px-2 py-0.5 text-sm font-bold text-[#b93f2b]">
                              {e.pending_count} 条待处置
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-base text-stone-500">
                          {e.age}岁 · {e.living} · 最近情绪：{e.mood ?? '平和'}
                        </p>
                        <p className="text-sm text-stone-400">
                          最近活跃：
                          {(e.days_inactive ?? 0) === 0
                            ? '今天'
                            : `${e.days_inactive} 天前（${e.last_active}）`}
                        </p>
                      </div>
                      <RiskBadge level={e.risk_level} />
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="col-span-full mt-6 text-center text-lg text-stone-400">
                      没有符合条件的老人
                    </p>
                  )}
                </div>
              </>
            )}

            {/* ============== 视图二：全村风险预警看板 ============== */}
            {tab === 'alerts' && (
              <div className="mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-bold text-stone-700">全村预警（{sortedAlerts.length} 条）</p>
                  <div className="flex overflow-hidden rounded-full border-2 border-orange-100">
                    <button
                      onClick={() => setAlertSort('severity')}
                      className={`h-10 px-4 text-base transition ${
                        alertSort === 'severity' ? 'bg-orange-500 font-bold text-white' : 'bg-white text-stone-600'
                      }`}
                    >
                      按严重程度
                    </button>
                    <button
                      onClick={() => setAlertSort('time')}
                      className={`h-10 px-4 text-base transition ${
                        alertSort === 'time' ? 'bg-orange-500 font-bold text-white' : 'bg-white text-stone-600'
                      }`}
                    >
                      按时间
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  {sortedAlerts.length === 0 && (
                    <p className="text-base text-stone-400">暂无预警记录</p>
                  )}
                  {sortedAlerts.map((a) => (
                    <div
                      key={a.id}
                      className={`rounded-2xl border-l-4 bg-white p-4 shadow-sm ${
                        a.status === '待处理'
                          ? a.severity === 'mid'
                            ? 'border-[#e2952f]'
                            : 'border-[#c2452f]'
                          : 'border-teal-500'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
                            a.status === '已处理'
                              ? 'bg-[#e3f2ec] text-[#20765c]'
                              : a.severity === 'mid'
                                ? 'bg-[#fdf3dc] text-[#a2680a]'
                                : 'bg-[#fbe7e2] text-[#b93f2b]'
                          }`}
                        >
                          {a.status === '已处理'
                            ? '已处理'
                            : a.severity === 'mid'
                              ? '关注'
                              : '高风险'}
                        </span>
                        <button
                          onClick={() => openDetail(a.elder_id)}
                          className="text-lg font-bold text-stone-800 underline decoration-orange-200 underline-offset-4"
                        >
                          {a.elder_name}
                        </button>
                        <span className="text-base text-stone-400">{fmtTime(a.created_at)}</span>
                      </div>
                      {/* 风险描述：只展示「标准分类 + 状态」，无任何老人原话 */}
                      <div className="mt-2">
                        <AlertRiskTag category={a.category} status={a.status} />
                      </div>

                      {a.disposal && (
                        <p className="mt-2 rounded-xl bg-[#f7f4ee] px-3 py-2 text-sm leading-relaxed text-stone-500">
                          ✅ 处置记录：{a.disposal.handler} 于 {fmtTime(a.disposal.created_at)}「
                          {a.disposal.method}」——{a.disposal.note}
                        </p>
                      )}

                      {a.status === '待处理' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {QUICK_ACTIONS.map((m) => (
                            <button
                              key={m}
                              onClick={() => submitDisposal(a.id, m, `${m}（预警看板快捷处置）`)}
                              disabled={handling}
                              className={`h-11 rounded-full px-4 text-base font-bold transition active:scale-95 disabled:opacity-50 ${
                                m.includes('转介')
                                  ? 'bg-teal-600 text-white'
                                  : 'border-2 border-orange-300 bg-white text-orange-600'
                              }`}
                            >
                              {m === '电话回访'
                                ? '📞 电话回访'
                                : m === '上门探访'
                                  ? '🚪 上门探访'
                                  : m.includes('转介')
                                    ? '🏥 转介卫生院'
                                    : '👀 继续观察'}
                            </button>
                          ))}
                          <button
                            onClick={() => openDetail(a.elder_id)}
                            className="h-11 rounded-full bg-stone-100 px-4 text-base text-stone-600 transition active:scale-95"
                          >
                            详细处置
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ============== 视图三：筛查与统计 ============== */}
            {tab === 'screen' && screen && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <section className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
                  <p className="text-base font-bold text-stone-700">情绪筛查完成率</p>
                  <p className="mt-2 text-5xl font-bold text-orange-500">
                    {Math.round(screen.rate * 100)}
                    <span className="text-2xl">%</span>
                  </p>
                  <p className="mt-1 text-base text-stone-500">
                    已筛查 {screen.screened} 人 / 在册 {screen.total} 人
                  </p>
                  <div className="mt-3 h-4 w-full overflow-hidden rounded-full bg-orange-50">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                      style={{ width: `${Math.round(screen.rate * 100)}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-stone-400">
                    筛查在老人日常聊天中轻量完成（对话式情绪量表），无需老人额外操作、不产生负担。
                  </p>
                </section>

                <section className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
                  <p className="text-base font-bold text-stone-700">各风险等级占比</p>
                  <div className="mt-3 space-y-3">
                    {RISK_ORDER.map((lv) => {
                      const n = screen.byLevel[lv]
                      const pct = screen.total ? Math.round((n / screen.total) * 100) : 0
                      return (
                        <div key={lv}>
                          <div className="flex items-center gap-2">
                            <RiskBadge level={lv} />
                            <span className="ml-auto text-base text-stone-500">
                              {n} 人 · {pct}%
                            </span>
                          </div>
                          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-stone-100">
                            <div
                              className={`h-full rounded-full ${RISK[lv].dot}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-4 border-t border-orange-50 pt-3 text-base text-stone-500">
                    本周新增风险 <span className="text-xl font-bold text-amber-500">{stats?.weekly_new_risks ?? 0}</span> 条
                    · 待处置 <span className="text-xl font-bold text-[#b93f2b]">{stats?.pending_alerts ?? 0}</span> 条
                  </p>
                </section>
              </div>
            )}

            {/* ============== 视图四：转介记录 ============== */}
            {tab === 'referrals' && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm">
                <table className="w-full text-left">
                  <thead className="bg-orange-50 text-base text-stone-600">
                    <tr>
                      <th className="px-4 py-3 font-bold">老人</th>
                      <th className="px-4 py-3 font-bold">转介对象</th>
                      <th className="px-4 py-3 font-bold">时间</th>
                      <th className="px-4 py-3 font-bold">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((r) => (
                      <tr key={r.id} className="border-t border-orange-50 text-base text-stone-700">
                        <td className="px-4 py-3 font-semibold">
                          <button
                            onClick={() => openDetail(r.elder_id)}
                            className="underline decoration-orange-200 underline-offset-4"
                          >
                            {r.elder_name}
                          </button>
                        </td>
                        <td className="px-4 py-3">{r.target}</td>
                        <td className="px-4 py-3 text-stone-500">{r.time}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-3 py-1 text-sm font-bold ${
                              r.status === '已完成'
                                ? 'bg-[#e3f2ec] text-[#20765c]'
                                : r.status === '随访中'
                                  ? 'bg-[#fdf3dc] text-[#a2680a]'
                                  : 'bg-[#fbe7e2] text-[#b93f2b]'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {referrals.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-base text-stone-400">
                          暂无转介记录
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-6 text-center text-sm text-stone-400">
              本 Demo 全部数据来自本地演示数据，不上传服务器
            </p>
          </div>
        )}
      </main>

      {/* ===== 单人详情弹层：趋势 + 预警 + 处置闭环 ===== */}
      {detail && d && (
        <div
          className="absolute inset-0 z-30 flex items-end justify-center bg-black/45 md:items-center"
          onClick={() => setDetail(null)}
        >
          <div
            className="bubble-in max-h-full w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl md:rounded-3xl md:p-6"
            onClick={(ev) => ev.stopPropagation()}
          >
            {/* 档案头部 */}
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-50 text-3xl">
                {d.age >= 75 ? '👵' : '👴'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-bold text-stone-800">{d.name}</h2>
                  <RiskBadge level={d.risk_level} big />
                </div>
                <p className="text-base text-stone-500">
                  {d.age}岁 · {d.living} · {d.dialect} · 家属：{d.family_name}（{d.relation}）
                </p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="h-11 shrink-0 rounded-full bg-stone-100 px-4 text-base text-stone-500"
              >
                关闭
              </button>
            </div>

            {/* 情绪趋势 */}
            <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50/40 p-4">
              <p className="text-base font-bold text-stone-700">近 7 天情绪趋势</p>
              <MoodTrend days={detail.daily_stats} />
            </div>

            {/* AI 结构化风险评估（五分类，与家属端同口径；不含任何对话原文） */}
            <div className="mt-4">
              <AssessmentPanel assessment={detailAssessment} compact />
            </div>

            {/* 预警与处置记录 */}
            <div className="mt-4">
              <p className="text-base font-bold text-stone-700">预警记录与处置闭环</p>
              {detailAlerts.length === 0 && (
                <p className="mt-2 text-base text-stone-400">暂无预警记录</p>
              )}
              <div className="mt-2 space-y-3">
                {detailAlerts.map((a) => (
                  <div
                    key={a.id}
                    className={`rounded-2xl border-l-4 bg-orange-50/60 p-3 ${
                      a.status === '待处理' ? 'border-[#c2452f]' : 'border-teal-500'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base text-stone-400">{fmtTime(a.created_at)}</span>
                    </div>
                    {/* 风险描述：只展示「标准分类 + 状态」，无任何老人原话 */}
                    <div className="mt-1.5">
                      <AlertRiskTag category={a.category} status={a.status} compact />
                    </div>

                    {/* 历史处置记录：谁在什么时间做了什么 */}
                    {a.disposal && (
                      <p className="mt-2 rounded-xl bg-white px-3 py-2 text-sm leading-relaxed text-stone-500">
                        ✅ 处置记录：{a.disposal.handler} 于 {fmtTime(a.disposal.created_at)}「
                        {a.disposal.method}」——{a.disposal.note}
                      </p>
                    )}

                    {/* 待处置 → 处置闭环表单 */}
                    {a.status === '待处理' &&
                      (expandForm === a.id ? (
                        <div className="bubble-in mt-2 rounded-2xl bg-white p-3">
                          <select
                            value={method}
                            onChange={(e) => setMethod(e.target.value)}
                            className="h-11 w-full rounded-xl border-2 border-orange-100 bg-white px-3 text-base text-stone-700"
                          >
                            {METHODS.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            placeholder="填写处置说明（回访情况、老人反馈等）"
                            className="mt-2 w-full rounded-xl border-2 border-orange-100 p-2.5 text-base text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => submitDisposal(a.id)}
                              disabled={handling}
                              className="h-12 flex-1 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 text-base font-bold text-white transition active:scale-95 disabled:opacity-50"
                            >
                              {handling ? '提交中…' : '提交处置（风险等级下调一档）'}
                            </button>
                            <button
                              onClick={() => setExpandForm(null)}
                              className="h-12 rounded-full bg-stone-100 px-4 text-base text-stone-500"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setExpandForm(a.id)
                            setMethod(METHODS[0])
                          }}
                          className="mt-2 h-11 rounded-full bg-[#c2452f] px-5 text-base font-bold text-white transition active:scale-95"
                        >
                          📋 填写处置
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast text={notice} />
    </div>
  )
}
