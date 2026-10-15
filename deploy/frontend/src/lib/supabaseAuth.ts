const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '') ?? ''
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
const SESSION_KEY = 'xy_supabase_session'

export type AuthSession = { access_token: string; refresh_token: string; expires_at?: number; user: { id: string; phone?: string; user_metadata?: Record<string, unknown> } }

export function isSupabaseConfigured() { return Boolean(SUPABASE_URL && SUPABASE_KEY) }
export function isDemoOtpEnabled() { return import.meta.env.VITE_DEMO_OTP === 'true' }
export function getAuthSession(): AuthSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as AuthSession | null
    if (s?.expires_at && s.expires_at * 1000 < Date.now() + 30_000) return null
    return s
  } catch { return null }
}
export async function getValidAuthSession(): Promise<AuthSession | null> {
  const current = getAuthSession()
  if (current) return current
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as AuthSession | null
    if (!stored?.refresh_token || !isSupabaseConfigured()) return null
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: stored.refresh_token }),
    })
    if (!response.ok) { clearAuthSession(); return null }
    const renewed = await response.json() as AuthSession
    saveAuthSession(renewed)
    return renewed
  } catch { return null }
}
export function saveAuthSession(session: AuthSession) {
  if (!session.expires_at && (session as any).expires_in) session.expires_at = Math.floor(Date.now() / 1000) + (session as any).expires_in
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}
export function clearAuthSession() { try { localStorage.removeItem(SESSION_KEY) } catch { /* storage unavailable */ } }

async function authRequest(path: string, body: unknown) {
  if (!isSupabaseConfigured()) throw new Error('请先在 .env.production 配置 Supabase URL 和 key')
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || '认证请求失败')
  return data
}

export async function sendPhoneOtp(phone: string, metadata?: { name: string; role: string; village?: string; elder_phone?: string }) {
  // Supabase Auth expects E.164 format.
  const e164 = phone.startsWith('+') ? phone : `+86${phone}`
  await authRequest('otp', { phone: e164, create_user: true, ...(metadata ? { data: metadata } : {}) })
}
export async function verifyPhoneOtp(phone: string, token: string): Promise<AuthSession> {
  const e164 = phone.startsWith('+') ? phone : `+86${phone}`
  const data = await authRequest('verify', { phone: e164, token, type: 'sms' })
  saveAuthSession(data)
  return data as AuthSession
}
