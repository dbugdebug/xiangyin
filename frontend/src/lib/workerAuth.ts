import type { Role } from '../types'
import { VITE_WORKER_API_URL } from '../config'

const WORKER_URL = VITE_WORKER_API_URL.replace(/\/+$/, '')
const SESSION_KEY = 'xy_worker_session'
const DEMO_ROLE_SWITCH_ENABLED = (import.meta.env.VITE_DEMO_ROLE_SWITCH_ENABLED as string | undefined) === 'true'

export type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  role?: Role
  elder_id?: number | null
  user: { id: string; phone?: string; user_metadata?: Record<string, unknown> }
}

export function isWorkerConfigured() { return Boolean(WORKER_URL) }
export function isDemoRoleSwitchEnabled() { return DEMO_ROLE_SWITCH_ENABLED }

export function getAuthSession(): AuthSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as AuthSession | null
    if (session?.expires_at && session.expires_at * 1000 <= Date.now() + 30_000) return null
    return session
  } catch { return null }
}

export async function getValidAuthSession() {
  const session = getAuthSession()
  if (session) return session
  clearAuthSession()
  return null
}

export function saveAuthSession(session: AuthSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

/* ------------------------------------------------ 数据接口的静默会话 */

/** 演示账号（老人 1 号，与种子库 / 演示数据一致） */
const DEMO_ELDER_PHONE =
  (import.meta.env.VITE_DEMO_ELDER_PHONE as string | undefined)?.trim() || '13800000001'

let ensuring: Promise<AuthSession | null> | null = null

/**
 * 静默建立后端会话 —— 只给数据 / 大模型接口做鉴权，**不参与登录页 UI**（登录注册仍是纯前端模拟）。
 *
 * 后端要求 `/api/**` 携带 Bearer：演示环境用固定演示账号走 `/api/demo-login`；
 * 账号还不存在时先 `/api/register` 建号（该接口后端允许未登录调用），再 demo-login。
 * 后端未启动 / 未开启演示登录（AUTH_MODE≠demo）时返回 null，调用方自动回退本地演示数据，
 * 保证「没后端也能演、有后端就真接 AI」。
 */
export async function ensureDemoSession(): Promise<AuthSession | null> {
  if (!WORKER_URL) return null
  const existing = getAuthSession()
  if (existing) return existing
  if (!ensuring) ensuring = silentDemoLogin().finally(() => { ensuring = null })
  return ensuring
}

async function silentDemoLogin(): Promise<AuthSession | null> {
  const body = { phone: DEMO_ELDER_PHONE, code: 'demo', role: 'elder' as Role }
  try {
    let login: AuthSession
    try {
      login = await workerRequest<AuthSession>('/api/demo-login', body)
    } catch {
      // 演示账号还没在库里 → 先建号（后端 /api/register 不要求登录），再换会话
      await workerRequest('/api/register', {
        phone: DEMO_ELDER_PHONE,
        role: 'elder',
        name: '乡音演示',
        password: 'xiangyin-demo',
        confirm_password: 'xiangyin-demo',
      }).catch(() => undefined)
      login = await workerRequest<AuthSession>('/api/demo-login', body)
    }
    saveAuthSession({ ...login, role: 'elder' })
    return getAuthSession()
  } catch {
    return null
  }
}

export function clearAuthSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* storage unavailable */ }
}

async function workerRequest<T>(path: string, body?: unknown, token?: string): Promise<T> {
  if (!WORKER_URL) throw new Error('未配置 Workers API 地址（VITE_WORKER_API_URL）')
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || result.ok === false) throw new Error(String(result.message || `请求失败（HTTP ${response.status}）`))
  return result as T
}

export async function sendPhoneOtp(phone: string) {
  if (!/^1\d{10}$/.test(phone.replace(/\s/g, ''))) throw new Error('手机号格式不正确')
  // 演示验证码只做输入检查，不发送短信。
}

export async function verifyPhoneOtp(
  phone: string,
  code: string,
  role: Role = 'elder',
  action: 'login' | 'register' = 'login',
  details: Record<string, unknown> = {},
): Promise<AuthSession> {
  if (!WORKER_URL) throw new Error('请先配置 Workers API 地址')
  if (action === 'register') {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    const unusedPassword = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    await workerRequest('/api/register', {
      ...details,
      phone,
      role,
      password: unusedPassword,
      confirm_password: unusedPassword,
    })
  }

  // 注册 API 已经先创建了 user 记录；随后应按普通登录换取演示会话。
  // 再传 registering=true 会让后端把刚创建的账号误判成重复注册。
  const login = await workerRequest<AuthSession>('/api/demo-login', { phone, code, role, ...details })
  const profile = await workerRequest<{ role: Role; elder_id: number | null }>('/api/me', undefined, login.access_token)
  const session: AuthSession = { ...login, role: profile.role, elder_id: profile.elder_id }
  saveAuthSession(session)
  return session
}

const DEMO_PHONES: Record<Role, string> = {
  elder: (import.meta.env.VITE_DEMO_ELDER_PHONE as string | undefined)?.trim() || '13800000001',
  family: (import.meta.env.VITE_DEMO_FAMILY_PHONE as string | undefined)?.trim() || '13900000001',
  villager: (import.meta.env.VITE_DEMO_VILLAGER_PHONE as string | undefined)?.trim() || '13900000002',
}

export async function switchDemoRole(role: Role): Promise<AuthSession> {
  if (!WORKER_URL) throw new Error('当前未配置 Workers API 地址')
  if (!DEMO_ROLE_SWITCH_ENABLED) throw new Error('当前环境未启用演示角色切换')
  const phone = DEMO_PHONES[role]
  const session = await workerRequest<AuthSession>('/api/demo-login', { phone, code: 'demo', role })
  const profile = await workerRequest<{ role: Role; elder_id: number | null }>('/api/me', undefined, session.access_token)
  const next: AuthSession = { ...session, role: profile.role, elder_id: profile.elder_id }
  saveAuthSession(next)
  return next
}
