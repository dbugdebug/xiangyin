import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const METHODS = ['电话回访','上门探访','已联系家属','建议转介乡镇卫生院','暂不处置需继续观察'];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
const fail = (message: string, status = 400) => json({ ok: false, message }, status);
const isoDay = () => new Date().toISOString().slice(0,10);

async function body(req: Request) { try { return await req.json(); } catch { return {}; } }
async function authUser(req: Request): Promise<{ user: User; db: SupabaseClient } | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if (!token) return null;
  const db = createClient(URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : { user: data.user, db };
}
async function profile(user: User) {
  const { data } = await admin.from('profiles').select('*').eq('id',user.id).maybeSingle();
  return data;
}
async function canAccessElder(user: User, elderId: number, mode: 'read'|'write'='read') {
  const p = await profile(user);
  if (p?.role === 'admin') return true;
  const { data: elder } = await admin.from('elder_profiles').select('id,user_id,community_id').eq('id',elderId).maybeSingle();
  if (!elder) return false;
  if (elder.user_id === user.id) return true;
  const { data: family } = await admin.from('family_members').select('id').eq('elder_id',elderId).eq('family_user_id',user.id).eq('approved_by_elder',true).maybeSingle();
  if (family) {
    if (mode === 'write') return false;
    const { data: consent } = await admin.from('consents').select('id').eq('elder_id',elderId).eq('granted',true).is('revoked_at',null).eq('consent_type','family_view').limit(1).maybeSingle();
    return !!consent;
  }
  if (p?.role === 'community' && elder.community_id) {
    const { data: membership } = await admin.from('community_memberships').select('community_id').eq('community_id',elder.community_id).eq('user_id',user.id).eq('approved',true).maybeSingle();
    if (!membership) return false;
    const { data: consent } = await admin.from('consents').select('id').eq('elder_id',elderId).eq('granted',true).is('revoked_at',null).eq('consent_type','community_followup').limit(1).maybeSingle();
    return !!consent;
  }
  return false;
}
async function requireAccess(user: User, elderId: number, mode: 'read'|'write'='read') {
  if (!Number.isInteger(elderId) || elderId <= 0) return false;
  return await canAccessElder(user,elderId,mode);
}
function mapElder(e: any, pending = 0, today = 0) {
  return { id:e.id, name:e.name, age:e.age, dialect:e.dialect, living:e.living, family_name:e.family_name, relation:e.relation, last_call:e.last_call, risk_level:e.risk_level, last_active:e.last_active, mood:e.mood, screened:e.screened, pending_count:pending, today_active:today };
}
async function enrichedElders(rows: any[]) {
  const ids = rows.map(x=>x.id); if (!ids.length) return [];
  const { data: alerts } = await admin.from('risk_events').select('elder_id').in('elder_id',ids).eq('status','待处理');
  const { data: activity } = await admin.from('activity_records').select('elder_id,rounds').in('elder_id',ids).gte('created_at',`${isoDay()}T00:00:00.000Z`);
  return rows.map(e=>mapElder(e,(alerts||[]).filter(a=>a.elder_id===e.id).length,(activity||[]).filter(a=>a.elder_id===e.id).reduce((n,a)=>n+a.rounds,0)));
}
async function log(userId:string, action:string, resourceType:string, resourceId?:string) { await admin.from('audit_logs').insert({actor:userId,action,resource_type:resourceType,resource_id:resourceId||null}); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ok:true});
  const url = new URL(req.url);
  // Supabase function URL: /functions/v1/api/<route>. Also tolerate /api/<route> in local proxy.
  const path = url.pathname.replace(/^.*\/functions\/v1\/api/,'').replace(/^\/api/,'').replace(/\/$/,'') || '/';
  const method = req.method.toUpperCase();
  const b = method === 'POST' ? await body(req) : {};

  try {
    // Auth endpoints. Passwords are sent only to Supabase Auth over HTTPS.
    if (path === '/auth/register' && method === 'POST') {
      if (typeof b.email !== 'string' || !b.email.includes('@') || typeof b.password !== 'string' || b.password.length < 8) return fail('请提供有效邮箱，密码至少 8 位');
      const publicClient = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
      const { data, error } = await publicClient.auth.signUp({ email:b.email, password:b.password, options:{ data:{display_name: typeof b.display_name==='string' ? b.display_name.slice(0,80) : ''} } });
      if (error) return fail(error.message, 400);
      if (!data.user) return fail('注册未完成，请检查邮箱和 Auth 配置', 400);
      return json({ok:true, user:{id:data.user.id,email:data.user.email}, message:data.session ? '注册成功，可以直接登录' : '注册申请已提交，请查收验证邮件后登录'},201);
    }
    if (path === '/auth/login' && method === 'POST') {
      if (typeof b.email !== 'string' || typeof b.password !== 'string') return fail('email 和 password 必填');
      const client = createClient(URL,ANON_KEY,{auth:{persistSession:false}});
      const { data, error } = await client.auth.signInWithPassword({email:b.email,password:b.password});
      if (error || !data.session) return fail('邮箱或密码错误，或账号尚未完成验证',401);
      const p = await profile(data.user);
      return json({ok:true,access_token:data.session.access_token,refresh_token:data.session.refresh_token,expires_at:data.session.expires_at,user:{id:data.user.id,email:data.user.email,display_name:p?.display_name||'',role:p?.role||'elder'}});
    }
    const auth = await authUser(req);
    if (path === '/auth/me' && method === 'GET') {
      if (!auth) return fail('请先登录',401);
      const p = await profile(auth.user);
      return json({ok:true,user:{id:auth.user.id,email:auth.user.email,display_name:p?.display_name||'',role:p?.role||'elder'}});
    }
    if (path === '/auth/logout' && method === 'POST') {
      // JWTs are stateless at the API gateway; client should also clear stored session.
      if (!auth) return fail('请先登录',401);
      return json({ok:true,message:'已退出当前客户端会话；请清除本地 token'});
    }
    if (!auth) return fail('未登录或登录已过期',401);
    const user = auth.user;
    const p = await profile(user);
    if (!p) return fail('用户资料未初始化，请联系管理员',403);
    const isAdmin = p.role === 'admin';
    const isCommunity = p.role === 'community';

    if (path === '/stats' && method === 'GET') {
      if (!isAdmin && !isCommunity) return fail('无权查看管理统计',403);
      let q = admin.from('elder_profiles').select('id,risk_level,created_at,community_id');
      if (isCommunity) { const {data:m}=await admin.from('community_memberships').select('community_id').eq('user_id',user.id).eq('approved',true); q=q.in('community_id',(m||[]).map(x=>x.community_id)); }
      const {data:elders,error}=await q; if(error) throw error;
      const rows=elders||[]; const elderIds=rows.map(e=>e.id);
      const {data:alerts}=elderIds.length ? await admin.from('risk_events').select('id,elder_id,created_at,status').in('elder_id',elderIds) : {data:[]};
      return json({total:rows.length,today_active:0,pending_alerts:(alerts||[]).filter(a=>a.status==='待处理').length,weekly_new_risks:(alerts||[]).filter(a=>a.created_at>=new Date(Date.now()-7*86400000).toISOString()).length,high_risk:rows.filter(e=>e.risk_level==='red').length});
    }
    if (path === '/screen-stats' && method === 'GET') {
      if (!isAdmin && !isCommunity) return fail('无权查看筛查统计',403);
      let q=admin.from('elder_profiles').select('id,screened,risk_level,community_id');
      if(isCommunity){const {data:m}=await admin.from('community_memberships').select('community_id').eq('user_id',user.id).eq('approved',true);q=q.in('community_id',(m||[]).map(x=>x.community_id));}
      const {data,error}=await q;if(error)throw error;const rows=data||[];const screened=rows.filter(x=>x.screened).length;
      return json({total:rows.length,screened,rate:rows.length?Math.round(screened/rows.length*100):0,byLevel:{red:rows.filter(x=>x.risk_level==='red').length,yellow:rows.filter(x=>x.risk_level==='yellow').length,green:rows.filter(x=>x.risk_level==='green').length}});
    }
    if (path === '/elders' && method === 'GET') {
      if (!isAdmin && !isCommunity) return fail('无权查看老人名册',403);
      let q=admin.from('elder_profiles').select('*');
      if(isCommunity){const {data:m}=await admin.from('community_memberships').select('community_id').eq('user_id',user.id).eq('approved',true);q=q.in('community_id',(m||[]).map(x=>x.community_id));}
      const {data,error}=await q;if(error)throw error;const rows=data||[];const order={red:0,yellow:1,green:2};rows.sort((a,b)=>order[a.risk_level as keyof typeof order]-order[b.risk_level as keyof typeof order]);return json(await enrichedElders(rows));
    }
    const elderMatch=path.match(/^\/elders\/(\d+)$/);
    if(elderMatch && method==='GET'){
      const id=Number(elderMatch[1]);if(!await requireAccess(user,id,'read'))return fail('无权访问该老人档案',403);
      const {data:e,error}=await admin.from('elder_profiles').select('*').eq('id',id).single();if(error)throw error;
      const {data:a}=await admin.from('activity_records').select('*').eq('elder_id',id).gte('created_at',new Date(Date.now()-7*86400000).toISOString()).order('created_at');
      const daily=(a||[]).map(x=>({elder_id:id,date:x.created_at.slice(0,10),rounds:x.rounds,duration_min:x.duration_min,active_slot:'',mood:x.mood,note:x.note}));
      return json({elder:(await enrichedElders([e]))[0],daily_stats:daily});
    }
    if(path==='/alerts' && method==='GET'){
      if(!isAdmin&&!isCommunity)return fail('无权查看预警列表',403);
      let q=admin.from('risk_events').select('*,elder_profiles!inner(name,community_id),case_actions(*)').order('created_at',{ascending:false});
      const status=url.searchParams.get('status');if(status==='待处理'||status==='已处理')q=q.eq('status',status);
      const eid=url.searchParams.get('elder_id');if(eid){if(!await requireAccess(user,Number(eid),'read'))return fail('无权访问该老人预警',403);q=q.eq('elder_id',Number(eid));}
      const {data,error}=await q;if(error)throw error;
      const out=[];for(const a of data||[]){if(isCommunity&&!isAdmin){const {data:m}=await admin.from('community_memberships').select('community_id').eq('user_id',user.id).eq('approved',true);if(!(m||[]).some(x=>x.community_id===a.elder_profiles.community_id))continue;}out.push({id:a.id,elder_id:a.elder_id,elder_name:a.elder_profiles.name,created_at:a.created_at,keyword:a.keyword,summary:a.summary,status:a.status,severity:a.severity,disposal:(a.case_actions||[]).sort((x:any,y:any)=>y.created_at.localeCompare(x.created_at))[0]||null});}return json(out);
    }
    const handleMatch=path.match(/^\/alerts\/(\d+)\/handle$/);
    if(handleMatch&&method==='POST'){
      if(!isAdmin&&!isCommunity)return fail('只有社区工作人员或管理员可以处置预警',403);
      const id=Number(handleMatch[1]);const {data:a,error:ae}=await admin.from('risk_events').select('*,elder_profiles!inner(id,community_id)').eq('id',id).single();if(ae||!a)return fail('预警不存在',404);
      if(!await requireAccess(user,a.elder_id,'write'))return fail('无权处置该老人预警',403);
      if(!METHODS.includes(b.method))return fail('method 不合法');
      const {data:action,error}=await admin.from('case_actions').insert({alert_id:id,method:b.method,note:typeof b.note==='string'?b.note.slice(0,2000):'',handler:user.id,handler_name:typeof b.handler==='string'?b.handler.slice(0,80):(p.display_name||'')}).select().single();if(error)throw error;
      const {data:updated,error:ue}=await admin.from('risk_events').update({status:'已处理',resolved_at:new Date().toISOString()}).eq('id',id).select().single();if(ue)throw ue;
      if(b.method==='建议转介乡镇卫生院'){const {error:re}=await admin.from('referrals').insert({elder_id:a.elder_id,target:'乡镇卫生院',created_by:user.id});if(re)throw re;}
      await log(user.id,'handle_alert','risk_event',String(id));const {data:e}=await admin.from('elder_profiles').select('*').eq('id',a.elder_id).single();return json({ok:true,elder:(await enrichedElders([e]))[0],alert:{id:updated.id,elder_id:updated.elder_id,created_at:updated.created_at,keyword:updated.keyword,summary:updated.summary,status:updated.status,severity:updated.severity,disposal:action}});
    }
    if(path==='/risk-report'&&method==='POST'){
      const id=Number(b.elder_id);if(!await requireAccess(user,id,'write'))return fail('无权为该老人提交风险报告',403);
      if(typeof b.summary!=='string'||!b.summary.trim())return fail('summary 必填');
      const {data:elder}=await admin.from('elder_profiles').select('id,risk_level').eq('id',id).single();if(!elder)return fail('老人不存在',404);
      const {data:caseRow}=await admin.from('risk_cases').insert({elder_id:id,risk_level:'red',status:'open'}).select().single();
      const {data:event,error}=await admin.from('risk_events').insert({elder_id:id,case_id:caseRow?.id||null,keyword:typeof b.keyword==='string'?b.keyword.slice(0,120):'',summary:b.summary.slice(0,3000),severity:'red',status:'待处理',created_by:user.id}).select().single();if(error)throw error;
      await admin.from('elder_profiles').update({risk_level:'red'}).eq('id',id);await log(user.id,'create_risk_report','risk_event',String(event.id));return json({ok:true,alert_id:event.id},201);
    }
    if(path==='/activity'&&method==='POST'){
      const id=Number(b.elder_id),rounds=Number(b.rounds);if(!await requireAccess(user,id,'write'))return fail('无权记录该老人活动',403);if(!Number.isInteger(rounds)||rounds<1||rounds>100)return fail('rounds 必须是 1–100 的整数');
      const {error}=await admin.from('activity_records').insert({elder_id:id,rounds});if(error)throw error;await admin.from('elder_profiles').update({last_active:new Date().toISOString()}).eq('id',id);return json({ok:true});
    }
    if(path==='/summaries'&&method==='GET'){
      const id=Number(url.searchParams.get('elder_id'));if(!await requireAccess(user,id,'read'))return fail('无权查看对话摘要',403);
      const {data,error}=await admin.from('conversation_summaries').select('*').eq('elder_id',id).order('created_at',{ascending:false}).limit(20);if(error)throw error;return json((data||[]).map(x=>({id:x.id,elder_id:x.elder_id,time:x.created_at,mood:x.mood,summary:x.summary,turns:Array.isArray(x.turns)?x.turns.slice(0,8):[]})));
    }
    if((path==='/care-messages'||path==='/care-message/pending')&&method==='GET'){
      const id=Number(url.searchParams.get('elder_id'));if(!await requireAccess(user,id,'read'))return fail('无权查看家属关怀消息',403);
      let q=admin.from('care_messages').select('*').eq('elder_id',id).order('created_at',{ascending:false});if(url.searchParams.get('pending')==='1'||path==='/care-message/pending')q=q.eq('conveyed',false);const {data,error}=await q.limit(30);if(error)throw error;
      const mapped=(data||[]).map(x=>({id:x.id,elder_id:x.elder_id,content:x.content,conveyed:x.conveyed,created_at:x.created_at}));return json(path==='/care-message/pending'?(mapped[0]||null):mapped);
    }
    if((path==='/care-message'||path==='/care-messages')&&method==='POST'){
      const id=Number(b.elder_id);if(!await requireAccess(user,id,'read'))return fail('无权向该老人发送关怀消息',403);if(typeof b.content!=='string'||!b.content.trim()||b.content.length>2000)return fail('content 长度必须为 1–2000');
      const {data,error}=await admin.from('care_messages').insert({elder_id:id,sender_user_id:user.id,content:b.content.trim()}).select('id').single();if(error)throw error;return json({ok:true,id:data.id},201);
    }
    const conveyed=path.match(/^\/care-messages\/(\d+)\/conveyed$/);
    if(conveyed&&method==='POST'){
      const id=Number(conveyed[1]);const {data:m}=await admin.from('care_messages').select('elder_id').eq('id',id).maybeSingle();if(!m||!await requireAccess(user,m.elder_id,'write'))return fail('无权更新该消息',403);const {error}=await admin.from('care_messages').update({conveyed:true,conveyed_at:new Date().toISOString()}).eq('id',id);if(error)throw error;return json({ok:true});
    }
    if(path==='/referrals'&&method==='GET'){
      if(!isAdmin&&!isCommunity)return fail('无权查看转介列表',403);const {data,error}=await admin.from('referrals').select('*,elder_profiles!inner(name,community_id)').order('created_at',{ascending:false});if(error)throw error;const out=[];for(const r of data||[]){if(isCommunity&&!isAdmin){const {data:m}=await admin.from('community_memberships').select('community_id').eq('user_id',user.id).eq('approved',true);if(!(m||[]).some(x=>x.community_id===r.elder_profiles.community_id))continue;}out.push({id:r.id,elder_id:r.elder_id,elder_name:r.elder_profiles.name,target:r.target,time:r.created_at,status:r.status});}return json(out);
    }
    if(path==='/mock-call'&&method==='POST'){
      if(!isAdmin&&!isCommunity)return fail('无权使用模拟拨号',403);const name=typeof b.name==='string'?b.name.trim().slice(0,80):'';if(!name)return fail('name 必填');return json({ok:true,message:`已模拟拨打给 ${name}`});
    }
    return fail('接口不存在',404);
  } catch (e) {
    console.error(e);
    return fail('服务器处理失败，请检查函数日志',500);
  }
});
