/**
 * 语音朗读（TTS）：封装浏览器 speechSynthesis。
 * - 自动挑选中文语音，语速稍慢（0.9），适合老人听
 * - 提供 speak / stopSpeak / ttsSupported，配合气泡上的"🔊 播放 / ⏹ 停止"实现重新播放
 */

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

let cachedVoice: SpeechSynthesisVoice | null = null

function pickVoice() {
  if (!ttsSupported) return
  const voices = speechSynthesis.getVoices()
  cachedVoice =
    // 优先挑听感亲切的中文女声
    voices.find(
      (v) => /zh[-_]CN/i.test(v.lang) && /xiaoxiao|xiaoyi|huihui|yaoyao|yunyang/i.test(v.name),
    ) ??
    voices.find((v) => /zh[-_]CN/i.test(v.lang)) ??
    voices.find((v) => /^zh/i.test(v.lang)) ??
    null
}

if (ttsSupported) {
  pickVoice()
  speechSynthesis.onvoiceschanged = pickVoice
}

interface Handlers {
  onStart?: () => void
  onEnd?: () => void
}

/** 朗读一段文本；不支持 TTS 的浏览器直接回调 onEnd（文字兜底显示） */
export function speak(text: string, handlers: Handlers = {}) {
  if (!ttsSupported) {
    handlers.onEnd?.()
    return
  }
  speechSynthesis.cancel() // 打断上一条，避免排队堆叠
  const u = new SpeechSynthesisUtterance(text)
  if (cachedVoice) u.voice = cachedVoice
  u.lang = cachedVoice?.lang ?? 'zh-CN'
  u.rate = 0.9 // 稍慢，老人听得清
  u.pitch = 1
  u.onstart = () => handlers.onStart?.()
  u.onend = () => handlers.onEnd?.()
  u.onerror = () => handlers.onEnd?.()
  speechSynthesis.speak(u)
}

/** 停止朗读 */
export function stopSpeak() {
  if (ttsSupported) speechSynthesis.cancel()
}
