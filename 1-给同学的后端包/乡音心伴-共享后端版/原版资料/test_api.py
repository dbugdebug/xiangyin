# test_api.py - API测试脚本（契约对齐版）
# 验证所有接口的响应格式与前端 API-CONTRACT.md 一致

import requests
import json
from datetime import datetime

BASE_URL = "http://localhost:5000"

# ==================== 测试工具函数 ====================

def print_result(title, response):
    """打印测试结果"""
    print(f"\n{'='*50}")
    print(f"📍 {title}")
    print(f"{'='*50}")
    try:
        data = response.json()
        print(json.dumps(data, indent=2, ensure_ascii=False)[:800])
    except Exception:
        print(response.text)
    print(f"Status Code: {response.status_code}")

# ==================== 测试用例 ====================

def test_stats():
    """测试 GET /api/stats（应返回裸 Stats 对象）"""
    print("\n🧪 测试 1: 全村统计")
    r = requests.get(f"{BASE_URL}/api/stats")
    print_result("GET /api/stats", r)
    d = r.json()
    ok = (r.status_code == 200 and isinstance(d, dict)
          and all(k in d for k in ('total', 'today_active', 'pending_alerts', 'weekly_new_risks', 'high_risk')))
    return ok

def test_screen_stats():
    """测试 GET /api/screen-stats（应返回裸 ScreenStat，byLevel 为 red/yellow/green）"""
    print("\n🧪 测试 2: 筛查统计")
    r = requests.get(f"{BASE_URL}/api/screen-stats")
    print_result("GET /api/screen-stats", r)
    d = r.json()
    ok = (r.status_code == 200 and isinstance(d, dict)
          and d.get('byLevel', {}).keys() >= {'red', 'yellow', 'green'}
          and 0 <= d.get('rate', -1) <= 1)
    return ok

def test_elders_list():
    """测试 GET /api/elders（应返回 Elder[]，风险降序，含全部契约字段）"""
    print("\n🧪 测试 3: 老人花名册")
    r = requests.get(f"{BASE_URL}/api/elders")
    print_result("GET /api/elders", r)
    d = r.json()
    if not (r.status_code == 200 and isinstance(d, list) and len(d) == 12):
        return False
    need = {'id', 'name', 'age', 'dialect', 'living', 'family_name', 'relation',
            'last_call', 'risk_level', 'last_active', 'mood', 'mood_summary',
            'screened', 'pending_count', 'days_inactive', 'today_active'}
    if not all(need <= set(e.keys()) for e in d):
        return False
    order = {'red': 0, 'yellow': 1, 'green': 2}
    levels = [order[e['risk_level']] for e in d]
    return levels == sorted(levels)

def test_elder_detail():
    """测试 GET /api/elders/:id（应返回 { elder, daily_stats }，近7天升序）"""
    print("\n🧪 测试 4: 老人详情")
    r = requests.get(f"{BASE_URL}/api/elders/1")
    print_result("GET /api/elders/1", r)
    d = r.json()
    if not (r.status_code == 200 and isinstance(d, dict) and 'elder' in d and 'daily_stats' in d):
        return False
    ds = d['daily_stats']
    need = {'elder_id', 'date', 'rounds', 'duration_min', 'active_slot', 'mood', 'note'}
    if not (isinstance(ds, list) and len(ds) <= 7 and all(need <= set(x.keys()) for x in ds)):
        return False
    dates = [x['date'] for x in ds]
    return dates == sorted(dates)

