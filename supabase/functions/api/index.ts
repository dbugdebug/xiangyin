import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('FRONTEND_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
})
function injectedKey(legacyName: string, mapName: string) {
  const legacy = Deno.env.get(legacyName)
  if (legacy) return legacy
  try {
    const keys = JSON.parse(Deno.env.get(mapName) ?? '{}')
    return Object.values(keys)[0] as string | undefined
  } catch { return undefined }
}
const url = Deno.env.get('SUPABASE_URL')!
const secretKey = injectedKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS')!
const publicKey = injectedKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS')!
const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const authClient = createClient(url, publicKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const fakeOtpSecret = Deno.env.get('FAKE_OTP_SECRET') ?? ''

// Demo phone authentication: no SMS is sent. Supabase Auth still issues a normal
// JWT, so the existing profiles/family_relations foreign keys and API checks work.
async function demoAuth(body: Record<string, unknown>) {
  if (fakeOtpSecret.length < 32) throw new Error('服务端尚未配置 FAKE_OTP_SECRET')
  const phone = String(body.phone ?? '').replace(/\D/g, '')
  const code = String(body.code ?? '').trim()
  const action = String(body.action ?? '')
  const role = String(body.role ?? 'elder')
  if (!/^1\d{10}$/.test(phone) || !code) throw new Error('请输入正确手机号和任意验证码')
  if (!['register', 'login'].includes(action)) throw new Error('不支持的登录操作')
  if (!['elder', 'family', 'villager'].includes(role)) throw new Error('角色不正确')
  const email = `${phone}@xiangyin-demo.com`
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(fakeOtpSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`xiangyin-demo-auth:${phone}`))
  const password = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')

  if (action === 'register') {
    let familyElderId: number | null = null
    if (role === 'family') {
      const elderPhone = String(body.elder_phone ?? '').replace(/\D/g, '')
      if (!/^1\d{10}$/.test(elderPhone)) throw new Error('家属注册时请填写老人手机号')
      const elder = await admin.from('elders').select('id').eq('phone', elderPhone).maybeSingle()
      if (elder.error) throw elder.error
      if (!elder.data) throw new Error('系统找不到该老人手机号；请先注册老人账号')
      familyElderId = elder.data.id
    }
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { phone, role } })
    if (created.error) throw new Error(created.error.message.includes('already') ? '该手机号已注册，请直接登录' : created.error.message)
    const userId = created.data.user.id
    let elderId: number | null = null
    if (role === 'elder') {
      const found = await admin.from('elders').select('id').eq('phone', phone).maybeSingle()
      if (found.error) throw found.error
      if (found.data) elderId = found.data.id
      else {
        const inserted = await admin.from('elders').insert({ name: String(body.name ?? `用户${phone.slice(-4)}`).slice(0, 50), age: Math.max(1, Math.min(120, Number(body.age) || 70)), phone }).select('id').single()
        if (inserted.error) throw inserted.error
        elderId = inserted.data.id
      }
    }
    const profile = await admin.from('profiles').upsert({ user_id: userId, role, elder_id: elderId }, { onConflict: 'user_id' })
    if (profile.error) throw profile.error
    if (role === 'family') {
      const relation = await admin.from('family_relations').upsert({ family_user_id: userId, elder_id: familyElderId, relationship: String(body.relationship ?? '家属') }, { onConflict: 'family_user_id,elder_id' })
      if (relation.error) throw relation.error
    }
  }
  const signedIn = await authClient.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) throw new Error(action === 'login' ? '该手机号还没有注册' : (signedIn.error?.message ?? '登录失败'))
  const profile = await admin.from('profiles').select('role,elder_id').eq('user_id', signedIn.data.user.id).single()
  if (profile.error) throw profile.error
  if (profile.data.role !== role) throw new Error(`此手机号已注册为${profile.data.role}，请选择对应角色登录`)
  return { ...signedIn.data.session, user: { ...signedIn.data.user, phone }, role: profile.data.role, elder_id: profile.data.elder_id }
}
const riskOrder: Record<string, number> = { red: 0, yellow: 1, green: 2 }
const isoMinute = (v: string | null) => v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : null
const day = () => new Date().toISOString().slice(0, 10)
const activeSlot = () => {
  const h = new Date().getHours()
  return h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : '晚间'
}
const fail = (message: string) => ({ ok: false, message })
const check = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

