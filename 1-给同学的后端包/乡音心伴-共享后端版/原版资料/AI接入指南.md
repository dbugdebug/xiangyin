# 乡音心伴 · 大模型（AI）配置指南

> 本系统 AI 功能（老人聊天、情绪识别、每日总结）由**后端**统一调用大模型完成。
> 前端**不需要**配置任何 key——只要后端配好，前端聊天页面自动就是真实 AI 回复。

## 一、配置文件在哪

文件位置：`乡音心伴-后端/.env`（没有就把同目录的 `.env.example` 复制一份，改名为 `.env`）

用记事本打开，找到 AI 开头的三行，改成你自己的：

```ini
AI_BASE_URL=https://api.deepseek.com/v1
AI_API_KEY=sk-你自己的key
AI_MODEL=deepseek-chat
```

改完保存，重启服务（关掉黑窗口，重新双击 `start.bat`）。

## 二、各平台怎么填

### 1. DeepSeek（推荐，注册充值 10 元可用很久）
1. 打开 https://platform.deepseek.com 注册并充值
2. 左侧「API keys」→ 创建 key，复制
3. .env 填：
```ini
AI_BASE_URL=https://api.deepseek.com/v1
AI_API_KEY=sk-xxxxxxxxxxxxxxxx
AI_MODEL=deepseek-chat
```

### 2. ChatGPT 中转站（如 apidock.ai 等）
在中转站后台拿到 key 和接口地址后：
```ini
AI_BASE_URL=https://你的中转站地址/v1
AI_API_KEY=sk-xxxxxxxxxxxxxxxx
AI_MODEL=gpt-4o-mini     # 改成中转站支持的模型名
```

### 3. 豆包（火山方舟）
1. https://console.volcengine.com/ark 开通并创建 API Key
2. .env 填（推理接入点 ID 以 ep- 开头）：
```ini
AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AI_API_KEY=你的ARK API Key
AI_MODEL=ep-2024xxxxxx-xxxxx
```

### 4. Ollama（本机免费跑，无需联网和 key）
先 `ollama pull qwen2.5:7b`，然后：
```ini
AI_BASE_URL=http://localhost:11434/v1
AI_API_KEY=ollama
AI_MODEL=qwen2.5:7b
```

### 5. 其他任意 OpenAI 兼容接口
只要是"OpenAI 兼容"的接口（文档里写 /chat/completions），都可以用，改对应的三行即可，**代码零改动**。

## 三、怎么验证配置成功

浏览器打开：

```
http://localhost:5000/api/ai/status
```

看到 `"mode": "real"` 就是接通了；`"mode": "mock"` 表示没读到配置（检查 .env 是否在 `乡音心伴-后端` 目录下、有没有重启服务）。

再到老人端聊天页发一句"今天心情不太好"，回复不再是"温情演示回复"字样，即为真实 AI。

## 四、常见问题

| 现象 | 原因与解决 |
|---|---|
| 聊天显示"温情演示回复" | 未配置 key 或配置没生效，检查 .env 后重启 |
| `402 Insufficient Balance` | 账户余额不足，去对应平台充值 |
| `401 Unauthorized` | key 填错了，重新复制一遍（注意别带空格/引号） |
| 回复很慢 | 中转站或模型本身慢，属正常；系统有自动重试与降级，不会卡死页面 |
| 不配 key 能演示吗 | 能。AI 自动降级为本地演示模式，页面所有功能照常，只是聊天回复是预设文案 |
