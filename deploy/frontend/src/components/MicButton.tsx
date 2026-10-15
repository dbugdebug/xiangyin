import type { Stage } from '../types'

/** 按钮下方的大字提示，每个阶段不同 */
const LABELS: Record<Stage, string> = {
  idle: '点击说话',
  listening: '正在聆听，说完再点一下',
  recognizing: '正在识别您的话…',
  generating: '乡音正在想…',
  speaking: '正在为您朗读…',
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-14 w-14" aria-hidden>
      <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5.5A3.5 3.5 0 0 0 12 15z" />
      <path d="M18.5 11.5a.9.9 0 1 0-1.8 0 4.7 4.7 0 0 1-9.4 0 .9.9 0 1 0-1.8 0 6.5 6.5 0 0 0 5.6 6.43V21H9.4a.9.9 0 1 0 0 1.8h5.2a.9.9 0 1 0 0-1.8h-1.7v-3.07a6.5 6.5 0 0 0 5.6-6.43z" />
    </svg>
  )
}

/**
 * 超大圆形语音主按钮（占屏幕宽度近一半，触控目标远超 48px）：
 * - 空闲：暖橙渐变
 * - 聆听中：呼吸 + 双层波纹动画，颜色转红提醒"正在录音"
 * - 其余环节：置灰 + 转圈，防止误触
 */
export default function MicButton({ stage, onClick }: { stage: Stage; onClick: () => void }) {
  const listening = stage === 'listening'
  const busy = stage === 'recognizing' || stage === 'generating' || stage === 'speaking'

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex items-center justify-center">
        {listening && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="animate-ripple absolute h-32 w-32 rounded-full bg-orange-400/30" />
            <span
              className="animate-ripple absolute h-32 w-32 rounded-full bg-orange-400/25"
              style={{ animationDelay: '.6s' }}
            />
          </div>
        )}
        <button
          type="button"
          aria-label={LABELS[stage]}
          onClick={onClick}
          className={`relative flex h-32 w-32 items-center justify-center rounded-full text-white transition-all duration-200
            ${listening
              ? 'animate-breathe bg-gradient-to-br from-rose-500 to-orange-500 shadow-xl shadow-rose-400/40'
              : busy
                ? 'bg-stone-300 shadow-lg shadow-stone-300/40'
                : 'bg-gradient-to-br from-orange-500 to-amber-500 shadow-xl shadow-orange-500/40 active:scale-95'}`}
        >
          {busy ? (
            <svg className="h-14 w-14 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle
                cx="12"
                cy="12"
                r="9.5"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="42 20"
              />
            </svg>
          ) : (
            <MicIcon />
          )}
        </button>
      </div>
      <p
        className={`mt-2 text-xl font-semibold ${listening ? 'text-orange-600' : busy ? 'text-stone-400' : 'text-stone-500'}`}
      >
        {LABELS[stage]}
      </p>
    </div>
  )
}
