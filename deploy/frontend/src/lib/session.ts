import type { Role } from '../types'
import { clearAuthSession } from './supabaseAuth'

/**
 * UI 路由角色与老人档案选择。API 请求会携带服务端签名的会话令牌。
 *
 * 注意：localStorage 在 file:// 协议或隐私模式下可能不可写；
 * 所有读写都用 try-catch 包裹，失败时回退化角色为空，保证路演任何环境都不白屏。
 */

const KEY = 'xy_role'
const ELDER_KEY = 'xy_elder_id'

/** 安全执行 localStorage 读写，失败时返回 fallback */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** 各角色的首页路由：登录成功后按角色自动跳转 */
export const ROUTE_BY_ROLE: Record<Role, string> = {
  elder: '/chat',
  family: '/family',
  villager: '/village',
}

export const ROLE_LABEL: Record<Role, string> = {
  elder: '老人',
  family: '家属',
  villager: '村协管员',
}

export function getRole(): Role | null {
  const v = safe(() => localStorage.getItem(KEY), null)
  return v === 'elder' || v === 'family' || v === 'villager' ? v : null
}

export function setRole(r: Role) {
  safe(() => localStorage.setItem(KEY, r), undefined)
}

export function clearRole() {
  safe(() => localStorage.removeItem(KEY), undefined)
  safe(() => localStorage.removeItem(ELDER_KEY), undefined)
  clearAuthSession()
}

export function setElderId(id: number | null) {
  safe(() => id && Number.isFinite(id) ? localStorage.setItem(ELDER_KEY, String(id)) : localStorage.removeItem(ELDER_KEY), undefined)
}

export function getElderId(): number {
  const id = safe(() => Number(localStorage.getItem(ELDER_KEY)), NaN)
  return Number.isInteger(id) && id > 0 ? id : DEMO_ELDER_ID
}

/** 未登录演示环境的默认档案 ID */
export const DEMO_ELDER_ID = 1
