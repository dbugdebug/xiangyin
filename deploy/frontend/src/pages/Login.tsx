import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import RoleCard from '../components/RoleCard'
import Toast from '../components/Toast'
import { setElderId, setRole, ROUTE_BY_ROLE } from '../lib/session'
import type { Role } from '../types'
import { apiRequest, API_BASE } from '../lib/api'
import { isDemoOtpEnabled, isSupabaseConfigured, saveAuthSession, sendPhoneOtp, verifyPhoneOtp } from '../lib/supabaseAuth'

const ROLES: Array<{ key: Role; emoji: string; label: string; desc: string }> = [
  { key: 'elder', emoji: '👴', label: '老人', desc: '唠嗑 · 陪伴' },
  { key: 'family', emoji: '👨‍👩‍👧', label: '家属', desc: '接收关怀提醒' },
  { key: 'villager', emoji: '🧑‍🌾', label: '村协管员', desc: '守护全村老人' },
]

/**
 * 注册 / 登录页：
 * - 手机号 + 验证码登录；可通过 VITE_DEMO_OTP 临时启用任意验证码
 * - "一键进入体验"免登录，方便路演
 * - 角色用大卡片点选，默认"老人"
 */
export default function Login() {
  const navigate = useNavigate()
  const [role, setRoleState] = useState<Role>('elder')
  const [name, setName] = useState('')
  const [village, setVillage] = useState('')
  const [elderPhone, setElderPhone] = useState('')
  const [registering, setRegistering] = useState(false)
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

  const sendCode = async () => {
    if (countdown > 0) return
    if (!/^1\d{10}$/.test(phone)) {
      setNotice('请先输入 11 位手机号')
      return
    }
    if (registering && !name.trim()) { setNotice('请填写姓名'); return }
    if (registering && role === 'villager' && !village.trim()) { setNotice('请填写所属村镇'); return }
    if (registering && role === 'family' && !/^1\d{10}$/.test(elderPhone)) { setNotice('请填写要守护的老人手机号'); return }
    if (isDemoOtpEnabled() || !isSupabaseConfigured()) {
      setCountdown(60)
      setNotice('演示模式：验证码可随便填写')
      return
    }
    try {
      await sendPhoneOtp(`+86${phone}`, registering ? { name: name.trim(), role, village: village.trim(), elder_phone: elderPhone } : undefined)
      setCountdown(60)
      setNotice('验证码已发送，请查看短信')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '验证码发送失败，请稍后重试')
    }
  }

  /** 登录 / 体验成功：记录角色（localStorage），并按角色自动跳转到对应端 */
  const enter = (r: Role) => {
    setRole(r)
    navigate(ROUTE_BY_ROLE[r])
  }

  const login = async () => {
    if (!/^1\d{10}$/.test(phone)) {
      setNotice('手机号好像没填对，请再看看')
      return
    }
    if (!code.trim()) {
      setNotice('请填一下收到的验证码')
      return
    }
    try {
      if (isDemoOtpEnabled()) {
        if (!API_BASE) throw new Error('请先配置 VITE_API_BASE_URL')
        const response = await fetch(`${API_BASE}/api/demo-login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, code: code.trim(), role, name: registering ? name.trim() : '', village, elder_phone: elderPhone, registering }),
        })
        const demoSession = await response.json()
        if (!response.ok) throw new Error(demoSession.message || '演示登录失败')
        saveAuthSession(demoSession)
        const me = await apiRequest<{ role: Role; elder_id: number | null }>('GET', '/api/me')
        if (me.role !== role) {
          setNotice(`此账号已分配为「${me.role === 'elder' ? '老人' : me.role === 'family' ? '家属' : '村协管员'}」，请选择对应角色登录`)
          return
        }
        setElderId(me.elder_id)
        enter(me.role)
        return
      }
      if (!isSupabaseConfigured()) { enter(role); return }
      await verifyPhoneOtp(`+86${phone}`, code.trim())
      const me = await apiRequest<{ role: Role; elder_id: number | null }>('GET', '/api/me')
      if (me.role !== role) {
        setNotice(`此账号已分配为「${me.role === 'elder' ? '老人' : me.role === 'family' ? '家属' : '村协管员'}」，请联系管理员调整账号角色`)
        return
      }
      setElderId(me.elder_id)
      enter(me.role)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '登录失败，请检查验证码或账号配置')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex-1 px-7 pb-6 pt-12">
        <Logo />

        <div className="mb-5 flex rounded-full bg-stone-100 p-1">
          <button onClick={() => setRegistering(false)} className={`flex-1 rounded-full py-3 text-lg font-bold ${!registering ? 'bg-white text-orange-600 shadow' : 'text-stone-500'}`}>登录</button>
          <button onClick={() => setRegistering(true)} className={`flex-1 rounded-full py-3 text-lg font-bold ${registering ? 'bg-white text-orange-600 shadow' : 'text-stone-500'}`}>注册</button>
        </div>
        {registering && <input value={name} onChange={e => setName(e.target.value.slice(0, 20))} placeholder="请输入姓名" className="mb-3 h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-5 text-xl text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none" />}
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
            {countdown > 0 ? `${countdown}s 重发` : '获取验证码'}
          </button>
        </div>
        {registering && role === 'villager' && <input value={village} onChange={e => setVillage(e.target.value.slice(0, 50))} placeholder="所属村镇" className="mt-3 h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-5 text-xl text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none" />}
        {registering && role === 'family' && <input value={elderPhone} onChange={e => setElderPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="要守护的老人手机号" className="mt-3 h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-5 text-xl text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none" />}

        <button
          onClick={login}
          className="mt-6 h-16 w-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-2xl font-bold tracking-widest text-white shadow-lg shadow-orange-500/30 transition active:scale-[0.98]"
        >
          {registering ? '注 册 / 验 证' : '登 录'}
        </button>
        {!isSupabaseConfigured() && !isDemoOtpEnabled() && <button
          onClick={() => enter(role)}
          className="mt-4 h-14 w-full rounded-full border-2 border-dashed border-orange-300 bg-orange-50/50 text-xl font-semibold text-orange-500 transition active:scale-[0.98]"
        >
          🚶 一键进入体验（演示模式）
        </button>}

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
        {isDemoOtpEnabled() ? '🔓 演示验证码已开启：任意非空验证码均可通过' : isSupabaseConfigured() ? '🔒 登录后数据将通过 Supabase 服务处理' : '🔒 本 Demo 仅用于原型演示，数据不上传，隐私信息不会被收集'}
      </p>

      <Toast text={notice} />
    </div>
  )
}
