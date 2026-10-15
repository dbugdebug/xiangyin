/**
 * 数据加载异常时的友好占位提示（不白屏、不报错，可一键重试）。
 * 说明：本原型为纯前端 Demo，数据来自本地演示数据层（lib/demoStore.ts），
 * 正常情况不会走到这里；此组件用于兜底任何意外错误，保证路演现场不白屏。
 */
export default function BackendNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto mt-12 max-w-md rounded-3xl border-2 border-dashed border-orange-300 bg-orange-50 p-8 text-center">
      <p className="text-4xl">🌾</p>
      <p className="mt-3 text-xl font-bold text-stone-700">数据暂时没加载出来</p>
      <p className="mt-2 text-base leading-relaxed text-stone-500">
        页面数据来自本地演示数据，请点下方按钮重新加载；若仍不行，刷新一下页面即可恢复。
      </p>
      <button
        onClick={onRetry}
        className="mt-5 h-12 rounded-full bg-orange-500 px-8 text-lg font-bold text-white transition active:scale-95"
      >
        重新加载
      </button>
    </div>
  )
}
