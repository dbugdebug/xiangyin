// Frontend adapter example for a Vite/TypeScript project.
// Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.
const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function saveSession(accessToken: string, refreshToken?: string) {
  localStorage.setItem('xiangyin_access_token', accessToken);
  if (refreshToken) localStorage.setItem('xiangyin_refresh_token', refreshToken);
}
export function clearSession() {
  localStorage.removeItem('xiangyin_access_token');
  localStorage.removeItem('xiangyin_refresh_token');
}
export async function api<T>(path: string, options: { method?: 'GET'|'POST'; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const token = localStorage.getItem('xiangyin_access_token');
  const headers: Record<string,string> = { apikey: KEY, 'Content-Type':'application/json' };
  if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    method: options.method || 'GET', headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(()=>({message:'服务器返回了非 JSON 内容'}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || `请求失败 (${response.status})`);
  return data as T;
}
export async function register(email:string,password:string,display_name:string) {
  return api<{ok:boolean;user:{id:string;email:string};message:string}>('/auth/register',{method:'POST',auth:false,body:{email,password,display_name}});
}
export async function login(email:string,password:string) {
  const result = await api<{ok:boolean;access_token:string;refresh_token:string;expires_at:number;user:{id:string;email:string;display_name:string;role:string}}>('/auth/login',{method:'POST',auth:false,body:{email,password}});
  saveSession(result.access_token,result.refresh_token); return result;
}
export async function logout() {
  try { await api('/auth/logout',{method:'POST'}); } finally { clearSession(); }
}
export const getMe = () => api('/auth/me');