async function context(req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('请先登录')
  const { data: { user }, error } = await authClient.auth.getUser(token)
  if (error || !user) throw new Error('登录已过期，请重新登录')
  const profile = check(await admin.from('profiles').select('role,elder_id').eq('user_id', user.id).single())
  return { user, role: profile.role as string, elderId: profile.elder_id as number | null }
}

async function loginOrCreateDemoRole(role: string, phone: string, details: Record<string, unknown> = {}) {
  const login = { phone, code: 'demo-role-switch', action: 'login', role, ...details }
  try {
    return await demoAuth(login)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('还没有注册')) throw error
  }

  try {
    return await demoAuth({ ...login, action: 'register' })
  } catch (error) {
    // If two presenters switch at once, the other request may create this fixed
    // demo account first. Retry login instead of surfacing a duplicate error.
    if (error instanceof Error && error.message.includes('已注册')) {
      return await demoAuth(login)
    }
    throw error
  }
}

async function switchDemoRole(req: Request, role: string) {
  // Require a real, current Supabase Auth session before issuing another one.
  await context(req)
  if (Deno.env.get('DEMO_ROLE_SWITCH_ENABLED') !== 'true') {
    throw new Error('演示角色切换未启用')
  }
  if (fakeOtpSecret.length < 32) throw new Error('服务端尚未配置 FAKE_OTP_SECRET')
  if (!['elder', 'family', 'villager'].includes(role)) throw new Error('演示角色不正确')

  const phoneByRole = {
    elder: Deno.env.get('DEMO_ELDER_PHONE') ?? '13800000001',
    family: Deno.env.get('DEMO_FAMILY_PHONE') ?? '13900000001',
    villager: Deno.env.get('DEMO_VILLAGER_PHONE') ?? '13900000002',
  }
  const phone = phoneByRole[role as keyof typeof phoneByRole]
  if (!/^1\d{10}$/.test(phone)) throw new Error('演示账号手机号配置不正确')

  const elderPhone = phoneByRole.elder
  if (role === 'family') {
    // Ensure the demo elder exists first so the family demo account can be
    // linked using the existing family_relations schema.
    await loginOrCreateDemoRole('elder', elderPhone, { name: '王桂兰', age: 78 })
  }
  const session = await loginOrCreateDemoRole(role, phone, {
    name: role === 'elder' ? '王桂兰' : role === 'family' ? '演示家属' : '演示村协管员',
    age: role === 'elder' ? 78 : undefined,
    elder_phone: role === 'family' ? elderPhone : undefined,
  })

  if (role === 'family' && session.user?.id) {
    const elder = check(await admin.from('elders').select('id').eq('phone', elderPhone).single())
    check(await admin.from('family_relations').upsert({
      family_user_id: session.user.id,
      elder_id: elder.id,
      relationship: '演示家属',
    }, { onConflict: 'family_user_id,elder_id' }))
  }
  return session
}

