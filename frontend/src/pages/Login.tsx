import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import RoleCard from '../components/RoleCard'
import Toast from '../components/Toast'
import { setRole, ROUTE_BY_ROLE } from '../lib/session'
import type { Role } from '../types'

/**
 * ⚠️ 演示约束：登录仅做前端模拟（校验通过 → 进入对应端），不发送任何 API 请求。
 */

const ROLES: Array<{ key: Role; emoji: string; label: string; desc: string }> = [
  { key: 'elder', emoji: '👴', label: '老人', desc: '唠嗑 · 陪伴' },
  { key: 'family', emoji: '👨‍👩‍👧', label: '家属', desc: '接收关怀提醒' },
  { key: 'villager', emoji: '🧑‍🌾', label: '村协管员', desc: '守护全村老人' },
]

/**
 * 注册 / 登录页：
 * - 手机号 + 验证码登录，验证码为演示逻辑（任意数字即可）
 * - "一键进入体验"免登录，方便路演
 * - 角色用大卡片点选，默认"老人"
 */
export default function Login() {
  const navigate = useNavigate()
  const [role, setRoleState] = useState<Role>('elder')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [notice, setNotice] = useState('')

  // 越权访问被路由守卫弹回时，提示「当前角色无权限」
  useEffect(() => {
    if (sessionStorage.getItem('xy_denied')) {
      sessionStorage.removeItem('xy_denied')
      setNotice('当前角色无权限，请重新选择角色进入')
    }
  }, [])

  // 验证码倒计时
  useEffect(() => {
    if (countdown <= 0) return
    const t = setInterval(() => setCountdown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [countdown])

  // Toast 自动消失
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 2800)
    return () => clearTimeout(t)
  }, [notice])

  /** 验证码：纯前端演示，只做倒计时，不发短信 */
  const sendCode = () => {
    if (countdown > 0) return
    if (!/^1\d{10}$/.test(phone)) {
      setNotice('请先输入 11 位手机号')
      return
    }
    setCountdown(60)
    setNotice('演示验证码已就绪：输入任意数字即可')
  }

  /** 登录 / 体验成功：记录角色（localStorage），并按角色自动跳转到对应端 */
  const enter = (r: Role) => {
    setRole(r)
    navigate(ROUTE_BY_ROLE[r])
  }

  /** 登录：纯前端模拟——格式校验通过即成功，失败只在界面上提示，不发任何请求 */
  const login = () => {
    if (!/^1\d{10}$/.test(phone)) {
      setNotice('手机号好像没填对，请再看看')
      return
    }
    if (!code.trim()) {
      setNotice('请填一下收到的验证码')
      return
    }
    enter(role)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex-1 px-7 pb-6 pt-12">
        <Logo />

        {/* 手机号 + 验证码 */}
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
          inputMode="numeric"
          placeholder="请输入手机号"
          className="h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-5 text-xl text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none"
        />
        <div className="mt-3 flex gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="验证码"
            className="h-14 min-w-0 flex-1 rounded-2xl border-2 border-stone-200 bg-white px-5 text-xl text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none"
          />
          <button
            onClick={sendCode}
            disabled={countdown > 0}
            className="h-14 w-28 shrink-0 rounded-2xl border-2 border-orange-400 text-lg font-bold text-orange-500 transition active:scale-95 disabled:opacity-50"
          >
            {countdown > 0 ? `${countdown}s 重发` : '获取演示码'}
          </button>
        </div>

          <button
          onClick={login}
          className="mt-6 h-16 w-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-2xl font-bold tracking-widest text-white shadow-lg shadow-orange-500/30 transition active:scale-[0.98]"
        >
          登 录
        </button>
        <button onClick={() => navigate('/register', { state: { role } })} className="mt-3 h-12 w-full rounded-full bg-teal-50 text-lg font-semibold text-teal-700 ring-1 ring-teal-200">✍️ 注册新账号（{ROLES.find((r) => r.key === role)?.label}）</button>
        <button
          onClick={() => enter(role)}
          className="mt-4 h-14 w-full rounded-full border-2 border-dashed border-orange-300 bg-orange-50/50 text-xl font-semibold text-orange-500 transition active:scale-[0.98]"
        >
          🚶 一键进入体验（演示模式）
        </button>

        {/* 角色选择：大卡片点选 */}
        <div className="mt-9">
          <p className="text-xl font-bold text-stone-700">您是哪一位？</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {ROLES.map((r) => (
              <RoleCard
                key={r.key}
                emoji={r.emoji}
                label={r.label}
                desc={r.desc}
                selected={role === r.key}
                onSelect={() => setRoleState(r.key)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 隐私声明 */}
      <p className="shrink-0 px-6 pb-5 text-center text-base leading-relaxed text-stone-400">
        🔒 本 Demo 仅用于原型演示，登录/注册只做前端模拟，数据不上传、不发送短信
      </p>

      <Toast text={notice} />
    </div>
  )
}
