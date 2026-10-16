import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRole, setElderId, setRole, ROUTE_BY_ROLE } from '../lib/session'
import type { Role } from '../types'
import { isDemoRoleSwitchEnabled, isSupabaseConfigured, switchDemoRole } from '../lib/supabaseAuth'

const OPTIONS: Array<{ role: Role; label: string }> = [
  { role: 'elder', label: '👴 老人端 · 语音陪伴' },
  { role: 'family', label: '❤️ 家属端 · 亲情守护' },
  { role: 'villager', label: '🧑‍🌾 村协管员端 · 全村守护' },
]

/**
 * 路演专用入口。在线模式通过服务端切换到固定演示账号；本地 mock 模式只切换 UI。
 * 在线入口由 VITE_DEMO_ROLE_SWITCH_ENABLED 控制，生产环境默认关闭。
 */
export default function RoleSwitch({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const cur = getRole()
  const onlineAuth = isSupabaseConfigured()
  if (onlineAuth && !isDemoRoleSwitchEnabled()) return null

  const jump = async (r: Role) => {
    if (busy || r === cur) return
    setBusy(true)
    setError('')
    try {
      if (onlineAuth) {
        const session = await switchDemoRole(r)
        setElderId(session.elder_id)
      }
      setRole(r)
      setOpen(false)
      navigate(ROUTE_BY_ROLE[r])
    } catch (e) {
      setError(e instanceof Error ? e.message : '角色切换失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => { setOpen((v) => !v); setError('') }}
        disabled={busy}
        aria-label="切换演示角色"
        className={`flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 font-semibold text-orange-600 transition active:scale-95 ${
          compact ? 'h-10 px-3 text-base' : 'h-12 px-4 text-lg'
        }`}
      >
        🎭<span className="hidden md:inline">切换演示角色</span>
      </button>

      {open && (
        <>
          {/* 点击空白处收起 */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="bubble-in absolute right-0 top-14 z-30 w-64 overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-xl">
            <p className="border-b border-orange-50 bg-orange-50/60 px-4 py-2 text-sm text-stone-400">
              路演演示 · 切换后会更新服务端登录角色
            </p>
            {OPTIONS.map((o) => (
              <button
                key={o.role}
                onClick={() => void jump(o.role)}
                disabled={busy || o.role === cur}
                className={`flex h-12 w-full items-center px-4 text-left text-lg transition ${
                  o.role === cur
                    ? 'bg-orange-50 font-bold text-orange-600'
                    : 'text-stone-700 hover:bg-orange-50'
                }`}
              >
                {o.label}
                {o.role === cur && <span className="ml-auto text-sm font-normal">当前</span>}
              </button>
            ))}
            {error && <p role="alert" className="px-4 py-3 text-sm text-red-600">{error}</p>}
            {busy && <p role="status" className="px-4 py-2 text-sm text-stone-500">正在切换角色…</p>}
          </div>
        </>
      )}
    </div>
  )
}
