/**
 * chat()：大模型对话封装（OpenAI 兼容接口）
 * ================================================================
 * 1. 先探测模型服务是否在线（极短超时，见 config.ts 的 PROBE_TIMEOUT）：
 *    - 在线 → 走真实大模型（本地 Ollama / DeepSeek / 硅基流动均可）；
 *    - 不在线 → 直接走本地 mock 温情回复，**不做无谓等待**，路演绝不卡住。
 * 2. 无论走真实模型还是 mock，都做一次情绪筛查：
 *    - 真实模型按 System Prompt 输出【风险预警】标记 → 提取为风险上报；
 *    - mock 回复时用本地关键词筛查（lib/risk.ts）同样能触发风险上报。
 * 3. 任何异常都优雅降级，绝不抛错、绝不白屏。
 */
import { API_BASE_URL, API_KEY, API_MODEL, LLM_ENABLED, PROBE_TIMEOUT, REQUEST_TIMEOUT, SYSTEM_PROMPT } from '../config'
import { mockReply } from './mock'
import { matchRisk } from './risk'
import { getElderId } from './session'
import type { ChatMsg } from '../types'
import { apiRequest } from './api'
import { isSupabaseConfigured } from './supabaseAuth'

export interface ChatRisk {
  keyword: string
  summary: string
}

export interface ChatResult {
  text: string
  /** true = 走了本地演示回复（气泡上带"网络开小差"小标签） */
  offline: boolean
  /** true = 本轮由后端 /api/chat 生成（真实大模型 + 数据库多轮记忆，活跃/预警已由后端落库） */
  viaBackend?: boolean
  /** 触发风险预警时返回，由调用方上报（演示动线核心：老人端 → 家属端 / 村协端） */
  risk?: ChatRisk
}

/** System Prompt 约定的风险标记 */
const RISK_MARKER = '【风险预警】'

const BASE = API_BASE_URL.replace(/\/+$/, '')

/* -------------------------------------------------- 模型服务在线探测（缓存） */

let llmReady: boolean | null = null
let probing: Promise<boolean> | null = null

async function probeLLM(): Promise<boolean> {
  if (!LLM_ENABLED) return false
  if (llmReady !== null) return llmReady
  if (!probing) {
    probing = (async () => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT)
        const res = await fetch(`${BASE}/models`, {
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
          signal: controller.signal,
        })
        clearTimeout(timer)
        llmReady = res.ok
      } catch {
        llmReady = false // 没装本地模型 / 没网：本会话内直接用 mock，不再重试探测
      }
      probing = null
      return llmReady
    })()
  }
  return probing
}

/** 让"回复生成中"有自然节奏，避免 mock 回复瞬间弹出、演示显得假 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function chat(history: ChatMsg[]): Promise<ChatResult> {
  // 找到老人最近说的一句话：降级时用于挑更贴心的 mock 回复 + 本地风险筛查
  const lastUser = [...history].reverse().find((m) => m.from === 'user')?.text ?? ''

  // ① 优先走后端 /api/chat：真实大模型 + 数据库多轮记忆（记忆跨页面刷新持久）
  try {
    const d = await apiRequest<any>('POST', '/api/chat', {
        elder_id: getElderId(),
        message: lastUser,
        language: 'zh-CN',
    })
    if (d && d.ok !== false && d.ai_reply) {
        return {
          text: String(d.ai_reply),
          offline: Boolean(d.offline),
          viaBackend: true,
          risk: d.risk
            ? { keyword: String(d.reason ?? '消极情绪表达'), summary: String(d.ai_reply).slice(0, 60) }
            : undefined,
        }
    }
  } catch {
    /* 后端不在线 → 本地降级回复 */
  }

  // In a Supabase build, never call an LLM directly from the browser (the key
  // belongs in Edge Function secrets). Keep only the safe offline fallback.
  if (isSupabaseConfigured()) {
    await sleep(500)
    return offlineResult(lastUser)
  }

  if (!(await probeLLM())) {
    await sleep(600 + Math.random() * 500)
    return offlineResult(lastUser)
  }

  // 组装 OpenAI 格式的 messages：system 人设 + 最近 10 轮对话（防止超上下文）
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-10).map((m) => ({
      role: m.from === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.text,
    })),
  ]

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: API_MODEL,
        messages,
        temperature: 0.8,
        max_tokens: 200,
        stream: false,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    let text: string | undefined = data?.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('empty response')

    // 大模型按 System Prompt 输出【风险预警】标记 → 提取为风险上报，界面上不显示该标记
    let risk: ChatRisk | undefined
    if (text.includes(RISK_MARKER)) {
      text = text.split(RISK_MARKER).join('').trim()
      const m = matchRisk(lastUser)
      risk = {
        keyword: m ? `${m.keyword}（${m.level === 'high' ? '疑似轻生 / 绝望表达' : '情绪低落'}）` : '消极情绪表达',
        summary: text.slice(0, 60),
      }
    } else {
      // 模型偶尔漏标记：本地关键词兜底再筛一次，保证演示动线稳定触发
      const m = matchRisk(lastUser)
      if (m) risk = { keyword: m.keyword, summary: text.slice(0, 60) }
    }
    return { text, offline: false, risk }
  } catch {
    // 真实接口中途失败：同样优雅降级为本地演示回复
    llmReady = false
    return offlineResult(lastUser)
  }
}

/** 本地演示回复 + 本地关键词风险筛查 */
function offlineResult(lastUser: string): ChatResult {
  const text = mockReply(lastUser)
  const m = matchRisk(lastUser)
  return {
    text,
    offline: true,
    risk: m
      ? { keyword: m.keyword, summary: text.slice(0, 60) }
      : undefined,
  }
}
