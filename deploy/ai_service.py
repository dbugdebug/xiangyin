# ai_service.py - 乡音心伴 AI 服务模块
# =====================================================================
# 职责（对应用户的分工）：
#   1. 访问大模型：OpenAI 兼容接口（豆包/DeepSeek/Ollama/硅基流动均可）
#   2. 获取信息：从回复中解析情绪（emotion/reason/intensity）与风险标记
#   3. 信息总结：summarize_day() 生成当日对话的一句话脱敏总结
#   4. 多轮对话：chat() 接受完整对话历史，模型带上下文回复
#
# 设计原则（对齐前端 chat.ts 的降级策略）：
#   - 配置了 AI_BASE_URL 且服务在线 → 走真实大模型
#   - 未配置 / 服务不在线 / 调用失败 → 降级为本地 mock（规则匹配），
#     绝不抛错、绝不阻塞演示。
#   - 限流(429)/超时自动指数退避重试（来自 07_AI集成完整指南.md）
#
# .env 配置示例：
#   AI_BASE_URL=https://api.doubao.com/v1     # 或 http://localhost:11434/v1 (Ollama)
#   AI_API_KEY=sk-xxx
#   AI_MODEL=doubao-pro                        # 或 qwen2.5:7b / deepseek-chat
#   （兼容旧变量名 DOUYIN_API_KEY / DOUYIN_API_ENDPOINT / DOUYIN_MODEL）

import json
import os
import re
import time
import logging
from datetime import datetime

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ==================== 配置 ====================

AI_BASE_URL = (
    os.getenv('AI_BASE_URL')
    or os.getenv('DOUYIN_API_ENDPOINT', '').replace('/chat/completions', '')
    or ''  # 留空 = mock 模式
).rstrip('/')

AI_API_KEY = os.getenv('AI_API_KEY') or os.getenv('DOUYIN_API_KEY') or ''
AI_MODEL = os.getenv('AI_MODEL') or os.getenv('DOUYIN_MODEL', '')
AI_TIMEOUT = int(os.getenv('AI_TIMEOUT', 20))
AI_MAX_RETRIES = int(os.getenv('AI_MAX_RETRIES', 2))

# 支持的情绪类型（与前端演示数据口径一致：平和/开心/低落/需关注 为主）
EMOTIONS = ['开心', '平和', '低落', '焦虑', '愤怒', '孤独', '恐惧', '无助', '需关注']

# ==================== System Prompt（人设对齐前端 config.ts） ====================

SYSTEM_PROMPT_CHAT = """你是「乡音」，一位温柔、耐心、说大白话的乡村 AI 陪伴伙伴，正在陪一位农村老人唠家常。
请遵守：
1. 说话像邻家晚辈一样亲切自然，多用短句（每次回复 1~3 句，总共不超过 60 个字，适合朗读）。
2. 多共情、多主动关心老人的身体、吃饭、睡眠和心情，适当主动提问，别让话题冷场。
3. 老人可能说方言，你要尽量听懂，用平实温暖的话回应，可以带一点乡土气息。
4. 如果老人提到身体不舒服或心情低落：先温柔关心安抚，建议他跟家人说一说、必要时去卫生院看看；你绝不给出任何医学诊断，也绝不推荐药物。
5. 如果老人流露强烈的悲伤或危险念头，要温柔地告诉他"您很重要"，家人很在乎他、很快会来看他，并耐心陪他多说说话。
6. 只有当老人的话里出现明显消极、绝望或危险信号（如"不想活""活着没意思""想不开"）时，才在回复最前面加上【风险预警】四个字作为标记（其余内容照常温柔回应）；没有风险时绝不要加这个标记。
7. 【输出格式】先输出给老人看的自然回复，然后另起一行，输出一个 JSON 对象（这行是给系统看的，不会展示给老人）：
{"emotion": "情绪词", "reason": "简短原因", "intensity": 1到10的整数}
情绪词只能是：开心、平和、低落、焦虑、愤怒、孤独、恐惧、无助、需关注。
其中"需关注"仅在出现危险/绝望信号时使用。"""

SYSTEM_PROMPT_SUMMARY = """你是一个对话摘要助手。给你一位老人当天与 AI 陪伴助手的对话记录，
请生成一句话的脱敏摘要（不超过 50 个字），描述老人今天的主要情绪和聊到的话题。
要求：
- 不逐字复述对话，只概括情绪与话题
- 语气客观、温暖
- 如对话中出现危险信号，摘要中要体现"情绪明显低落/需关注"
直接输出摘要文字，不要任何前缀、引号或解释。

示例：
输入：
老人：哎，昨晚又没咋睡着，心里闷得慌。
AI：睡不着可遭罪了。晚上用热水泡泡脚，别琢磨烦心事儿。
老人：就是想孩子们了，好几个月没见着了。
AI：想他们了就打个电话。要不，咱现在就给他们捎个话儿？
输出：睡得不太好，心里发闷，反复念叨想念在外地的孩子们。"""


