/**
 * 数据访问层（页面统一的 api.get / api.post 入口）
 * ================================================================
 * 未配置线上服务时使用本地演示数据层；线上统一调用共享 Flask API。
 *   老人端触发预警 → 家属端 / 村协管员端同步看到红色预警 → 处置闭环 → 风险下调。
 *
 * 设计说明：页面统一通过 api.get / api.post 访问数据，路径沿用 REST 风格
 * （/api/elders、/api/alerts/:id/handle ...）。
 * 将来若需接真实后端，只需把下方 mockRoute 换成 fetch，**页面代码零改动**。
 */
import * as store from './demoStore'
import { getValidAuthSession, isDemoOtpEnabled, isSupabaseConfigured } from './supabaseAuth'

// 类型统一出口：页面原先从 '../lib/api' 引入这些类型，这里原样再导出，页面代码零改动
export type {
  AlertItem,
  CareMessage,
  ChatTurn,
  DailyStat,
  Disposal,
  Elder,
  Referral,
  RiskLevel,
  ScreenStat,
  Stats,
  Summary,
} from '../types'

/** 后端在线 = true；离线时自动回退演示数据（USING_MOCK 仅表示"存在本地演示层"） */
export const USING_MOCK = true

/** 轻微延时，让"加载中"与真实网络请求的节奏一致（演示更自然） */
const DELAY = 150
const wait = () => new Promise<void>((r) => setTimeout(r, DELAY))

function toNum(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** 路径参数：/api/alerts/12/handle → 12 */
function seg(path: string, index: number): number {
  return Number(path.split('/')[index])
}

function mockRoute<R>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<R> {
  const [p, rawQuery] = path.split('?')
  const q = new URLSearchParams(rawQuery ?? '')
  const b = (body ?? {}) as Record<string, unknown>

  return wait().then(() => {
    let result: unknown

    if (method === 'GET') {
      switch (true) {
        case p === '/api/stats':
          result = store.getStats()
          break
        case p === '/api/screen-stats':
          result = store.getScreenStats()
          break
        case p === '/api/elders':
          result = store.listElders()
          break
        // 老人详情：档案 + 近 7 天每日统计（情绪趋势 / 陪伴概况数据源）
        case /^\/api\/elders\/\d+$/.test(p): {
          const id = seg(p, 3)
          const elder = store.getElder(id)
          result = elder ? { elder, daily_stats: store.elderDailyStats(id) } : null
          break
        }
        case p === '/api/alerts':
          result = store.listAlerts({
            status: q.get('status') ?? undefined,
            elder_id: toNum(q.get('elder_id')),
          })
          break
        case p === '/api/summaries':
          result = store.listSummaries(toNum(q.get('elder_id')))
          break
        case p === '/api/referrals':
          result = store.listReferrals()
          break
        case p === '/api/care-messages':
          result = store.listCareMessages(toNum(q.get('elder_id')) ?? 1, q.get('pending') === '1')
          break
        case p === '/api/care-message/pending':
          result = store.listCareMessages(toNum(q.get('elder_id')) ?? 1, true)[0] ?? null
          break
        default:
          throw new Error(`mock 未实现的 GET ${p}`)
      }
      return result as R
    }

    switch (true) {
      // 处置闭环：预警转已处理 + 写处置记录 + 老人风险下调一档
      case /^\/api\/alerts\/\d+\/handle$/.test(p): {
        const r = store.handleAlert(seg(p, 3), {
          method: String(b.method ?? '电话回访'),
          note: String(b.note ?? ''),
          handler: String(b.handler ?? '村协管员 · 老李'),
        })
        result = { ok: true, elder: r.elder, alert: r.alert }
        break
      }
      // 老人端对话触发风险：新增预警 + 该老人置红
      case p === '/api/risk-report':
        result = {
          ok: true,
          alert_id: store.reportRisk({
            elder_id: Number(b.elder_id),
            keyword: String(b.keyword ?? '消极情绪表达'),
            summary: String(b.summary ?? ''),
          }).id,
        }
        break
      // 老人端每轮对话上报活跃
      case p === '/api/activity':
        store.reportActivity({ elder_id: Number(b.elder_id), rounds: Number(b.rounds ?? 1) })
        result = { ok: true }
        break
      // 家属关怀留言（同时兼容单复数两种路径）
      case p === '/api/care-message' || p === '/api/care-messages':
        result = { ok: true, id: store.addCareMessage(Number(b.elder_id), String(b.content ?? '')).id }
        break
      // 乡音已转达留言
      case /^\/api\/care-messages\/\d+\/conveyed$/.test(p):
        store.conveyCareMessage(seg(p, 3))
        result = { ok: true }
        break
      // 一键回拨 / 联系村协管员 / 语音问候等情况下的模拟外呼（仅提示，不真实拨号）
      case p === '/api/mock-call':
        result = { ok: true, message: store.mockCall(String(b.name ?? '家人')) }
        break
      default:
        throw new Error(`mock 未实现的 POST ${p}`)
    }
    return result as R
  })
}

/* ---------------------------------------------------------------- 统一出口 */

/**
 * 配置线上 API 时请求共享 Flask 服务；未配置时使用本地 demoStore 预览。
 */
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
export const API_BASE = (configuredApiBase || (import.meta.env.PROD ? 'https://api.ccup.us.ci' : '')).replace(/\/+$/, '')
async function tryBackend<R>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<R | undefined> {
  if ((!isSupabaseConfigured() && !isDemoOtpEnabled()) || !API_BASE) return undefined
  try {
    const session = await getValidAuthSession()
    const makeRequest = (token?: string) => fetch(`${API_BASE}${path}`, {
      method,
      headers: { apikey: SUPABASE_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    })
    let res = await makeRequest(session?.access_token)
    if (res.status === 401) {
      const refreshed = await getValidAuthSession()
      if (refreshed?.access_token) res = await makeRequest(refreshed.access_token)
    }
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) throw new Error(String(data.message ?? data.msg ?? `HTTP ${res.status}`))
    // 契约约定：错误为 HTTP 200 + { ok:false, message }
    if (data && data.ok === false) throw new Error(String(data.message ?? '后端返回错误'))
    return data as R
  } catch (error) {
    console.warn(`[api] 共享 API 请求失败：${method} ${path}`, error)
    throw error
  }
}

export const api = {
  get: async <R>(path: string) => {
    const remote = await tryBackend<R>('GET', path)
    if (remote !== undefined) return remote
    if (isSupabaseConfigured() || isDemoOtpEnabled()) throw new Error('共享 API 请求失败，请检查 VITE_API_BASE_URL')
    return mockRoute<R>('GET', path)
  },
  post: async <R>(path: string, body?: unknown) => {
    const remote = await tryBackend<R>('POST', path, body)
    if (remote !== undefined) return remote
    if (isSupabaseConfigured() || isDemoOtpEnabled()) throw new Error('共享 API 请求失败，请检查 VITE_API_BASE_URL')
    return mockRoute<R>('POST', path, body)
  },
}

export async function apiRequest<R>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<R> {
  const remote = await tryBackend<R>(method, path, body)
  if (remote === undefined) throw new Error('共享 API 请求失败，请检查 VITE_API_BASE_URL')
  return remote
}

/** "2026-10-12 00:25" → "10-12 00:25" */
export function fmtTime(iso: string): string {
  return iso.slice(5)
}
