import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Toast from '../components/Toast'
import { setRole, ROUTE_BY_ROLE } from '../lib/session'
import type { Role } from '../types'

/**
 * 注册页（纯前端演示版，仅用于项目演示）
 * ================================================================
 * ⚠️ 演示约束：本页**不接任何后端接口**——没有 API 请求、没有数据库操作、
 *    没有账号体系。点击「注册并登录」只做前端模拟：校验通过 → 提示"注册成功"
 *    并自动进入对应角色首页；校验失败 / 手机号已被演示账号占用 → 红字失败反馈。
 *
 * 页签与字段（沿用产品需求）：
 *  - 👴 老人：姓名*、密码*、确认密码*、手机号*；（选填）年龄、性别、居住情况、
 *    所属村、住所位置、过往病史、紧急联系人姓名/电话
 *  - 👨‍👩‍👧 家属：姓名*、手机号*、验证码、密码*、确认密码*（只做身份注册，无任何绑定内容）
 *  - 🧑‍🌾 村协管员：家属字段 + 所属村镇*
 * 通用规则：手机号 11 位校验；验证码 60 秒倒计时（演示任意数字可填）；
 * 密码 ≥ 6 位且两次一致；注册成功自动登录并跳转对应角色首页。
 */

const ROLE_OPTIONS: Array<{ key: Role; label: string }> = [
  { key: 'elder', label: '👴 老人注册' },
  { key: 'family', label: '👨‍👩‍👧 家属注册' },
  { key: 'villager', label: '🧑‍🌾 村协管员注册' },
]

/** 演示数据里"已注册"的老人手机号（用这些号注册会得到失败反馈，用于演示失败分支） */
const DEMO_TAKEN_PHONES = Array.from({ length: 12 }, (_, i) => `138000000${String(i + 1).padStart(2, '0')}`)

const inputClass =
  'h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-5 text-lg text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none'

/** 居住情况选项 */
const LIVING_OPTIONS = ['独居', '留守', '与子女同住']

