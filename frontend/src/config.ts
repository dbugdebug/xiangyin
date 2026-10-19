/**
 * 大模型接口配置
 * ================================================================
 * 设计目标：**零配置也能路演，配了就用真模型**。
 * - 默认指向本地 Ollama 的 OpenAI 兼容接口（http://localhost:11434/v1）；
 * - chat() 会先用极短超时（PROBE_TIMEOUT）探测一次模型服务是否存在：
 *     · 探测到（如本地 Ollama 已启动）→ 走真实大模型；
 *     · 探测不到（路演现场没装模型 / 没网）→ 秒级降级为本地 mock 温情回复，绝不卡住、不白屏。
 * - 也可通过项目根目录 .env 接入 DeepSeek / 硅基流动 SiliconFlow 等任意 OpenAI 兼容服务。
 */

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  'http://localhost:11434/v1'

export const API_MODEL =
  (import.meta.env.VITE_API_MODEL as string | undefined)?.trim() || 'qwen2.5:7b'

export const API_KEY =
  (import.meta.env.VITE_API_KEY as string | undefined)?.trim() || ''

/**
 * Hosted Worker API root. This is separate from API_BASE_URL, which is the optional LLM endpoint.
 *
 * 交付说明：本交付包定位为**纯前端离线演示**（双击 index.html 即可完整演示三端），
 * 因此这里**默认为空**（isWorkerConfigured() = false → 全部走本地演示数据层 demoStore）。
 * 若日后需要接真实后端，在项目根目录 .env 里配 VITE_WORKER_API_URL 即可，无需改代码。
 */
export const VITE_WORKER_API_URL =
  (import.meta.env.VITE_WORKER_API_URL as string | undefined)?.trim() || ''

/** 关闭大模型直连（VITE_LLM_ENABLED=0），只用本地 mock 回复 */
export const LLM_ENABLED = (import.meta.env.VITE_LLM_ENABLED as string | undefined) !== '0'

/** 探测模型服务是否在线的超时（毫秒）。探测不到就直接用 mock，避免路演时干等 */
export const PROBE_TIMEOUT = 1500

/** 真实对话请求超时（毫秒）：本地模型首次加载权重可能较慢，给足时间 */
export const REQUEST_TIMEOUT = 20000

/** 「乡音」人设：温柔、耐心、说大白话的乡村陪伴伙伴（绝不做医学诊断） */
export const SYSTEM_PROMPT = `你是「乡音」，一位温柔、耐心、说大白话的乡村 AI 陪伴伙伴，正在陪一位农村老人唠家常。
请遵守：
1. 说话像邻家晚辈一样亲切自然，多用短句（每次回复 1~3 句，总共不超过 60 个字，适合朗读）。
2. 多共情、多主动关心老人的身体、吃饭、睡眠和心情，适当主动提问，别让话题冷场。
3. 老人可能说方言，你要尽量听懂，用平实温暖的话回应，可以带一点乡土气息。
4. 如果老人提到身体不舒服或心情低落：先温柔关心安抚，建议他跟家人说一说、必要时去卫生院看看；你绝不给出任何医学诊断，也绝不推荐药物。
5. 如果老人流露强烈的悲伤或危险念头，要温柔地告诉他"您很重要"，家人很在乎他、很快会来看他，并耐心陪他多说说话。
6. 只有当老人的话里出现明显消极、绝望或危险信号（如"不想活""活着没意思""想不开"）时，才在回复最前面加上【风险预警】四个字作为标记（其余内容照常温柔回应），系统用它提醒家属与村协管员；没有风险时绝不要加这个标记。`
