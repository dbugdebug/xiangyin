import { useNavigate } from 'react-router-dom'
import RoleSwitch from './RoleSwitch'
import { clearRole, getRole, ROLE_LABEL } from '../lib/session'

/** 家属端 / 村协管员端统一顶部导航：乡音心伴 + 当前角色名 + 角色切换 + 退出 */
export default function AppHeader({ subtitle }: { subtitle: string }) {
  const navigate = useNavigate()
  const role = getRole()
  const exit = () => {
    clearRole()
    navigate('/login')
  }

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-orange-100 bg-white/90 px-4 py-3 md:px-6">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-amber-400 text-2xl shadow-md shadow-orange-300/40">
        🌾
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-800">乡音心伴</h1>
          {role && (
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-sm font-semibold text-orange-600">
              {ROLE_LABEL[role]}
            </span>
          )}
        </div>
        <p className="truncate text-base text-stone-500">{subtitle}</p>
      </div>
      <RoleSwitch />
      <button
        onClick={exit}
        className="h-12 shrink-0 rounded-full bg-stone-100 px-4 text-base text-stone-500 transition active:scale-95"
      >
        退出
      </button>
    </header>
  )
}
