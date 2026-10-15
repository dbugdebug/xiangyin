import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChatMsg, Stage } from '../types'
import { chat } from '../lib/chat'
import { speak, stopSpeak, ttsSupported } from '../lib/tts'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { uid } from '../lib/utils'
import { api } from '../lib/api'
import type { CareMessage } from '../lib/api'
import { clearRole, getElderId, getRole, ROLE_LABEL } from '../lib/session'
import ChatBubble from '../components/ChatBubble'
import MicButton from '../components/MicButton'
import StatusBar from '../components/StatusBar'
import CallFamilyModal from '../components/CallFamilyModal'
import Toast from '../components/Toast'
import RoleSwitch from '../components/RoleSwitch'

const WELCOME =
  '哎，您好呀！我是乡音，往后咱就是老熟人了。今儿个心情咋样？想唠点啥，点下面的大红按钮跟我说就行。'

/** 按时间段给一句温暖问候 */
function greetingByTime(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，注意保暖呀'
  if (h < 9) return '早上好呀'
  if (h < 12) return '上午好呀'
  if (h < 14) return '中午好呀'
  if (h < 18) return '下午好呀'
  return '晚上好呀'
}

/**
 * 语音对话主页（产品核心页）：
 * 顶栏（对话对象 + 问候）→ 呼叫家人常驻入口 → 气泡对话流 → 底部大麦克风按钮。
 * 一轮对话四态：聆听中 → 识别中 → 回复生成中 → 播放中。
 */
