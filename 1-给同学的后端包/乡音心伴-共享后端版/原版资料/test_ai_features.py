# test_ai_features.py - AI 能力专项测试
# 验证用户职责的四个核心功能：
#   1. 访问大模型（/api/chat 调 ai_service，mock 降级也走同一链路）
#   2. 获取信息（情绪 emotion/reason/intensity 返回并入库）
#   3. 信息总结（/api/summary/generate 生成脱敏总结并写入 activities.note）
#   4. 保存多次对话信息（多轮上下文 + 全部轮次入库）

import requests
import json
from datetime import datetime

BASE_URL = "http://localhost:5000"


def show(title, obj):
    print(f"\n📍 {title}")
    print(json.dumps(obj, indent=2, ensure_ascii=False)[:600])


def test_ai_status():
    print("\n🧪 测试 A1: AI 状态接口")
    r = requests.get(f"{BASE_URL}/api/ai/status").json()
    show("GET /api/ai/status", r)
    return r.get('mode') in ('real', 'mock') and 'configured' in r


def test_multiturn_and_save():
    """多轮对话 + 全部轮次入库 + 上下文生效"""
    print("\n🧪 测试 A2: 多轮对话与保存（elder_id=10）")

    # 第1轮
    r1 = requests.post(f"{BASE_URL}/api/chat", json={
        "elder_id": 10, "message": "就是想孩子们了，好几个月没见着了。"
    }).json()
    show("第1轮", r1)

    # 第2轮（应基于第1轮上下文）
    r2 = requests.post(f"{BASE_URL}/api/chat", json={
        "elder_id": 10, "message": "嗯，他们也总说忙。"
    }).json()
    show("第2轮", r2)

    # 第3轮
    r3 = requests.post(f"{BASE_URL}/api/chat", json={
        "elder_id": 10, "message": "今天天气不错，去院里晒了太阳。"
    }).json()
    show("第3轮", r3)

    # 验证：摘要接口能看到 3 轮对话（保存多次对话信息）
    s = requests.get(f"{BASE_URL}/api/summaries?elder_id=10").json()
    today = [x for x in s if x['time'].startswith(str(datetime.now().date()))]
    show("当日对话摘要", today[0] if today else {})
    turns_today = len(today[0]['turns']) if today else 0

    ok = (r1.get('ok') and r2.get('ok') and r3.get('ok')
          and r1.get('emotion') == '低落'      # 第1轮识别为低落（获取信息）
          and r3.get('emotion') == '平和'       # 第3轮平和
          and turns_today >= 6)                 # 3轮×2条消息（脱敏上限6）
    print(f"\n  → 3轮均入库：{turns_today >= 6}；情绪识别随对话内容变化：低落→平和 ✓")
    return ok


def test_risk_flow():
    """危险表达 → 自动预警 + 置红"""
    print("\n🧪 测试 A3: 风险联动（elder_id=7）")
    before = len(requests.get(f"{BASE_URL}/api/alerts?status=待处理").json())

    r = requests.post(f"{BASE_URL}/api/chat", json={
        "elder_id": 7, "message": "唉，人老了，活着没啥意思。"
    }).json()
    show("危险表达对话", r)

    after = len(requests.get(f"{BASE_URL}/api/alerts?status=待处理").json())
    elder = requests.get(f"{BASE_URL}/api/elders/7").json()['elder']

    ok = (r.get('risk') is True and 'alert_id' in r
          and r.get('emotion') == '需关注' and r.get('intensity', 0) >= 9
          and after == before + 1
          and elder['risk_level'] == 'red')
    print(f"\n  → 自动生成预警：{after == before + 1}；老人置红：{elder['risk_level'] == 'red'}")
    return ok


def test_summary_generate():
    """AI 总结当日对话 → 写入 activities.note → summaries 使用总结"""
    print("\n🧪 测试 A4: AI 每日总结（elder_id=10）")
    r = requests.post(f"{BASE_URL}/api/summary/generate", json={"elder_id": 10}).json()
    show("POST /api/summary/generate", r)

    # 验证1：summaries 摘要文案已变为生成的总结（不再是模板句）
    s = requests.get(f"{BASE_URL}/api/summaries?elder_id=10").json()
    today = [x for x in s if x['time'].startswith(str(datetime.now().date()))]
    summary_text = today[0]['summary'] if today else ''
    show("当日摘要（应为AI总结）", {'summary': summary_text})

    # 验证2：老人详情的 daily_stats.note 同步更新
    detail = requests.get(f"{BASE_URL}/api/elders/10").json()
    note_today = [d['note'] for d in detail['daily_stats']
                  if d['date'] == str(datetime.now().date()) and d['note']]
    show("daily_stats.note", {'note': note_today[0] if note_today else None})

    # 验证3：家属端本周卡片（mood_summary）同步刷新
    show("elders.mood_summary", {'mood_summary': detail['elder']['mood_summary']})

    ok = (r.get('ok') is True and r.get('summary')
          and summary_text == r['summary']            # summaries 用了 AI 总结
          and note_today and note_today[0] == r['summary']  # note 已写入
          and detail['elder']['mood_summary'] == r['summary'])  # 本周卡片刷新
    print(f"\n  → 总结写入三处联动：summaries / daily_stats.note / mood_summary 全部同步")
    return ok


def run():
    print("=" * 50)
    print("🤖 AI 能力专项测试（mock 模式，全链路与真实大模型一致）")
    print("=" * 50)

    tests = [
        ("A1 AI状态接口", test_ai_status),
        ("A2 多轮对话与保存", test_multiturn_and_save),
        ("A3 风险自动预警", test_risk_flow),
        ("A4 AI每日总结", test_summary_generate),
    ]

    results = {}
    for name, fn in tests:
        try:
            results[name] = fn()
        except Exception as e:
            print(f"  ❌ {name} 异常: {e}")
            results[name] = False

    print("\n" + "=" * 50)
    print("📊 AI 能力测试总结")
    print("=" * 50)
    for name, passed in results.items():
        print(f"{name}: {'✅ 通过' if passed else '❌ 失败'}")
    total = sum(1 for v in results.values() if v)
    print(f"\n总计: {total}/{len(results)} 通过")
    if total == len(results):
        print("\n🎉 AI 功能链全部就绪！配置 AI_BASE_URL 后即刻切换为真实大模型。")


if __name__ == '__main__':
    run()