# ==================== 本地 Mock 降级实现 ====================

MOCK_RISK_WORDS = ['不想活', '活着没意思', '没啥意思', '想不开', '不想活了', '没盼头']
MOCK_LOW_WORDS = ['伤心', '难过', '哭', '烦', '想孩子', '想念', '一个人']
MOCK_ANX_WORDS = ['睡不着', '失眠', '焦虑', '担心', '心里闷', '发慌']
MOCK_GOOD_WORDS = ['开心', '高兴', '快乐', '小狗', '孙子', '孙女', '考了']


def mock_chat(history, language='zh-CN'):
    """本地 mock：基于最后一条用户消息做关键词匹配（规则与前端 mock 一致量级）"""
    last_user = next((m['content'] for m in reversed(history) if m['role'] == 'user'), '')
    # 多轮上下文的 mock：如果上一轮 AI 提过"捎话/打电话"，本轮顺着接
    follow_up = any('捎个话' in m['content'] or '打个电话' in m['content']
                    for m in history if m['role'] == 'assistant')

    if any(w in last_user for w in MOCK_RISK_WORDS):
        return {
            'reply': '哎，您可千万别这么想！您的平安比啥都金贵，家里人可离不开您。',
            'emotion': '需关注', 'reason': '出现危险信号表达', 'intensity': 10,
            'risk': True, 'offline': True,
        }
    if any(w in last_user for w in MOCK_ANX_WORDS):
        return {
            'reply': '睡不着可遭罪了。晚上用热水泡泡脚，别琢磨烦心事儿。',
            'emotion': '低落', 'reason': '提到睡眠或担忧问题', 'intensity': 7,
            'risk': False, 'offline': True,
        }
    if any(w in last_user for w in MOCK_LOW_WORDS):
        reply = '想他们了就打个电话。要不，咱现在就给他们捎个话儿？' if follow_up \
            else '我能理解你的感受。要不要和我多聊聊呢？'
        return {
            'reply': reply,
            'emotion': '低落', 'reason': '提到消极或孤单的事物', 'intensity': 7,
            'risk': False, 'offline': True,
        }
    if any(w in last_user for w in MOCK_GOOD_WORDS):
        return {
            'reply': '那一定很开心呢！希望你每天都有好心情。',
            'emotion': '开心', 'reason': '提到积极的事物', 'intensity': 8,
            'risk': False, 'offline': True,
        }
    return {
        'reply': '好的，我听着呢。继续跟我唠唠吧。',
        'emotion': '平和', 'reason': '日常对话', 'intensity': 5,
        'risk': False, 'offline': True,
    }


def mock_summarize(turns):
    """本地 mock 摘要：按情绪与话题关键词拼一句"""
    user_texts = [t['content'] for t in turns if t['role'] == 'user']
    if not user_texts:
        return '当天暂无对话记录。'
    joined = ' '.join(user_texts)
    if any(w in joined for w in MOCK_RISK_WORDS):
        return '情绪明显低落，出现消极表达，已触发高风险预警。'
    if any(w in joined for w in MOCK_ANX_WORDS):
        return '提到睡眠不好、心里发闷，情绪偏低。'
    if any(w in joined for w in MOCK_LOW_WORDS):
        return '提到想念家人、一个人孤单，情绪偏低落。'
    if any(w in joined for w in MOCK_GOOD_WORDS):
        return '聊到家里的开心事，情绪不错，笑声挺多。'
    return f'共进行{len(user_texts)}轮日常聊天，情绪整体平稳。'


# ==================== AI 服务主体 ====================