export default function Chat() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: uid(), from: 'ai', text: WELCOME, offline: false },
  ])
  const [stage, setStage] = useState<Stage>('idle')
  const [interim, setInterim] = useState('')
  const [notice, setNotice] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [showText, setShowText] = useState(false)
  const [text, setText] = useState('')
  const [callOpen, setCallOpen] = useState(false)

  const messagesRef = useRef<ChatMsg[]>(messages) // 供异步流程读到最新对话
  const busyRef = useRef(false) // 一轮对话未结束前不接受新输入
  const bottomRef = useRef<HTMLDivElement>(null)

  const { supported: asrSupported, listen, stop } = useSpeechRecognition({
    onInterim: (t) => setInterim(t),
  })

  // 新消息 / 状态变化时自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, stage])

  // Toast 自动消失
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 2800)
    return () => clearTimeout(t)
  }, [notice])

  const append = (m: ChatMsg) => {
    messagesRef.current = [...messagesRef.current, m]
    setMessages(messagesRef.current)
  }

  // 家属捎话：拉取未转达的关怀留言，以 AI 口吻带入对话（即注入后续对话上下文），并标记已转达
  useEffect(() => {
    ;(async () => {
      try {
        const msgs = await api.get<CareMessage[]>(
          `/api/care-messages?elder_id=${getElderId()}&pending=1`,
        )
        for (const m of msgs) {
          append({
            id: uid(),
            from: 'ai',
            text: `对了，家里人给您捎了个话："${m.content}" 他们呀，心里可惦记您呢。`,
          })
          // 标记已转达（失败静默，不影响老人端使用）
          api.post(`/api/care-messages/${m.id}/conveyed`, {}).catch(() => {})
        }
      } catch {
        /* 后端未启动时静默降级，老人端照常可用 */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 老人说完一句话（语音或文字）后的流程：生成 → 自动朗读 */
  const handleUserText = async (userText: string) => {
    const t = userText.trim()
    if (!t || busyRef.current) return
    busyRef.current = true
    stopSpeak()
    setPlayingId(null)

    append({ id: uid(), from: 'user', text: t })
    setStage('generating')

    const { text: aiText, offline, risk, viaBackend } = await chat(messagesRef.current)
    const aiMsg: ChatMsg = { id: uid(), from: 'ai', text: aiText, offline }
    append(aiMsg)

    // ---- 演示动线（对老人静默，不打扰聊天氛围）----
    if (!viaBackend) {
      // 前端直连/本地 mock 模式：由前端上报活跃与风险
      // ① 每轮对话上报活跃统计：今日轮次 / 陪伴时长 / 最后活跃日期
      api.post('/api/activity', { elder_id: getElderId(), rounds: 1 }).catch(() => {})
      // ② 触发风险预警：写入后端预警表并把老人风险等级升为红（家属端/村协端立刻可见）
      if (risk) {
        api
          .post('/api/risk-report', {
            elder_id: getElderId(),
            keyword: risk.keyword,
            summary: risk.summary,
          })
          .catch(() => {})
      }
    }
    // viaBackend（后端 /api/chat 模式）：活跃累计、情绪识别、风险预警均已由后端落库，无需重复上报

    if (ttsSupported) {
      // 播放中：朗读 AI 回复，读完回到空闲
      setStage('speaking')
      setPlayingId(aiMsg.id)
      speak(aiText, {
        onEnd: () => {
          setStage('idle')
          setPlayingId(null)
        },
      })
    } else {
      setStage('idle')
    }
    busyRef.current = false
  }

  /** 大按钮：点击开始说话，再点一下表示说完了 */
  const onMic = async () => {
    if (stage === 'listening') {
      stop()
      return
    }
    if (stage !== 'idle' || busyRef.current) return

    if (!asrSupported) {
      setNotice('当前浏览器不支持语音输入，您可以打字')
      setShowText(true)
      return
    }

    setInterim('')
    setStage('listening')
    try {
      const finalText = await listen()
      setStage('recognizing')
      await new Promise((r) => setTimeout(r, 600)) // 让"识别中"提示可见，演示节奏更清楚
      setInterim('')
      if (finalText) {
        await handleUserText(finalText)
      } else {
        setNotice('没太听清，您再说说看')
        setStage('idle')
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? '')
      setNotice(
        msg.includes('not-allowed') || msg.includes('denied')
          ? '请允许使用麦克风，我才能听见您哦'
          : '刚才没听清，您再说一遍',
      )
      setStage('idle')
    }
  }

  /** 气泡上的"🔊 播放 / ⏹ 停止"：支持随时重播任一条 AI 回复 */
  const togglePlay = (m: ChatMsg) => {
    if (!ttsSupported) {
      setNotice('当前浏览器不支持朗读，您看文字就好')
      return
    }
    if (playingId === m.id) {
      stopSpeak()
      setPlayingId(null)
      if (stage === 'speaking') setStage('idle')
      return
    }
    setPlayingId(m.id)
    speak(m.text, { onEnd: () => setPlayingId(null) })
  }

  const sendTyped = () => {
    const t = text
    setText('')
    if (t.trim()) handleUserText(t)
  }

  return (
    <div className="flex h-full flex-col">
      {/* ===== 顶栏：对话对象 + 温暖问候 ===== */}
      <header className="shrink-0 flex items-center gap-3 border-b border-orange-100 bg-white/90 px-5 py-3.5">
        <div className="relative shrink-0">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-400 text-2xl shadow-md shadow-orange-300/50">
            🌾
          </div>
          <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white bg-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold leading-tight text-stone-800">乡音</h1>
            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-sm font-semibold text-orange-600">
              {ROLE_LABEL[getRole() ?? 'elder']}
            </span>
          </div>
          <p className="truncate text-lg text-stone-500">{greetingByTime()}，我一直在呢</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* 路演专用：一键切换演示角色（生产环境移除） */}
          <RoleSwitch compact />
          <button
            onClick={() => {
              clearRole()
              navigate('/login')
            }}
            className="h-12 rounded-full bg-stone-100 px-4 text-lg text-stone-500 transition active:scale-95"
          >
            退出
          </button>
        </div>
      </header>

      {/* ===== "一键呼叫家人"常驻入口（求助 / 转介功能）===== */}
      <div className="shrink-0 px-4 pt-3">
        <button
          onClick={() => setCallOpen(true)}
          className="h-14 w-full rounded-2xl bg-gradient-to-r from-rose-500 to-orange-500 text-xl font-bold text-white shadow-lg shadow-rose-300/40 transition active:scale-[0.99]"
        >
          📞 需要帮助？一键呼叫家人
        </button>
      </div>

      {/* ===== 气泡式对话流 ===== */}
      <main className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {messages.map((m) => (
          <ChatBubble
            key={m.id}
            msg={m}
            playing={playingId === m.id}
            onTogglePlay={() => togglePlay(m)}
          />
        ))}
        {/* 生成中：小气泡三个跳动点 */}
        {stage === 'generating' && (
          <div className="bubble-in flex items-start gap-2">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-400 text-xl shadow">
              🌾
            </div>
            <div className="flex items-center gap-1.5 rounded-3xl rounded-tl-md bg-white px-6 py-5 shadow-md shadow-stone-200/60">
              <span className="typing-dot h-2.5 w-2.5 rounded-full bg-stone-400" />
              <span className="typing-dot h-2.5 w-2.5 rounded-full bg-stone-400" style={{ animationDelay: '.15s' }} />
              <span className="typing-dot h-2.5 w-2.5 rounded-full bg-stone-400" style={{ animationDelay: '.3s' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* ===== 底部：状态提示 + 超大麦克风按钮 + 文字兜底 ===== */}
      <footer className="shrink-0 border-t border-orange-100 bg-[#fff7ec] px-4 pb-6 pt-2">
        <StatusBar stage={stage} interim={interim} />
        <MicButton stage={stage} onClick={onMic} />

        <button
          onClick={() => setShowText((v) => !v)}
          className="mt-3 h-12 w-full text-lg text-stone-400 underline decoration-stone-300 underline-offset-[6px]"
        >
          ⌨️ 不方便说话？点这里打字
        </button>
        {showText && (
          <div className="bubble-in mt-2 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendTyped()}
              placeholder="想说的话，打在这里"
              className="h-14 min-w-0 flex-1 rounded-2xl border-2 border-orange-200 bg-white px-4 text-xl placeholder:text-stone-400 focus:border-orange-400 focus:outline-none"
            />
            <button
              onClick={sendTyped}
              className="h-14 rounded-2xl bg-orange-500 px-6 text-xl font-bold text-white transition active:scale-95"
            >
              发送
            </button>
          </div>
        )}
      </footer>

      <Toast text={notice} />
      <CallFamilyModal open={callOpen} onClose={() => setCallOpen(false)} />
    </div>
  )
}