def test_alerts():
    """测试 GET /api/alerts（应返回 AlertItem[]，含中文状态、severity high/mid、disposal）"""
    print("\n🧪 测试 5: 预警列表")
    r = requests.get(f"{BASE_URL}/api/alerts")
    print_result("GET /api/alerts", r)
    d = r.json()
    if not (r.status_code == 200 and isinstance(d, list) and len(d) >= 6):
        return False
    need = {'id', 'elder_id', 'elder_name', 'created_at', 'keyword', 'summary', 'status', 'severity'}
    if not all(need <= set(a.keys()) for a in d):
        return False
    if not all(a['status'] in ('待处理', '已处理') for a in d):
        return False
    if not all(a['severity'] in ('high', 'mid') for a in d):
        return False
    # 已处理的应带 method 和 disposal
    processed = [a for a in d if a['status'] == '已处理']
    return all('disposal' in a and 'method' in a for a in processed)

def test_alerts_filter():
    """测试预警过滤（status=待处理 / elder_id）"""
    print("\n🧪 测试 6: 预警过滤")
    r1 = requests.get(f"{BASE_URL}/api/alerts?status=待处理")
    r2 = requests.get(f"{BASE_URL}/api/alerts?status=pending&elder_id=2")
    print_result("GET /api/alerts?status=待处理", r1)
    print_result("GET /api/alerts?status=pending&elder_id=2", r2)
    d1, d2 = r1.json(), r2.json()
    ok1 = isinstance(d1, list) and all(a['status'] == '待处理' for a in d1)
    ok2 = isinstance(d2, list) and all(a['status'] == '待处理' and a['elder_id'] == 2 for a in d2)
    return ok1 and ok2

def test_handle_alert():
    """测试 POST /api/alerts/:id/handle（处置闭环：预警已处理 + 风险下调 + 返回完整对象）"""
    print("\n🧪 测试 7: 处置预警")
    # 找一条待处理预警
    r = requests.get(f"{BASE_URL}/api/alerts?status=待处理")
    alerts = r.json()
    if not alerts:
        print("⚠️ 没有待处理预警可测试")
        return False
    alert = alerts[0]
    elder_id = alert['elder_id']

    # 处置前风险等级
    r = requests.get(f"{BASE_URL}/api/elders/{elder_id}")
    before = r.json()['elder']['risk_level']

    # 用"建议转介"触发自动转介记录
    referrals_before = len(requests.get(f"{BASE_URL}/api/referrals").json())

    r = requests.post(f"{BASE_URL}/api/alerts/{alert['id']}/handle", json={
        "method": "建议转介乡镇卫生院",
        "note": "已联系上老人儿子，今晚回家看看",
        "handler": "村协管员 · 老李"
    })
    print_result(f"POST /api/alerts/{alert['id']}/handle", r)
    d = r.json()

    if not (d.get('ok') is True and 'elder' in d and 'alert' in d):
        return False
    # 预警状态
    if d['alert']['status'] != '已处理' or 'disposal' not in d['alert']:
        return False
    # 风险下调一档
    downgrade = {'red': 'yellow', 'yellow': 'green', 'green': 'green'}
    if d['elder']['risk_level'] != downgrade[before]:
        print(f"⚠️ 风险未正确下调: {before} → {d['elder']['risk_level']}")
        return False
    # 自动转介记录 +1
    referrals_after = len(requests.get(f"{BASE_URL}/api/referrals").json())
    return referrals_after == referrals_before + 1

def test_risk_report():
    """测试 POST /api/risk-report（置红 + 返回 alert_id）"""
    print("\n🧪 测试 8: 风险上报")
    r = requests.post(f"{BASE_URL}/api/risk-report", json={
        "elder_id": 3, "keyword": "不想活", "summary": "老人表达了轻生念头"
    })
    print_result("POST /api/risk-report", r)
    d = r.json()
    if not (d.get('ok') is True and isinstance(d.get('alert_id'), int)):
        return False
    # 老人应被置红
    r = requests.get(f"{BASE_URL}/api/elders/3")
    elder = r.json()['elder']
    return elder['risk_level'] == 'red' and elder['mood'] == '需关注'

