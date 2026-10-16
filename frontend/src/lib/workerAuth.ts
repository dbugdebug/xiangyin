import type { Role } from '../types'

const WORKER_URL = (import.meta.env.VITE_WORKER_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? ''
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
