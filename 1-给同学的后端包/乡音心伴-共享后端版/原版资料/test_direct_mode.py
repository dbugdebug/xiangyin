# -*- coding: utf-8 -*-
"""test_direct_mode.py - 前端直连大模型模式的后端专项测试

模拟前端 Chat.tsx 的真实调用序列（前端直连大模型，后端只接收上报）：
  ① POST /api/activity { elder_id, rounds }                    （现有行为，向后兼容）
  ② POST /api/activity { elder_id, rounds, user_message, ai_reply }（扩展：对话落库）
  ③ POST /api/risk-report { elder_id, keyword, summary }        （风险上报）
  ④ GET  /api/summaries / /api/elders/:id 验证数据闭环
"""
import requests
import json

BASE = "http://localhost:5000"
PASS, FAIL = 0, 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}  {detail}")


print("=" * 60)
print("场景一：旧版调用（只传 rounds）——向后兼容不破坏")
r = requests.post(f"{BASE}/api/activity", json={"elder_id": 1, "rounds": 1}).json()
check("activity 旧格式返回 ok", r.get("ok") is True, str(r))

print()
print("场景二：直连模式带对话原文上报（多轮，模拟一次真实陪伴）")
conversations = [
    ("今天早上遛弯看到小狗了，真开心", "那一定很开心呢！小狗最通人性了。"),
    ("中午儿子打电话来了，聊了好久", "跟儿子聊了这么久，您心里一定暖暖的吧。"),
    ("就是晚上一个人有点冷清", "晚上一个人是容易觉得闷，我陪您多聊会儿。"),
]
for user_text, ai_text in conversations:
    r = requests.post(f"{BASE}/api/activity", json={
        "elder_id": 1, "rounds": 1,
        "user_message": user_text, "ai_reply": ai_text,
    }).json()
    check(f"上报『{user_text[:8]}…』", r.get("ok") is True and "emotion" in r, str(r))

print()
print("场景三：危险表达 → 风险上报（前端 risk-report 实际字段）")
r = requests.post(f"{BASE}/api/risk-report", json={
    "elder_id": 1, "keyword": "轻生念头", "summary": "老人表达活着没意思",
}).json()
check("risk-report 返回 ok + alert_id", r.get("ok") is True and r.get("alert_id"), str(r))

print()
print("场景四：数据闭环验证（对话存档 → 摘要/详情可见）")
summaries = requests.get(f"{BASE}/api/summaries", params={"elder_id": 1}).json()
today_s = [s for s in summaries if s["time"].startswith("2026-10-12")] if summaries else []
check("今日对话已入 summaries", len(summaries) > 0, f"共{len(summaries)}天")
if today_s:
    turns = today_s[0]["turns"]
    check("气泡回放包含上报的对话原文",
          any("小狗" in t["text"] for t in turns), json.dumps(turns, ensure_ascii=False)[:200])

detail = requests.get(f"{BASE}/api/elders/1").json()
today_stat = [d for d in detail["daily_stats"] if d["date"] == "2026-10-12"]
check("elders/1 今日轮次已累计(4轮)", today_stat and today_stat[0]["rounds"] >= 4,
      json.dumps(today_stat, ensure_ascii=False)[:200])
check("老人风险已置红(risk-report联动)", detail["elder"]["risk_level"] == "red",
      detail["elder"]["risk_level"])

stats = requests.get(f"{BASE}/api/stats").json()
check("stats 待处理预警已增加", stats.get("pending_alerts", 0) >= 1, str(stats))

print()
print("场景五：AI 每日总结（基于直连模式落库的对话）")
r = requests.post(f"{BASE}/api/summary/generate", json={"elder_id": 1}).json()
check("summary/generate 成功", r.get("ok") is True and r.get("summary"), str(r))
print(f"  → AI总结: {r.get('summary', '')[:60]}")

print()
print("=" * 60)
print(f"结果: {PASS} 通过, {FAIL} 失败")
exit(0 if FAIL == 0 else 1)
