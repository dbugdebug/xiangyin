const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '') ?? ''
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
const SESSION_KEY = 'xy_supabase_session'

export type AuthSession = { access_token: string; refresh_token: string; expires_at?: number; user: { id: string; phone?: string } }

export function isSupabaseConfigured() { return Boolean(SUPABASE_URL && SUPABASE_KEY) }
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

export async function sendPhoneOtp(phone: string) {
  // Deliberately fake OTP for the no-SMS demo deployment. Any non-empty code
  // is accepted by the server; no SMS is sent and no Supabase phone provider is needed.
  if (!/^\+?861\d{10}$/.test(phone.replace(/\s/g, '')) && !/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确')
}
export async function verifyPhoneOtp(phone: string, token: string, role = 'elder', action = 'login', details: Record<string, unknown> = {}): Promise<AuthSession & { role: string; elder_id: number | null }> {
  if (!isSupabaseConfigured()) throw new Error('请先配置 Supabase')
  const response = await fetch(`${SUPABASE_URL}/functions/v1/api/api/auth/demo`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: token, role, action, ...details }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.ok === false) throw new Error(result.message || '登录失败')
  const data = result.session as AuthSession & { role: string; elder_id: number | null }
  saveAuthSession(data)
  return data
}