def test_chat():
    """测试 POST /api/chat（对话 + 自动预警联动）"""
    print("\n🧪 测试 9: 对话API")
    r = requests.post(f"{BASE_URL}/api/chat", json={
        "elder_id": 5, "message": "唉，人老了，活着没啥意思。", "language": "zh-CN"
    })
    print_result("POST /api/chat", r)
    d = r.json()
    ok = (d.get('ok') is True and d.get('emotion') == '需关注' and 'alert_id' in d)
    # 再来一条正常的
    r2 = requests.post(f"{BASE_URL}/api/chat", json={
        "elder_id": 5, "message": "今天看到小狗了，很开心"
    })
    ok = ok and r2.json().get('ok') is True
    return ok

def test_activity():
    """测试 POST /api/activity（累计轮次/时长 + 刷新 last_active）"""
    print("\n🧪 测试 10: 活跃上报")
    r0 = requests.get(f"{BASE_URL}/api/elders/12")
    before = r0.json()['elder']

    r = requests.post(f"{BASE_URL}/api/activity", json={"elder_id": 12, "rounds": 2})
    print_result("POST /api/activity", r)

    r1 = requests.get(f"{BASE_URL}/api/elders/12")
    after = r1.json()['elder']

    ok = r.json().get('ok') is True
    # 轮次应累计（原来 inactive 3 天，今日 rounds=0 → 2）
    ds = requests.get(f"{BASE_URL}/api/elders/12").json()['daily_stats']
    today_row = [x for x in ds if x['date'] == str(datetime.now().date())]
    ok = ok and today_row and today_row[0]['rounds'] >= 2 and today_row[0]['duration_min'] >= 4
    # last_active 刷新为今天
    ok = ok and after['days_inactive'] == 0 and after['today_active']
    return ok

def test_summaries():
    """测试 GET /api/summaries（Summary[]，含脱敏 turns）"""
    print("\n🧪 测试 11: 对话摘要")
    r = requests.get(f"{BASE_URL}/api/summaries?elder_id=1")
    print_result("GET /api/summaries?elder_id=1", r)
    d = r.json()
    if not (r.status_code == 200 and isinstance(d, list) and len(d) >= 4):
        return False
    need = {'id', 'elder_id', 'time', 'mood', 'summary', 'turns'}
    if not all(need <= set(s.keys()) for s in d):
        return False
    return all(t.get('from') in ('elder', 'ai') and 'text' in t for s in d for t in s['turns'])

def test_care_messages():
    """测试关怀留言全流程（单数+复数提交、pending、转达）"""
    print("\n🧪 测试 12: 关怀留言全流程")

    # 单数路径提交（前端家属端实际调用）
    r = requests.post(f"{BASE_URL}/api/care-message", json={
        "elder_id": 1, "content": "妈，记得吃药，晚上我给你打电话。"
    })
    print_result("POST /api/care-message（单数）", r)
    d = r.json()
    if not (d.get('ok') is True and isinstance(d.get('id'), int)):
        return False
    new_id = d['id']

    # 待转达留言
    r = requests.get(f"{BASE_URL}/api/care-message/pending?elder_id=1")
    print_result("GET /api/care-message/pending", r)
    pending = r.json()
    if not (isinstance(pending, dict) and pending.get('id')):
        return False

    # 留言列表（pending=1）
    r = requests.get(f"{BASE_URL}/api/care-messages?elder_id=1&pending=1")
    print_result("GET /api/care-messages?pending=1", r)
    msgs = r.json()
    if not (isinstance(msgs, list) and any(m['id'] == new_id for m in msgs)):
        return False

    # 标记已转达
    r = requests.post(f"{BASE_URL}/api/care-messages/{new_id}/conveyed")
    print_result(f"POST /api/care-messages/{new_id}/conveyed", r)

    # 再查 pending 列表，该条应消失
    r = requests.get(f"{BASE_URL}/api/care-messages?elder_id=1&pending=1")
    msgs = r.json()
    return r.json() and all(m['id'] != new_id for m in msgs)