export default function Register() {
  const navigate = useNavigate()
  const location = useLocation()
  const initialRole = (location.state as { role?: Role } | null)?.role
  const [role, setRoleTab] = useState<Role>(initialRole ?? 'elder')

  // 通用字段
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [countdown, setCountdown] = useState(0)

  // 老人专属（除姓名/手机号/密码外全部选填）
  const [age, setAge] = useState('')
  const [gender, setGender] = useState('')
  const [living, setLiving] = useState('')
  const [village, setVillage] = useState('')
  const [address, setAddress] = useState('')
  const [medicalHistory, setMedicalHistory] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  // 村协专属
  const [town, setTown] = useState('')

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState('')

  // 验证码 60 秒倒计时（纯前端演示，不发送短信）
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

  const sendCode = () => {
    if (countdown > 0) return
    if (!/^1\d{10}$/.test(phone)) {
      setErr('请先输入 11 位手机号')
      return
    }
    setErr('')
    setCountdown(60)
    setNotice('演示验证码已就绪：输入任意数字即可')
  }

  /** 注册提交：纯前端模拟，成功 → 自动登录进对应端；失败 → 红字反馈 */
  const submit = () => {
    if (busy) return

    // ---- 前端校验（失败即 UI 反馈，不发任何请求）----
    if (!name.trim()) return setErr('请填写姓名')
    if (!/^1\d{10}$/.test(phone)) return setErr('手机号需为 11 位数字')
    if (!code.trim()) return setErr('请填写演示验证码')
    if (password.length < 6) return setErr('密码至少 6 位')
    if (password !== confirm) return setErr('两次输入的密码不一致')
    if (role === 'villager' && !town.trim()) return setErr('请填写所属村镇')
    if (role === 'elder') {
      if (age && (!Number.isInteger(Number(age)) || Number(age) < 1 || Number(age) > 130))
        return setErr('年龄请填 1～130 之间的数字')
      if (contactPhone && !/^1\d{10}$/.test(contactPhone)) return setErr('紧急联系人电话格式不正确')
    }

    // ---- 模拟"失败"分支：演示号段视为已注册 ----
    if (DEMO_TAKEN_PHONES.includes(phone)) {
      setErr('该手机号已注册，请返回直接登录')
      return
    }

    // ---- 模拟"成功"：短暂 loading → 提示 → 自动登录跳转 ----
    setBusy(true)
    setErr('')
    setTimeout(() => {
      setBusy(false)
      setNotice('注册成功！已为您自动登录')
      setRole(role)
      setTimeout(() => navigate(ROUTE_BY_ROLE[role], { replace: true }), 700)
    }, 600)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <main className="flex-1 px-6 pb-8 pt-8">
        <button onClick={() => navigate('/login')} className="mb-4 rounded-full bg-stone-100 px-4 py-2 text-stone-600">
          ← 返回登录
        </button>
        <Logo />
        <h1 className="mt-5 text-2xl font-bold text-stone-800">注册新账号</h1>
        <p className="mt-1 text-stone-500">填一次资料，乡音就记住您啦</p>

        {/* 三角色页签 */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          {ROLE_OPTIONS.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setRoleTab(item.key)
                setErr('')
              }}
              className={`min-h-12 rounded-2xl px-2 text-sm font-bold ${
                role === item.key ? 'bg-orange-500 text-white shadow' : 'bg-stone-100 text-stone-500'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} placeholder="姓名（必填）" />

          {/* ---- 老人专属：再了解您一点（都可以不填）---- */}
          {role === 'elder' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={inputClass}
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  inputMode="numeric"
                  placeholder="年龄（选填）"
                />
                <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">性别（选填）</option>
                  <option>男</option>
                  <option>女</option>
                </select>
              </div>

              {/* 居住情况：点选，可不选 */}
              <div className="rounded-2xl bg-orange-50 p-4">
                <p className="font-semibold text-stone-600">
                  居住情况<span className="ml-2 text-sm font-normal text-stone-400">选填 · 一个人住还是跟孩子住？</span>
                </p>
                <div className="mt-2 flex gap-2">
                  {LIVING_OPTIONS.map((l) => (
                    <button
                      key={l}
                      onClick={() => setLiving(living === l ? '' : l)}
                      className={`h-12 flex-1 rounded-2xl border-2 font-semibold transition active:scale-95 ${
                        living === l
                          ? 'border-orange-400 bg-white text-orange-600'
                          : 'border-transparent bg-white/70 text-stone-400'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <input className={inputClass} value={village} onChange={(e) => setVillage(e.target.value.slice(0, 30))} placeholder="所属村（选填，例如：前院村）" />
              <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value.slice(0, 50))} placeholder="住所位置（选填，例如：前院村 3 组 12 号）" />
              <textarea
                className="min-h-24 w-full rounded-2xl border-2 border-stone-200 bg-white p-4 text-base focus:border-orange-400 focus:outline-none"
                value={medicalHistory}
                onChange={(e) => setMedicalHistory(e.target.value.slice(0, 500))}
                placeholder="过往病史或需要注意的健康情况（选填）"
              />
              <div className="rounded-2xl bg-orange-50 p-4">
                <p className="mb-2 font-semibold text-stone-600">紧急联系人（选填）</p>
                <div className="space-y-2">
                  <input className={inputClass} value={contactName} onChange={(e) => setContactName(e.target.value.slice(0, 20))} placeholder="联系人姓名" />
                  <input
                    className={inputClass}
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    inputMode="numeric"
                    placeholder="联系人手机号"
                  />
                </div>
              </div>
            </>
          )}

          {/* ---- 村协专属 ---- */}
          {role === 'villager' && (
            <input className={inputClass} value={town} onChange={(e) => setTown(e.target.value.slice(0, 50))} placeholder="所属村镇（必填）" />
          )}

          {/* ---- 通用：手机号 + 验证码 + 密码 ---- */}
          <input
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
            inputMode="numeric"
            placeholder="注册手机号（必填）"
          />
          <div className="flex gap-2">
            <input
              className={`${inputClass} min-w-0 flex-1`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="验证码"
            />
            <button
              onClick={sendCode}
              disabled={countdown > 0}
              className="w-32 shrink-0 rounded-2xl border-2 border-orange-400 px-2 text-sm font-bold text-orange-600 disabled:opacity-50"
            >
              {countdown > 0 ? `${countdown}s 后重试` : '获取验证码'}
            </button>
          </div>
          <input
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value.slice(0, 20))}
            type="password"
            placeholder="设置密码（至少 6 位）"
          />
          <input
            className={inputClass}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.slice(0, 20))}
            type="password"
            placeholder="确认密码"
          />

          {/* 校验失败红字反馈（纯前端，不发请求） */}
          {err && <p className="bubble-in px-1 text-base font-semibold text-[#b93f2b]">⚠️ {err}</p>}

          <button
            onClick={submit}
            disabled={busy}
            className="h-14 w-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-xl font-bold text-white shadow-lg disabled:opacity-60"
          >
            {busy ? '正在注册…' : '注册并登录'}
          </button>
          <p className="text-center text-sm leading-6 text-stone-400">
            本页面仅用于项目演示：注册只做前端模拟，不会发送短信、不上传任何资料。
          </p>
        </div>
      </main>
      <Toast text={notice} />
    </div>
  )
}
