import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 开发服务器配置
 * - host: true 方便路演时用同一 WiFi 的手机直接访问电脑 IP 真机体验
 * - 本原型为 **纯前端 Demo**：三端数据全部来自本地演示数据层（src/lib/demoStore.ts），
 *   无需任何后端服务，因此不配置 /api 代理。
 * - base：仅构建时使用相对路径 './'，这样打包出的 dist 可以直接双击 index.html
 *   用浏览器打开（file:// 协议）即可预览，不需要装环境、不需要起服务器。
 * - remove-crossorigin 插件：Vite 默认会给 script/link 加 crossorigin 属性，
 *   在 file:// 协议下会导致浏览器拒绝加载资源；打包时移除该属性，确保双击即用。
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'remove-crossorigin',
      enforce: 'post',
      transformIndexHtml(html) {
        return html.replaceAll(' crossorigin', '')
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
  },
}))
