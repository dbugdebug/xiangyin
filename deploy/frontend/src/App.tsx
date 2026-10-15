import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import Login from './pages/Login'
import Chat from './pages/Chat'
import FamilyDashboard from './pages/FamilyDashboard'
import VillageBoard from './pages/VillageBoard'
import { getRole } from './lib/session'
import type { Role } from './types'

/**
 * 路由守卫：角色存 localStorage（见 lib/session.ts）。
 * 未登录 → 回登录页；角色与端不匹配（越权访问）→ 回登录页并提示「当前角色无权限」。
 */
function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const cur = getRole()
  if (!cur) return <Navigate to="/login" replace />
  if (cur !== role) {
    sessionStorage.setItem('xy_denied', '1')
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

/**
 * 应用外壳：移动端全屏、桌面居中预览。
 * 老人端保持手机宽度（430px）；家属端/村协管员端是看板，桌面下放宽铺满多列栅格。
 */
function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const wide = pathname === '/family' || pathname === '/village'
  return (
    <div className="flex h-dvh w-full justify-center bg-[#efe6d5]">
      <div
        className={`relative flex h-full w-full flex-col overflow-hidden bg-[#fffdf8] shadow-2xl shadow-black/20 ${
          wide ? 'max-w-[1200px]' : 'max-w-[430px]'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * 路由容器。
 * 使用 HashRouter（URL 形如 /#/family）而非 BrowserRouter，好处是：
 *   1. 打包后的 dist 直接双击 index.html（file:// 协议）也能正常切换页面，无需任何服务器；
 *   2. 将来部署到任意静态托管（GitHub Pages、对象存储、内网 nginx 子目录）都无需额外 rewrite 配置。
 * 开发时（npm run dev）页面地址同样是 http://localhost:5173/#/family。
 */
export default function App() {
  return (
    <HashRouter>
      <Shell>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/chat"
            element={
              <RequireRole role="elder">
                <Chat />
              </RequireRole>
            }
          />
          <Route
            path="/family"
            element={
              <RequireRole role="family">
                <FamilyDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/village"
            element={
              <RequireRole role="villager">
                <VillageBoard />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Shell>
    </HashRouter>
  )
}
