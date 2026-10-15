/**
 * 语音识别 hook：封装浏览器 Web Speech API（SpeechRecognition）。
 * - lang 设为 zh-CN，识别方言口音的普通话
 * - listen() 返回 Promise：说完了 resolve 最终文本；没听清 resolve null；出错 reject
 * - stop() 用于"再点一下 = 说完了"的手动结束
 */
import { useCallback, useRef, useState } from 'react'

interface Options {
  /** 实时回调：识别过程中的临时文本（用于"正在聆听"时实时显示） */
  onInterim?: (text: string) => void
}

export function useSpeechRecognition({ onInterim }: Options = {}) {
  const supported =
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition)

  const onInterimRef = useRef(onInterim)
  onInterimRef.current = onInterim
  const stopRef = useRef<() => void>(() => {})

  const listen = useCallback((): Promise<string | null> => {
    return new Promise((resolve, reject) => {
      const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
      if (!SR) {
        reject(new Error('unsupported'))
        return
      }
      const rec = new SR()
      rec.lang = 'zh-CN'
      rec.continuous = false
      rec.interimResults = true
      rec.maxAlternatives = 1

      let finalText = ''

      rec.onresult = (e) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        onInterimRef.current?.(finalText + interim)
      }

      rec.onerror = (e) => {
        stopRef.current = () => {}
        reject(new Error(e.error))
      }
      rec.onend = () => {
        stopRef.current = () => {}
        resolve(finalText.trim() || null)
      }

      stopRef.current = () => {
        try {
          rec.stop()
        } catch {
          /* noop */
        }
      }
      try {
        rec.start()
      } catch (err) {
        reject(err as Error)
      }
    })
  }, [])

  const stop = useCallback(() => stopRef.current(), [])

  return { supported, listen, stop }
}