class XiangyinAIService:
    """乡音 AI 服务：对话 + 情绪识别 + 每日总结（OpenAI 兼容接口）"""

    def __init__(self, base_url=None, api_key=None, model=None):
        self.base_url = (base_url or AI_BASE_URL).rstrip('/')
        self.api_key = api_key or AI_API_KEY
        self.model = model or AI_MODEL
        self.timeout = AI_TIMEOUT
        self.max_retries = AI_MAX_RETRIES
        # 服务在线探测结果缓存（对齐前端 probeLLM 的做法）
        self._available = None

    # ---------- 配置与探测 ----------

    def is_configured(self):
        """是否配置了大模型服务"""
        return bool(self.base_url and self.model)

    def available(self):
        """探测服务是否在线（结果缓存，失败后本进程内不再重试探测）
        兼容各类 OpenAI 兼容服务（含中转站）：
        - GET /models 成功 → 在线
        - /models 返回 404/405（不少中转站不开放模型列表）→ 改用极小对话请求探测
        - 401/403 → key 无效，直接判离线
        """
        if not self.is_configured():
            return False
        if self._available is not None:
            return self._available
        try:
            r = requests.get(
                f'{self.base_url}/models',
                headers=self._headers(),
                timeout=5,
            )
            if r.ok:
                self._available = True
            elif r.status_code in (401, 403):
                self._available = False
            else:
                # 中转站可能不支持 /models，用一次极小请求实测
                self._available = self._probe_by_chat()
        except Exception:
            # 网络异常时也尝试用对话接口探测（有些网关只开放 chat 路径）
            self._available = self._probe_by_chat()
        if not self._available:
            logger.warning('大模型服务不可达（%s），本次会话将使用本地 mock', self.base_url)
        return self._available

    def _probe_by_chat(self):
        """用一次 max_tokens=1 的极小对话请求探测服务可用性（兼容不开放 /models 的中转站）"""
        try:
            payload = {
                'model': self.model,
                'messages': [{'role': 'user', 'content': 'hi'}],
                'max_tokens': 1,
            }
            r = requests.post(
                f'{self.base_url}/chat/completions',
                headers=self._headers(),
                json=payload,
                timeout=10,
            )
            return r.ok
        except Exception:
            return False

    def _headers(self):
        h = {'Content-Type': 'application/json'}
        if self.api_key:
            h['Authorization'] = f'Bearer {self.api_key}'
        return h

    # ---------- 对话（多轮上下文 + 情绪识别 + 风险标记） ----------

    def chat(self, history, language='zh-CN'):
        """
        多轮对话。history: [{'role': 'user'|'assistant', 'content': str}, ...]
        返回 { reply, emotion, reason, intensity, risk, offline }
        """
        if not self.available():
            return mock_chat(history, language)

        messages = [
            {'role': 'system', 'content': SYSTEM_PROMPT_CHAT},
            # 只带最近 10 轮，防止超出上下文（与前端 chat.ts 一致）
            *history[-10:],
        ]
        try:
            content = self._request_chat_completion(messages, temperature=0.8, max_tokens=300)
            return self._parse_chat_reply(content)
        except Exception as e:
            logger.warning('大模型调用失败，降级为本地 mock：%s', e)
            self._available = False  # 本进程内不再重试
            result = mock_chat(history, language)
            result['error'] = str(e)
            return result

    # ---------- 每日总结 ----------

    def summarize_day(self, turns, elder_name='老人'):
        """
        当日对话总结（脱敏）。turns: [{'role': 'user'|'assistant', 'content': str}, ...]
        返回 (summary_text, offline)
        """
        if not turns:
            return '当天暂无对话记录。', True
        if not self.available():
            return mock_summarize(turns), True

        transcript = '\n'.join(
            f"{'老人' if t['role'] == 'user' else 'AI'}：{t['content']}" for t in turns
        )
        messages = [
            {'role': 'system', 'content': SYSTEM_PROMPT_SUMMARY},
            {'role': 'user', 'content': transcript},
        ]
        try:
            content = self._request_chat_completion(messages, temperature=0.3, max_tokens=100)
            # 去掉可能的引号与换行
            summary = content.strip().strip('"“”').split('\n')[0].strip()
            return (summary or mock_summarize(turns)), False
        except Exception as e:
            logger.warning('总结生成失败，降级为本地规则摘要：%s', e)
            self._available = False
            return mock_summarize(turns), True

    # ---------- 底层请求（带重试 + 指数退避） ----------

    def _request_chat_completion(self, messages, temperature=0.7, max_tokens=300):
        payload = {
            'model': self.model,
            'messages': messages,
            'temperature': temperature,
            'max_tokens': max_tokens,
            'stream': False,
        }
        url = f'{self.base_url}/chat/completions'
        last_err = None
        for attempt in range(self.max_retries + 1):
            try:
                r = requests.post(url, json=payload, headers=self._headers(), timeout=self.timeout)
                if r.status_code == 200:
                    data = r.json()
                    content = data['choices'][0]['message']['content']
                    if not content or not content.strip():
                        raise ValueError('空回复')
                    return content.strip()
                if r.status_code == 429:  # 限流：指数退避
                    wait = 2 ** attempt
                    logger.warning('限流(429)，等待 %ss 后重试', wait)
                    time.sleep(wait)
                    last_err = f'HTTP 429'
                    continue
                last_err = f'HTTP {r.status_code}: {r.text[:120]}'
                if attempt < self.max_retries:
                    time.sleep(2 ** attempt)
                    continue
                break
            except (requests.Timeout, requests.ConnectionError) as e:
                last_err = str(e)
                if attempt < self.max_retries:
                    time.sleep(2 ** attempt)
                    continue
                break
        raise Exception(f'大模型请求失败: {last_err}')

    # ---------- 回复解析 ----------

    @staticmethod
    def _parse_chat_reply(content):
        """
        解析模型输出：自然回复 + 末行 JSON 情绪数据（+ 可能的【风险预警】标记）。
        容错：JSON 不在最后一行时，全文搜索第一个 {...}；仍失败则默认平和。
        """
        risk = '【风险预警】' in content
        content = content.replace('【风险预警】', '').strip()

        reply, emotion, reason, intensity = content, '平和', '日常对话', 5

        # 尝试解析末行 JSON
        lines = content.split('\n')
        candidates = [lines[-1].strip()]
        # 末行不是 JSON 时，全文搜索（取最后一个匹配，通常在回复之后）
        candidates += [m.group(0) for m in re.finditer(r'\{[^{}]*\}', content, re.S)]
        for cand in candidates:
            try:
                obj = json.loads(cand)
                if 'emotion' in obj:
                    emotion = str(obj.get('emotion', '平和'))
                    reason = str(obj.get('reason', '')) or '未说明原因'
                    try:
                        intensity = int(float(obj.get('intensity', 5)))
                    except (TypeError, ValueError):
                        intensity = 5
                    intensity = max(1, min(10, intensity))
                    # 从回复文本中去掉 JSON 部分（兼容末行独立 / 与正文同行两种情况）
                    reply = content.replace(cand, '').strip()
                    break
            except (json.JSONDecodeError, ValueError):
                continue

        # 情绪词不在白名单 → 归并为最接近的档位
        if emotion not in EMOTIONS:
            emotion = '需关注' if risk else ('低落' if intensity >= 6 else '平和')

        # 风险联动：危险信号时保证情绪与强度
        if risk:
            emotion = '需关注'
            intensity = max(intensity, 9)

        # 需关注必然视为风险
        if emotion == '需关注':
            risk = True

        return {
            'reply': reply[:120] or '我听着呢，您接着说。',
            'emotion': emotion,
            'reason': reason,
            'intensity': intensity,
            'risk': risk,
            'offline': False,
        }


