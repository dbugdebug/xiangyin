/** 产品 Logo：大圆图标 + 名称 + slogan */
export default function Logo() {
  return (
    <div className="mb-10 text-center">
      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-amber-400 to-yellow-300 shadow-lg shadow-orange-400/40">
        <span className="text-5xl">🌾</span>
      </div>
      <h1 className="mt-5 text-4xl font-bold tracking-widest text-stone-800">乡音心伴</h1>
      <p className="mt-2 text-lg text-stone-500">有人说话 · 有人关心 · 有人守护</p>
    </div>
  )
}
