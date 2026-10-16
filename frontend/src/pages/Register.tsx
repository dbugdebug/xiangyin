import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Toast from '../components/Toast'
import { setElderId, setRole, ROUTE_BY_ROLE } from '../lib/session'
import { isWorkerConfigured, sendPhoneOtp, verifyPhoneOtp } from '../lib/workerAuth'
import type { Role } from '../types'

const ROLE_OPTIONS: Array<{ key: Role; label: string }> = [
  { key: 'elder', label: '👴 老人注册' },
  { key: 'family', label: '👨‍👩‍👧 家属注册' },
  { key: 'villager', label: '🧑‍🌾 村协管员注册' },
]
const inputClass = 'h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-5 text-lg text-stone-700 placeholder:text-stone-400 focus:border-orange-400 focus:outline-none'

export default function Register() {
  const navigate = useNavigate()
  const location = useLocation()
  const initialRole = (location.state as { role?: Role } | null)?.role
  const [role, setRole] = useState<Role>(initialRole ?? 'elder')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [elderPhone, setElderPhone] = useState('')
  const [village, setVillage] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState('')
  const [medicalHistory, setMedicalHistory] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const sendCode = async () => {
    if (!/^1\d{10}$/.test(phone)) return setNotice('请先输入 11 位手机号')
    try {
      await sendPhoneOtp(`+86${phone}`)
      setCountdown(60)
      const timer = window.setInterval(() => setCountdown((n) => {
        if (n <= 1) window.clearInterval(timer)
        return n - 1
      }), 1000)
      setNotice('演示验证码已就绪：输入任意数字，不会发送短信')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '验证码准备失败')
    }
  }

  const submit = async () => {
    if (!isWorkerConfigured()) return setNotice('注册需要已部署并配置 Workers API')
    if (!name.trim()) return setNotice('请填写姓名')
    if (!/^1\d{10}$/.test(phone)) return setNotice('手机号需为 11 位数字')
    if (!code.trim()) return setNotice('请填写演示验证码')
    if (role === 'family' && !/^1\d{10}$/.test(elderPhone)) return setNotice('请填写已注册老人的 11 位手机号')
    if (role === 'villager' && !village.trim()) return setNotice('请填写所属村镇')
    if (role === 'elder' && age && (!Number.isInteger(Number(age)) || Number(age) < 1 || Number(age) > 130)) return setNotice('年龄请填 1～130 之间的数字')
    if (contactPhone && !/^1\d{10}$/.test(contactPhone)) return setNotice('紧急联系人电话格式不正确')

    setBusy(true)
    try {
      const session = await verifyPhoneOtp(phone, code.trim(), role, 'register', {
        name: name.trim(), elder_phone: elderPhone, village: village.trim(),
        age: role === 'elder' && age ? Number(age) : undefined,
        gender: role === 'elder' ? gender : undefined,
        medical_history: role === 'elder' ? medicalHistory.trim() : undefined,
        ec_name: role === 'elder' ? contactName.trim() : undefined,
        ec_phone: role === 'elder' ? contactPhone : undefined,
      })
      setElderId(session.elder_id ?? null)
      setRole(session.role ?? role)
      navigate(ROUTE_BY_ROLE[session.role ?? role], { replace: true })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '注册失败，请检查信息后重试')
    } finally {
      setBusy(false)
    }
  }

  return <div className="flex h-full flex-col overflow-y-auto">
    <main className="flex-1 px-6 pb-8 pt-8">
      <button onClick={() => navigate('/login')} className="mb-4 rounded-full bg-stone-100 px-4 py-2 text-stone-600">← 返回登录</button>
      <Logo />
      <h1 className="mt-5 text-2xl font-bold text-stone-800">注册新账号</h1>
      <p className="mt-1 text-stone-500">填一次资料，乡音就记住您啦</p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {ROLE_OPTIONS.map((item) => <button key={item.key} onClick={() => setRole(item.key)} className={`min-h-12 rounded-2xl px-2 text-sm font-bold ${role === item.key ? 'bg-orange-500 text-white shadow' : 'bg-stone-100 text-stone-500'}`}>{item.label}</button>)}
      </div>

      <div className="mt-5 space-y-3">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} placeholder="姓名（必填）" />
        {role === 'elder' && <>
          <div className="grid grid-cols-2 gap-3">
            <input className={inputClass} value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="年龄（选填）" />
            <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value)}><option value="">性别（选填）</option><option>男</option><option>女</option></select>
          </div>
          <textarea className="min-h-24 w-full rounded-2xl border-2 border-stone-200 bg-white p-4 text-base focus:border-orange-400 focus:outline-none" value={medicalHistory} onChange={(e) => setMedicalHistory(e.target.value.slice(0, 500))} placeholder="过往病史或需要注意的健康情况（选填）" />
          <div className="rounded-2xl bg-orange-50 p-4"><p className="mb-2 font-semibold text-stone-600">紧急联系人（选填）</p><div className="space-y-2"><input className={inputClass} value={contactName} onChange={(e) => setContactName(e.target.value.slice(0, 20))} placeholder="联系人姓名" /><input className={inputClass} value={contactPhone} onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="联系人手机号" /></div></div>
        </>}
        {role === 'family' && <div className="rounded-2xl bg-orange-50 p-4"><p className="mb-2 text-sm leading-6 text-stone-600">填写老人已注册的手机号。注册成功后，家属端会关联这位老人的陪伴记录、留言和风险预警。</p><input className={inputClass} value={elderPhone} onChange={(e) => setElderPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="老人手机号（必填）" /></div>}
        {role === 'villager' && <input className={inputClass} value={village} onChange={(e) => setVillage(e.target.value.slice(0, 50))} placeholder="所属村镇（必填）" />}
        <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="注册手机号" />
        <div className="flex gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="演示验证码" /><button onClick={sendCode} disabled={countdown > 0} className="w-32 shrink-0 rounded-2xl border-2 border-orange-400 px-2 text-sm font-bold text-orange-600 disabled:opacity-50">{countdown ? `${countdown}s 后重试` : '获取演示码'}</button></div>
        <button onClick={submit} disabled={busy} className="h-14 w-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-xl font-bold text-white shadow-lg disabled:opacity-60">{busy ? '正在注册…' : '注册并登录'}</button>
        <p className="text-center text-sm leading-6 text-stone-400">验证码为演示输入，不发送短信。注册资料会通过 Workers 保存到共享数据库。</p>
      </div>
    </main>
    <Toast text={notice} />
  </div>
}