# ==================== 模块级单例 ====================

ai_service = XiangyinAIService()


# ==================== 自测 ====================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    print('=' * 50)
    print('AI 服务自测')
    print('=' * 50)
    print(f'配置: base_url={ai_service.base_url or "(未配置→mock模式)"} model={ai_service.model or "-"}')

    # 1. 多轮对话（mock 或真实）
    history = [
        {'role': 'user', 'content': '哎，昨晚又没咋睡着，心里闷得慌。'},
        {'role': 'assistant', 'content': '睡不着可遭罪了。晚上用热水泡泡脚，别琢磨烦心事儿。'},
        {'role': 'user', 'content': '就是想孩子们了，好几个月没见着了。'},
    ]
    r = ai_service.chat(history)
    print(f'\n[chat] 回复: {r["reply"]}')
    print(f'[chat] 情绪: {r["emotion"]} / {r["intensity"]}/10 / 原因: {r["reason"]} / 风险: {r["risk"]} / 离线mock: {r["offline"]}')

    # 2. 危险信号
    r = ai_service.chat([{'role': 'user', 'content': '唉，人老了，活着没啥意思。'}])
    print(f'\n[chat-风险] 回复: {r["reply"]}')
    print(f'[chat-风险] 情绪: {r["emotion"]} / {r["intensity"]}/10 / 风险: {r["risk"]}')

    # 3. 每日总结
    turns = [
        {'role': 'user', 'content': '俺孙女这次考试又进步了！'},
        {'role': 'assistant', 'content': '哈哈，真是好孩子！您平时教得好啊。'},
        {'role': 'user', 'content': '今天还去菜园子转了一圈。'},
    ]
    summary, offline = ai_service.summarize_day(turns)
    print(f'\n[summary] {"(mock)" if offline else "(AI)"} {summary}')

    # 4. 回复解析容错测试
    cases = [
        '那一定很开心呢！\n{"emotion": "开心", "reason": "看到小狗", "intensity": 8}',
        '【风险预警】您很重要，家人都很在乎您。{"emotion": "无助", "reason": "绝望表达", "intensity": 9}',
        '普通回复没有JSON',  # 应默认平和
    ]
    for c in cases:
        p = XiangyinAIService._parse_chat_reply(c)
        print(f'\n[parse] {p["emotion"]}/{p["intensity"]} risk={p["risk"]} reply={p["reply"][:20]}')