async function canAccess(ctx: Awaited<ReturnType<typeof context>>, elderId: number) {
  if (ctx.role === 'villager' || (ctx.role === 'elder' && ctx.elderId === elderId)) return true
  if (ctx.role !== 'family') return false
  const { data, error } = await admin.from('family_relations').select('id').eq('family_user_id', ctx.user.id).eq('elder_id', elderId).maybeSingle()
  if (error) throw error
  return Boolean(data)
}
async function assertAccess(ctx: Awaited<ReturnType<typeof context>>, elderId: number) {
  if (!await canAccess(ctx, Number(elderId))) throw new Error('无权访问该老人数据')
}
function classify(text: string) {
  const groups: [string[], string, string, number][] = [
    [['不想活', '活着没意思', '没啥意思', '想不开', '不想活了', '解脱'], '需关注', '出现危险信号表达', 10],
    [['孤独', '一个人', '没人陪我', '没人说话', '冷清'], '孤独', '表达孤独感', 8],
    [['睡不着', '失眠', '焦虑', '担心', '心里闷', '发愁'], '低落', '提到睡眠或担忧问题', 7],
    [['伤心', '难过', '哭', '烦', '想孩子', '想念'], '低落', '提到消极的事物', 7],
    [['开心', '高兴', '快乐', '舒服', '挺好', '不错'], '开心', '提到积极的事物', 8],
  ]
  for (const [words, mood, reason, intensity] of groups) if (words.some((w) => text.includes(w))) return { mood, reason, intensity }
  return { mood: '平和', reason: '日常对话', intensity: 5 }
}
function score(mood: string, intensity = 5) {
  const base: Record<string, number> = { 开心: 2, 平和: 1, 焦虑: -1, 孤独: -1, 低落: -1, 需关注: -2 }
  const n = base[mood] ?? 0
  return n < 0 && intensity >= 8 ? -2 : n
}
async function elderOut(row: any) {
  const [{ count }, { data: activity }] = await Promise.all([
    admin.from('alerts').select('*', { count: 'exact', head: true }).eq('elder_id', row.id).eq('status', 'pending'),
    admin.from('activities').select('date').eq('elder_id', row.id).eq('date', day()).maybeSingle(),
  ])
  const inactive = row.last_active ? Math.floor((Date.now() - new Date(row.last_active).getTime()) / 86400000) : 99
  return { ...row, last_active: isoMinute(row.last_active), screened: Boolean(row.screened), pending_count: count ?? 0, days_inactive: inactive, today_active: Boolean(activity) }
}
async function alertOut(row: any) {
  const { data: elder } = await admin.from('elders').select('name').eq('id', row.elder_id).single()
  const processed = row.status === 'processed'
  const out: any = { id: row.id, elder_id: row.elder_id, elder_name: elder?.name ?? '', created_at: isoMinute(row.created_at), keyword: row.keyword, summary: row.summary, status: processed ? '已处理' : '待处理', severity: row.severity }
  if (processed) out.disposal = { id: row.id, alert_id: row.id, method: row.method ?? '', note: row.handle_note ?? '', handler: row.handler ?? '', created_at: isoMinute(row.processed_at) }
  return out
}
async function bumpActivity(elderId: number, rounds = 1, duration?: number) {
  const today = day()
  const { data: old } = await admin.from('activities').select('id,rounds,duration_min').eq('elder_id', elderId).eq('date', today).maybeSingle()
  const values = { elder_id: elderId, date: today, rounds: (old?.rounds ?? 0) + rounds, duration_min: (old?.duration_min ?? 0) + (duration || rounds * 2), active_slot: activeSlot() }
  check(await admin.from('activities').upsert(values, { onConflict: 'elder_id,date' }))
  const now = new Date()
  check(await admin.from('elders').update({ last_active: now.toISOString(), last_call: `今天 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}` }).eq('id', elderId))
}
async function handle(req: Request, ctx: Awaited<ReturnType<typeof context>>) {
  const u = new URL(req.url)
  const functionPrefix = '/functions/v1/api'
  const path = u.pathname.startsWith(functionPrefix) ? u.pathname.slice(functionPrefix.length) : u.pathname
  const method = req.method
  const body = method === 'POST' ? await req.json().catch(() => ({})) : {}
  const elderFields = 'id,name,age,dialect,living,family_name,relation,last_call,risk_level,last_active,mood,mood_summary,screened'

  if (method === 'GET' && path === '/api/me') return { ok: true, user_id: ctx.user.id, role: ctx.role, elder_id: ctx.elderId }
  if (method === 'GET' && path === '/api/ai/status') return { configured: Boolean(Deno.env.get('AI_API_KEY')), available: Boolean(Deno.env.get('AI_API_KEY')), model: Deno.env.get('AI_MODEL') ?? null, base_url: Deno.env.get('AI_BASE_URL') ?? null, mode: Deno.env.get('AI_API_KEY') ? 'real' : 'mock' }
  if (method === 'POST' && path === '/api/mock-call') return { ok: true, message: `已模拟拨打给 ${body.name ?? '家人'}` }

  if (method === 'GET' && path === '/api/stats') {
    if (ctx.role !== 'villager') throw new Error('村协管员权限不足')
    const [{ count: total }, { count: todayActive }, { count: pending }, { count: weekly }, { count: high }] = await Promise.all([
      admin.from('elders').select('*', { count: 'exact', head: true }),
      admin.from('elders').select('*', { count: 'exact', head: true }).gte('last_active', `${day()}T00:00:00`),
      admin.from('alerts').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      admin.from('alerts').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      admin.from('elders').select('*', { count: 'exact', head: true }).eq('risk_level', 'red'),
    ])
    return { total: total ?? 0, today_active: todayActive ?? 0, pending_alerts: pending ?? 0, weekly_new_risks: weekly ?? 0, high_risk: high ?? 0 }
  }
  if (method === 'GET' && path === '/api/screen-stats') {
    if (ctx.role !== 'villager') throw new Error('村协管员权限不足')
    const rows = check(await admin.from('elders').select('risk_level,screened')) as any[]
    const byLevel = { red: 0, yellow: 0, green: 0 }
    rows.forEach((r) => byLevel[r.risk_level as keyof typeof byLevel]++)
    const screened = rows.filter((r) => r.screened).length
    return { total: rows.length, screened, rate: rows.length ? Math.round(screened / rows.length * 100) / 100 : 0, byLevel }
  }
  if (method === 'GET' && path === '/api/elders') {
    if (ctx.role === 'villager') {
      const rows = check(await admin.from('elders').select(elderFields)) as any[]
      rows.sort((a, b) => riskOrder[a.risk_level] - riskOrder[b.risk_level] || a.id - b.id)
      return await Promise.all(rows.map(elderOut))
    }
    const ids = ctx.role === 'elder' && ctx.elderId ? [ctx.elderId] : (check(await admin.from('family_relations').select('elder_id').eq('family_user_id', ctx.user.id)) as any[]).map((r) => r.elder_id)
    if (!ids.length) return []
    const rows = check(await admin.from('elders').select(elderFields).in('id', ids)) as any[]
    rows.sort((a, b) => riskOrder[a.risk_level] - riskOrder[b.risk_level])
    return await Promise.all(rows.map(elderOut))
  }
  const detail = path.match(/^\/api\/elders\/(\d+)$/)
  if (method === 'GET' && detail) {
    const id = Number(detail[1]); await assertAccess(ctx, id)
    const row = check(await admin.from('elders').select(elderFields).eq('id', id).single())
    const { data: stats } = await admin.from('activities').select('elder_id,date,rounds,duration_min,active_slot,mood,note').eq('elder_id', id).gte('date', new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)).order('date')
    return { elder: await elderOut(row), daily_stats: stats ?? [] }
  }
  if (method === 'GET' && path === '/api/alerts') {
    const elderId = Number(u.searchParams.get('elder_id') || (ctx.role === 'elder' ? ctx.elderId : 0))
    if (ctx.role === 'family' || ctx.role === 'elder') await assertAccess(ctx, elderId)
    let q = admin.from('alerts').select('*').order('created_at', { ascending: false }).limit(Math.min(Number(u.searchParams.get('limit') || 100), 200))
    const status = u.searchParams.get('status')
    if (status === '待处理' || status === 'pending') q = q.eq('status', 'pending')
    if (status === '已处理' || status === 'processed') q = q.eq('status', 'processed')
    if (u.searchParams.has('elder_id') || ctx.role !== 'villager') q = q.eq('elder_id', elderId)
    return await Promise.all((check(await q) as any[]).map(alertOut))
  }
  const alertHandle = path.match(/^\/api\/alerts\/(\d+)\/handle$/)
  if (method === 'POST' && alertHandle) {
    const id = Number(alertHandle[1]); const alert = check(await admin.from('alerts').select('*').eq('id', id).single()) as any
    if (ctx.role === 'villager') { /* village staff can handle any alert */ }
    else await assertAccess(ctx, Number(alert.elder_id))
    const elder = check(await admin.from('elders').select('*').eq('id', alert.elder_id).single()) as any
    const level = elder.risk_level === 'red' ? 'yellow' : elder.risk_level === 'yellow' ? 'green' : 'green'
    const methodText = String(body.method ?? '电话回访'); const now = new Date().toISOString()
    check(await admin.from('alerts').update({ status: 'processed', processed_at: now, method: methodText, handle_note: body.note ?? '', handler: body.handler ?? '村协管员' }).eq('id', id))
    check(await admin.from('elders').update({ risk_level: level, mood_summary: `最近一次处置：${methodText}（${body.note || '已完成跟进'}）` }).eq('id', alert.elder_id))
    if (methodText.includes('转介')) check(await admin.from('referrals').insert({ elder_id: alert.elder_id, target: '乡镇卫生院 · 转介随访' }))
    const newElder = check(await admin.from('elders').select(elderFields).eq('id', alert.elder_id).single())
    const newAlert = check(await admin.from('alerts').select('*').eq('id', id).single())
    return { ok: true, elder: await elderOut(newElder), alert: await alertOut(newAlert) }
  }
  if (method === 'POST' && path === '/api/risk-report') {
    if (ctx.role !== 'elder') throw new Error('仅老人账号可以上报对话风险')
    const id = Number(ctx.elderId ?? body.elder_id); await assertAccess(ctx, id)
    const alert = check(await admin.from('alerts').insert({ elder_id: id, keyword: body.keyword ?? '消极情绪表达', summary: body.summary ?? '', status: 'pending', severity: 'high' }).select('id').single())
    check(await admin.from('elders').update({ risk_level: 'red', mood: '需关注' }).eq('id', id))
    return { ok: true, alert_id: alert.id }
  }
  if (method === 'POST' && path === '/api/activity') {
    if (ctx.role !== 'elder') throw new Error('仅老人账号可以上报活跃记录')
    const id = Number(ctx.elderId ?? body.elder_id); await assertAccess(ctx, id)
    const text = String(body.user_message ?? '').trim()
    if (text) {
      const d = classify(text)
      check(await admin.from('emotion_records').insert({ elder_id: id, emotion: body.emotion ?? d.mood, reason: body.emotion ? '前端识别' : d.reason, intensity: body.emotion ? 5 : d.intensity, user_message: text, ai_reply: body.ai_reply ?? '', date: day(), language: body.language ?? 'zh-CN' }))
      check(await admin.from('elders').update({ mood: d.mood }).eq('id', id))
    }
    await bumpActivity(id, Number(body.rounds || 1), Number(body.duration_min || 0))
    return { ok: true, ...(text ? { emotion: body.emotion ?? classify(text).mood } : {}) }
  }
  if (method === 'POST' && path === '/api/summary/generate') {
    const id = Number(body.elder_id ?? ctx.elderId); await assertAccess(ctx, id)
    const date = String(body.date ?? day())
    const elder = check(await admin.from('elders').select('name').eq('id', id).single())
    const rows = check(await admin.from('emotion_records').select('user_message,ai_reply,emotion,intensity').eq('elder_id', id).eq('date', date).order('timestamp')) as any[]
    const transcript = rows.map((r) => `老人：${r.user_message ?? ''}\n乡音：${r.ai_reply ?? ''}`).join('\n')
    let summary = rows.length ? `今天共进行了${rows.length}轮对话，主要情绪为${rows[0].emotion}。` : '今天还没有对话记录。'
    let offline = true
    const base = Deno.env.get('AI_BASE_URL'); const key = Deno.env.get('AI_API_KEY'); const model = Deno.env.get('AI_MODEL') ?? 'gpt-4o-mini'
    if (rows.length && base && key) try {
      const resp = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: '请将老人今天的陪伴对话整理成一句简短、尊重隐私的情绪与话题摘要，不要做诊断。' }, { role: 'user', content: `老人姓名：${elder.name}\n对话：\n${transcript}` }], temperature: 0.3, max_tokens: 120 }) })
      if (resp.ok) { summary = (await resp.json()).choices?.[0]?.message?.content?.trim() || summary; offline = false }
    } catch { /* keep deterministic summary */ }
    const meanMood = rows.length ? Math.round(rows.reduce((sum, r) => sum + score(r.emotion, r.intensity), 0) / rows.length) : 0
    check(await admin.from('activities').upsert({ elder_id: id, date, rounds: rows.length, duration_min: rows.length * 2, active_slot: activeSlot(), mood: meanMood, note: summary }, { onConflict: 'elder_id,date' }))
    if (date === day()) check(await admin.from('elders').update({ mood_summary: summary }).eq('id', id))
    return { ok: true, summary, offline }
  }
  if (method === 'POST' && path === '/api/chat') {
    if (ctx.role !== 'elder') throw new Error('仅老人账号可以使用老人对话接口')
    const id = Number(ctx.elderId ?? body.elder_id); await assertAccess(ctx, id)
    const message = String(body.message ?? '').trim(); if (!message) return fail('缺少必要参数: elder_id 或 message')
    const { data: historyRows } = await admin.from('emotion_records').select('user_message,ai_reply').eq('elder_id', id).order('timestamp', { ascending: false }).limit(10)
    const messages: any[] = [{ role: 'system', content: '你是乡音，一位温柔耐心的乡村 AI 陪伴伙伴。用简短自然的话共情老人；不做医学诊断。如发现明显危险念头，请温柔安抚并在回复开头写【风险预警】。' }]
    for (const r of (historyRows ?? []).reverse()) { if (r.user_message) messages.push({ role: 'user', content: r.user_message }); if (r.ai_reply) messages.push({ role: 'assistant', content: r.ai_reply }) }
    messages.push({ role: 'user', content: message })
    const base = Deno.env.get('AI_BASE_URL'); const key = Deno.env.get('AI_API_KEY'); const model = Deno.env.get('AI_MODEL') ?? 'gpt-4o-mini'
    let reply = '听您这么说，我心里也惦记着。您愿意再跟我讲讲吗？'; let offline = true
    if (base && key) try {
      const resp = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 200 }) })
      if (resp.ok) { const out = await resp.json(); reply = out.choices?.[0]?.message?.content?.replaceAll('【风险预警】', '').trim() || reply; offline = false }
    } catch { /* use safe offline reply */ }
    const detected = classify(message); const risk = detected.mood === '需关注' || /不想活|活着没意思|想不开|解脱/.test(message)
    const now = new Date().toISOString()
    check(await admin.from('emotion_records').insert({ elder_id: id, emotion: detected.mood, reason: detected.reason, intensity: detected.intensity, user_message: message, ai_reply: reply, date: day(), timestamp: now, language: body.language ?? 'zh-CN' }))
    await bumpActivity(id, 1)
    check(await admin.from('elders').update({ mood: risk ? '需关注' : detected.mood }).eq('id', id))
    let alertId: number | undefined
    if (risk) { const a = check(await admin.from('alerts').insert({ elder_id: id, keyword: detected.reason, summary: reply.slice(0, 60), status: 'pending', severity: 'high' }).select('id').single()); alertId = a.id; check(await admin.from('elders').update({ risk_level: 'red' }).eq('id', id)) }
    return { ok: true, emotion: detected.mood, reason: detected.reason, intensity: detected.intensity, ai_reply: reply, timestamp: now, risk, offline, ...(alertId ? { alert_id: alertId } : {}) }
  }
  if (method === 'GET' && path === '/api/summaries') {
    const id = Number(u.searchParams.get('elder_id') || ctx.elderId); await assertAccess(ctx, id)
    const { data: records } = await admin.from('emotion_records').select('emotion,user_message,ai_reply,timestamp').eq('elder_id', id).order('timestamp', { ascending: false }).limit(Math.min(Number(u.searchParams.get('limit') || 20) * 30, 600))
    const grouped = new Map<string, any[]>()
    for (const r of records ?? []) { const d = r.timestamp.slice(0, 10); grouped.set(d, [...(grouped.get(d) ?? []), r]) }
    const dates = [...grouped.keys()].sort().reverse().slice(0, Number(u.searchParams.get('limit') || 20))
    return await Promise.all(dates.map(async (date, i) => {
      const rows = (grouped.get(date) ?? []).reverse(); const counts = new Map<string, number>(); rows.forEach((r) => counts.set(r.emotion, (counts.get(r.emotion) ?? 0) + 1))
      const mood = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '无数据'
      const { data: activity } = await admin.from('activities').select('note').eq('elder_id', id).eq('date', date).maybeSingle()
      const turns = rows.slice(0, 3).flatMap((r) => [{ from: 'elder', text: r.user_message }, { from: 'ai', text: r.ai_reply }]).filter((r) => r.text)
      return { id: i + 1, elder_id: id, time: isoMinute(rows[0]?.timestamp), mood, summary: activity?.note || `今天共进行了${rows.length}轮对话，主要情绪为${mood}`, turns }
    }))
  }
  if (method === 'GET' && (path === '/api/care-messages' || path === '/api/care-message/pending')) {
    const id = Number(u.searchParams.get('elder_id') || ctx.elderId); await assertAccess(ctx, id)
    let q = admin.from('care_messages').select('*').eq('elder_id', id).order('created_at', { ascending: true })
    if (path.endsWith('/pending') || u.searchParams.get('pending') === '1') q = q.eq('conveyed', false)
    const rows = check(await q) as any[]
    const out = rows.map((r) => ({ ...r, created_at: isoMinute(r.created_at) }))
    return path.endsWith('/pending') ? out[0] ?? null : out
  }
  if (method === 'POST' && (path === '/api/care-message' || path === '/api/care-messages')) {
    const id = Number(body.elder_id); await assertAccess(ctx, id)
    if (ctx.role !== 'family') throw new Error('仅家属可以提交关怀留言')
    const row = check(await admin.from('care_messages').insert({ elder_id: id, content: String(body.content ?? '').trim() }).select('id').single())
    return { ok: true, id: row.id }
  }
  const conveyed = path.match(/^\/api\/care-messages\/(\d+)\/conveyed$/)
  if (method === 'POST' && conveyed) {
    if (ctx.role !== 'elder') throw new Error('仅老人账号可以标记留言已转达')
    const id = Number(conveyed[1]); const row = check(await admin.from('care_messages').select('elder_id').eq('id', id).single()) as any; await assertAccess(ctx, row.elder_id)
    check(await admin.from('care_messages').update({ conveyed: true }).eq('id', id)); return { ok: true }
  }
  if (method === 'GET' && path === '/api/referrals') {
    if (ctx.role !== 'villager') throw new Error('村协管员权限不足')
    const rows = check(await admin.from('referrals').select('id,elder_id,target,status,created_at,elders(name)').order('created_at', { ascending: false })) as any[]
    return rows.map((r) => ({ id: r.id, elder_id: r.elder_id, elder_name: r.elders?.name ?? '', target: r.target, time: isoMinute(r.created_at), status: r.status }))
  }
  if (method === 'GET' && path === '/api/family/elders') {
    if (ctx.role !== 'family') throw new Error('仅家属可访问')
    const ids = (check(await admin.from('family_relations').select('elder_id,relationship').eq('family_user_id', ctx.user.id)) as any[])
    const rows = await Promise.all(ids.map(async (rel) => ({ ...(await elderOut(check(await admin.from('elders').select(elderFields).eq('id', rel.elder_id).single()))), relationship: rel.relationship })))
    return { elders: rows }
  }
  const trend = path.match(/^\/api\/family\/elders\/(\d+)\/trend$/)
  if (method === 'GET' && trend) {
    const id = Number(trend[1]); await assertAccess(ctx, id)
    const start = new Date(Date.now() - Math.min(30, Math.max(1, Number(u.searchParams.get('days') || 7))) * 86400000).toISOString().slice(0, 10)
    const data = check(await admin.from('activities').select('date,rounds,duration_min,active_slot,mood,note').eq('elder_id', id).gte('date', start).order('date'))
    return { trend: data }
  }
  if (method === 'GET' && path === '/api/family/notifications') {
    if (ctx.role !== 'family') throw new Error('仅家属可访问')
    const relations = check(await admin.from('family_relations').select('elder_id').eq('family_user_id', ctx.user.id)) as any[]
    const ids = relations.map((r) => r.elder_id); if (!ids.length) return { notifications: [] }
    const alerts = check(await admin.from('alerts').select('*,elders(name)').in('elder_id', ids).order('created_at', { ascending: false }).limit(Number(u.searchParams.get('limit') || 10))) as any[]
    return { notifications: alerts.map((a) => ({ id: a.id, elder_name: a.elders.name, type: a.severity === 'high' ? 'emotion_alert' : 'emotion_warning', title: `${a.elders.name}的情绪异常`, message: a.summary || `检测到${a.keyword}情绪，强度较高`, severity: a.severity, created_at: isoMinute(a.created_at), read: false })) }
  }
  return fail('接口不存在')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const pathname = new URL(req.url).pathname
    if (req.method === 'POST' && pathname.endsWith('/api/auth/demo')) {
      const body = await req.json().catch(() => ({}))
      return json({ ok: true, session: await demoAuth(body) })
    }
    if (req.method === 'POST' && pathname.endsWith('/api/auth/demo/switch-role')) {
      const body = await req.json().catch(() => ({}))
      return json({ ok: true, session: await switchDemoRole(req, String(body.role ?? '')) })
    }
    const ctx = await context(req)
    return json(await handle(req, ctx))
  } catch (e) {
    const message = e instanceof Error ? e.message : '服务器内部错误'
    const status = message.includes('登录') ? 401 : message.includes('无权') || message.includes('权限') || message.includes('未启用') ? 403 : 200
    return json(fail(message), status)
  }
})
