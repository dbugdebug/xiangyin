import type { ChatMsg } from '../types'

interface Props {
  msg: ChatMsg
  /** 该条消息当前是否正在朗读 */
  playing: boolean
  onTogglePlay: () => void
}

/**
 * 气泡式对话流：
 * - 老人消息居右（暖橙渐变），AI 回复居左（白色，带头像）
 * - AI 气泡下带"🔊 播放 / ⏹ 停止"按钮，支持重新播放
 * - offline 消息带"网络开小差 · 演示回复"小标签
 */
export default function ChatBubble({ msg, playing, onTogglePlay }: Props) {
  if (msg.from === 'user') {
    return (
      <div className="bubble-in flex justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-tr-md bg-gradient-to-br from-orange-500 to-amber-500 px-5 py-4 text-xl leading-relaxed text-white shadow-md shadow-orange-200">
          {msg.text}
        </div>
      </div>
    )
  }

  return (
    <div className="bubble-in flex items-start gap-2">
      {/* AI 头像 */}
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-400 text-xl shadow">
        🌾
      </div>
      <div className="max-w-[85%]">
        <div className="rounded-3xl rounded-tl-md bg-white px-5 py-4 text-xl leading-relaxed text-stone-700 shadow-md shadow-stone-200/60">
          {msg.text}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={onTogglePlay}
            className={`h-12 rounded-full border-2 px-5 text-lg font-bold transition active:scale-95
              ${playing
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-orange-300 bg-white text-orange-600'}`}
          >
            {playing ? '⏹ 停止' : '🔊 播放'}
          </button>
          {msg.offline && (
            <span className="inline-flex h-9 items-center rounded-full bg-amber-100 px-3 text-sm text-amber-700">
              📶 网络开小差 · 演示回复
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
