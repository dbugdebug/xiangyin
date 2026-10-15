/** 顶部轻提示（Toast）：语音没听清、需要麦克风权限等友好反馈 */
export default function Toast({ text }: { text: string }) {
  if (!text) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="toast-in max-w-full rounded-full bg-stone-900/85 px-6 py-3 text-center text-lg text-white shadow-xl">
        {text}
      </div>
    </div>
  )
}
