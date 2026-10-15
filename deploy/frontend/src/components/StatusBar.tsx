import type { ReactNode } from 'react'
import type { Stage } from '../types'

interface Props {
  stage: Stage
  /** 聆听中的实时识别文本 */
  interim: string
}

/**
 * 环节状态提示条：把一轮对话拆成四个阶段，分别用不同的图标 + 文字 + 颜色提示，
 * 不把所有环节合并成一个"加载中"。
 * 聆听中 → 识别中 → 回复生成中 → 播放中
 */
export default function StatusBar({ stage, interim }: Props) {
  let content: ReactNode

  switch (stage) {
    case 'listening':
      content = (
        <div className="text-center">
          <p className="text-xl font-bold text-orange-600">🎤 正在聆听，请说…</p>
          {interim && <p className="mt-1 text-lg text-stone-500">" {interim} "</p>}
        </div>
      )
      break
    case 'recognizing':
      content = <p className="text-center text-xl font-bold text-amber-600">⏳ 正在识别您的话…</p>
      break
    case 'generating':
      content = (
        <p className="text-center text-xl font-bold text-amber-600">
          💭 乡音正在想怎么回您
          <span className="ml-1 inline-flex align-baseline">
            <span className="typing-dot">.</span>
            <span className="typing-dot" style={{ animationDelay: '.2s' }}>.</span>
            <span className="typing-dot" style={{ animationDelay: '.4s' }}>.</span>
          </span>
        </p>
      )
      break
    case 'speaking':
      content = <p className="text-center text-xl font-bold text-emerald-600">🔊 正在为您朗读，请听…</p>
      break
    default:
      content = (
        <p className="text-center text-lg text-stone-400">点下方大按钮，跟乡音说话</p>
      )
  }

  return <div className="flex min-h-[3.75rem] items-center justify-center">{content}</div>
}
