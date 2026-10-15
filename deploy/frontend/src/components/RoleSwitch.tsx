import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRole, setRole, ROUTE_BY_ROLE } from '../lib/session'
import type { Role } from '../types'
import { isDemoOtpEnabled, isSupabaseConfigured } from '../lib/supabaseAuth'

const OPTIONS: Array<{ role: Role; label: string }> = [
  { role: 'elder', label: '👴 老人端 · 语音陪伴' },
  { role: 'family', label: '❤️ 家属端 · 亲情守护' },
  { role: 'villager', label: '🧑‍🌾 村协管员端 · 全村守护' },
]

/**
 * ⚠️ 路演专用的「切换演示角色」入口：一键在三个角色端之间切换，无需重新登录。
 * 仅原型演示用；生产环境必须移除（角色应由服务端鉴权，不允许前端随意切换）。
 */
export default function RoleSwitch({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const cur = getRole()
  if (isSupabaseConfigured() || isDemoOtpEnabled()) return null

  const jump = (r: Role) => {
    setRole(r)
    setOpen(false)
    navigate(ROUTE_BY_ROLE[r])
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
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
              路演专用 · 一键切换角色（生产环境移除）
            </p>
            {OPTIONS.map((o) => (
              <button
                key={o.role}
                onClick={() => jump(o.role)}
                disabled={o.role === cur}
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
          </div>
        </>
      )}
    </div>
  )
}
