/**
 * 数据访问层（页面统一的 api.get / api.post 入口）
 * ================================================================
 * 本原型为 **纯前端 Demo**：全部数据来自本地演示数据层（lib/demoStore.ts），
 * **无需启动任何后端服务** 即可完整演示：
 *   老人端触发预警 → 家属端 / 村协管员端同步看到红色预警 → 处置闭环 → 风险下调。
 *
 * 设计说明：页面统一通过 api.get / api.post 访问数据，路径沿用 REST 风格
 * （/api/elders、/api/alerts/:id/handle ...）。
 * 将来若需接真实后端，只需把下方 mockRoute 换成 fetch，**页面代码零改动**。
 */
import * as store from './demoStore'
import { asRiskCategory, buildAssessment, categoryFromSignal } from './assessment'
import { isWorkerConfigured, ensureDemoSession } from './workerAuth'
import { VITE_WORKER_API_URL } from '../config'
import type { AlertItem, DailyStat, Elder } from '../types'

// 类型统一出口：页面原先从 '../lib/api' 引入这些类型，这里原样再导出，页面代码零改动
export type {
  AlertItem,
  CareMessage,
  DailyStat,
  Disposal,
  Elder,
  Referral,
  RiskCategory,
  RiskLevel,
  ScreenStat,
  Stats,
  Summary,
} from '../types'
export type { Assessment, AssessmentDimension, DimensionKey } from './assessment'
export { CATEGORY_ICON, RISK_CATEGORIES } from './assessment'

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
        // 结构化风险评估（五分类）：只返回 AI 语义分析结论，不含任何对话原文
        case p === '/api/assessment': {
          const id = toNum(q.get('elder_id')) ?? 1
          const elder = store.getElder(id)
          result = elder
            ? buildAssessment(elder, store.elderDailyStats(id), store.listAlerts({ elder_id: id }))
            : null
          break
        }
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
            category: asRiskCategory(b.category),
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
 * 后端地址（config 里已解析：VITE_WORKER_API_URL → ?api= 运行时覆盖 → 同源 → 空）。
 * 为空时 isWorkerConfigured() = false，全部走本地演示数据层 demoStore，画面完全一致。
 */
export const API_BASE = VITE_WORKER_API_URL.replace(/\/+$/, '')
let backendDownAt = 0 // 0 = 后端在线（或从未探测失败）

function backendDown(): boolean {
  return backendDownAt > 0 && Date.now() - backendDownAt < 30_000
}

/**
 * 后端预警 → 前端 AlertItem。
 * 后端 `alerts` 表里的 keyword / summary **一律丢弃**，只在本地折算成五个标准分类之一，
 * 保证「子端 / 社区端」拿到的永远只有 `风险类型 + 状态`。
 */
function normalizeAlert(raw: Record<string, unknown>): AlertItem {
  const category = raw.category
    ? asRiskCategory(raw.category)
    : categoryFromSignal(`${String(raw.keyword ?? '')} ${String(raw.summary ?? '')}`)
  const item: AlertItem = {
    id: Number(raw.id),
    elder_id: Number(raw.elder_id),
    elder_name: String(raw.elder_name ?? ''),
    created_at: String(raw.created_at ?? ''),
    category,
    status: raw.status === '已处理' ? '已处理' : '待处理',
    severity: raw.severity === 'high' ? 'high' : 'mid',
  }
  if (raw.method) item.method = String(raw.method)
  if (raw.disposal) item.disposal = raw.disposal as AlertItem['disposal']
  return item
}

/** 后端返回 → 前端类型（目前只有预警列表需要脱敏折算） */
function normalizeGet<R>(path: string, data: R): R {
  if (path === '/api/alerts' && Array.isArray(data)) {
    return (data as unknown as Record<string, unknown>[]).map(normalizeAlert) as unknown as R
  }
  return data
}

/** 前端请求体 → 后端契约请求体（老人原话/分类名都不出端，只写分类标签） */
function remoteBody(path: string, body?: unknown): unknown {
  const p = path.split('?')[0]
  const b = (body ?? {}) as Record<string, unknown>
  if (p === '/api/risk-report') {
    const category = asRiskCategory(b.category)
    // 后端表结构仍是 keyword/summary 两列：只写入标准分类文案，不写任何老人原话
    return { elder_id: b.elder_id, keyword: category, summary: `AI 语义筛查命中：${category}` }
  }
  return body
}

async function tryBackend<R>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<R | undefined> {
  if (!isWorkerConfigured()) return undefined
  if (backendDown()) return undefined
  try {
    // 后端 /api/** 需要 Bearer：内部静默换取演示账号会话（不参与登录页 UI）
    const session = await ensureDemoSession()
    if (!session?.access_token) return undefined
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as Record<string, unknown>
    // 契约约定：错误为 HTTP 200 + { ok:false, message }
    if (data && data.ok === false) throw new Error(String(data.message ?? '后端返回错误'))
    backendDownAt = 0
    return data as R
  } catch {
    if (backendDownAt === 0) console.warn(`[api] 后端请求失败，本次演示回退本地数据：${method} ${path}`)
    backendDownAt = backendDownAt || Date.now()
    return undefined
  }
}

/**
 * 结构化风险评估（五分类）：后端没有 /api/assessment 路由时，
 * 用后端的老人档案 + 近 7 天统计 + 预警分类，在前端按同一口径现算。
 */
async function remoteAssessment(id: number) {
  const detail = await tryBackend<{ elder?: Elder; daily_stats?: DailyStat[] } | null>(
    'GET',
    `/api/elders/${id}`,
  )
  if (!detail?.elder) return null
  const rawAlerts = (await tryBackend<Record<string, unknown>[]>('GET', `/api/alerts?elder_id=${id}`)) ?? []
  return buildAssessment(detail.elder, detail.daily_stats ?? [], rawAlerts.map(normalizeAlert))
}

export const api = {
  get: async <R>(path: string) => {
    const [p, rawQuery] = path.split('?')
    if (p === '/api/assessment') {
      const id = Number(new URLSearchParams(rawQuery ?? '').get('elder_id')) || 1
      const remote = await remoteAssessment(id)
      if (remote) return remote as R
      return mockRoute<R>('GET', path)
    }
    const remote = await tryBackend<R>('GET', path)
    if (remote !== undefined) return normalizeGet(p, remote)
    return mockRoute<R>('GET', path)
  },
  post: async <R>(path: string, body?: unknown) => {
    const remote = await tryBackend<R>('POST', path, remoteBody(path, body))
    if (remote !== undefined) return remote
    return mockRoute<R>('POST', path, body)
  },
}

export async function apiRequest<R>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<R> {
  const remote = await tryBackend<R>(method, path, remoteBody(path, body))
  if (remote === undefined) throw new Error('后端不可用，已回退本地演示数据')
  return remote
}

/** "2026-10-12 00:25" → "10-12 00:25" */
export function fmtTime(iso: string): string {
  return iso.slice(5)
}