def test_referrals():
    """测试 GET /api/referrals（Referral[]）"""
    print("\n🧪 测试 13: 转介记录")
    r = requests.get(f"{BASE_URL}/api/referrals")
    print_result("GET /api/referrals", r)
    d = r.json()
    if not (r.status_code == 200 and isinstance(d, list) and len(d) >= 4):
        return False
    need = {'id', 'elder_id', 'elder_name', 'target', 'time', 'status'}
    return all(need <= set(x.keys()) for x in d)

def test_mock_call():
    """测试 POST /api/mock-call"""
    print("\n🧪 测试 14: 模拟外呼")
    r = requests.post(f"{BASE_URL}/api/mock-call", json={"name": "张秀英"})
    print_result("POST /api/mock-call", r)
    d = r.json()
    return d.get('ok') is True and '张秀英' in d.get('message', '')

def test_error_format():
    """测试错误响应格式（HTTP 200 + { ok: false, message }）"""
    print("\n🧪 测试 15: 错误格式")
    r = requests.get(f"{BASE_URL}/api/elders/9999")
    print_result("GET /api/elders/9999", r)
    d = r.json()
    return r.status_code == 200 and d.get('ok') is False and 'message' in d

# ==================== 压力测试 ====================

def stress_test():
    """压力测试 - 发送10个消息"""
    print("\n🧪 压力测试: 发送10个消息")

    messages = [
        "今天天气很好", "儿子来看我了", "看到小狗了", "心情不太好",
        "睡眠不好", "想念孙子", "今天很开心", "有点焦虑",
        "感觉很平静", "谢谢你的陪伴"
    ]

    success = 0
    for i, msg in enumerate(messages):
        response = requests.post(f"{BASE_URL}/api/chat", json={
            "elder_id": 7, "message": msg, "language": "zh-CN"
        })
        if response.status_code == 200 and response.json().get('ok'):
            success += 1
            print(f"  ✅ [{i+1}/10] {msg}")
        else:
            print(f"  ❌ [{i+1}/10] {msg}")

    print(f"\n📊 结果: {success}/10 成功")
    return success == 10

# ==================== 主入口 ====================

def run_all_tests():
    print("\n" + "="*50)
    print("🚀 开始API测试（契约对齐版）")
    print("="*50)

    tests = [
        ("Stats 统计", test_stats),
        ("ScreenStats 筛查统计", test_screen_stats),
        ("Elders 花名册", test_elders_list),
        ("Elder 详情", test_elder_detail),
        ("Alerts 预警列表", test_alerts),
        ("Alerts 过滤", test_alerts_filter),
        ("Handle 处置闭环", test_handle_alert),
        ("RiskReport 风险上报", test_risk_report),
        ("Chat 对话", test_chat),
        ("Activity 活跃上报", test_activity),
        ("Summaries 对话摘要", test_summaries),
        ("CareMessages 关怀留言", test_care_messages),
        ("Referrals 转介记录", test_referrals),
        ("MockCall 模拟外呼", test_mock_call),
        ("错误格式", test_error_format),
    ]

    results = {}
    for name, fn in tests:
        try:
            results[name] = fn()
        except Exception as e:
            print(f"  ❌ {name} 异常: {e}")
            results[name] = False

    print("\n" + "="*50)
    print("📊 测试总结")
    print("="*50)

    for name, passed in results.items():
        print(f"{name}: {'✅ 通过' if passed else '❌ 失败'}")

    total_passed = sum(1 for v in results.values() if v)
    print(f"\n总计: {total_passed}/{len(results)} 通过")

    if total_passed == len(results):
        print("\n🎉 所有测试通过！")
    else:
        print(f"\n⚠️  有 {len(results) - total_passed} 个测试失败")


if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == 'stress':
        ok = stress_test()
        print("\n✅ 压力测试通过" if ok else "\n❌ 压力测试失败")
    else:
        run_all_tests()
        print("\n💡 提示:")
        print("  运行所有测试: python test_api.py")
        print("  运行压力测试: python test_api.py stress")
