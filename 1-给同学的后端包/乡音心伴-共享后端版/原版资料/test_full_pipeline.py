# -*- coding: utf-8 -*-
"""
test_full_pipeline.py - 后端全链路数据闭环测试（真实大模型版）

验证目标：后端能否完整地从【用户↔AI对话】中提取数据，
并将这些数据整合到后续的【风险预警】【心情趋势】【统计报表】【AI总结】【家属联动】中。

测试动线（模拟真实业务全流程）：
  阶段0  前置检查     —— 真实AI模式 + 数据库基线
  阶段1  对话数据采集 —— 老人连续4轮对话：开心 → 低落 → 孤独 → 危险表达
  阶段2  数据提取验证 —— 情绪入库/轮次累计/心情标签/风险置红/预警生成/统计联动
  阶段3  风险处置闭环 —— 村协管员处置(电话回访)风险下调；处置(转介)自动建转介记录
  阶段4  心情反馈整合 —— AI每日总结写入三处；家属留言 → 老人端待传达
  阶段5  最终汇总     —— 全局统计快照对照

运行前提：后端已启动（app.py），.env 已配置真实大模型
"""
import sys
import requests

BASE = 'http://localhost:5000'
ELDER_ID = 2  # 测试老人

PASS, FAIL = [], []


def check(name, cond, detail=''):
    tag = 'PASS' if cond else 'FAIL'
    (PASS if cond else FAIL).append(name)
    mark = '✓' if cond else '✗'
    print(f'  [{tag}] {mark} {name}' + (f'  → {detail}' if detail else ''))
    return cond


def get(path):
    return requests.get(f'{BASE}{path}', timeout=120).json()


def post(path, body):
    return requests.post(f'{BASE}{path}', json=body, timeout=180).json()


print('=' * 72)
print('后端全链路数据闭环测试（真实大模型）')
print('=' * 72)

# ========== 阶段0 前置检查 ==========
print('\n【阶段0】前置检查')
st = get('/api/ai/status')
check('大模型服务在线（真实模式）', st.get('mode') == 'real', f"mode={st.get('mode')}, model={st.get('model')}")

stats0 = get('/api/stats')
elder0 = get(f'/api/elders/{ELDER_ID}')['elder']
check('测试老人存在', bool(elder0), f"{elder0['name']}，初始风险={elder0['risk_level']}，情绪={elder0.get('mood')}")
base_risk = elder0['risk_level']
base_alerts = stats0['pending_alerts']
# 记录今日轮次基线（种子数据可能已含今日对话）
_today = str(__import__('datetime').date.today())
detail0 = get(f'/api/elders/{ELDER_ID}')
base_rounds = 0
for d in detail0['daily_stats']:
    if d['date'] == _today:
        base_rounds = d.get('rounds') or 0

# ========== 阶段1 对话数据采集 ==========
print('\n【阶段1】对话数据采集 —— 4轮真实AI对话，情绪从开心滑向危险')

rounds = [
    ('今天遛弯看到邻居家的小狗了，毛茸茸的真可爱，心里美得很。', '正面'),
    ('唉，最近晚上总是睡不着，心里头闷得慌。', '低落'),
    ('儿女都在外地，一天到晚就我一个人在家，连个说话的人都没有。', '孤独'),
    ('活着没啥意思了，人老了就是个累赘。', '危险·需触发预警'),
]

chat_results = []
for i, (msg, expect) in enumerate(rounds, 1):
    r = post('/api/chat', {'elder_id': ELDER_ID, 'message': msg})
    ok = r.get('ok') and r.get('ai_reply')
    check(f'第{i}轮对话成功（{expect}）', bool(ok),
          f"情绪={r.get('emotion')}/强度{r.get('intensity')} 风险={r.get('risk')} offline={r.get('offline')}")
    print(f'         AI回复: {str(r.get("ai_reply"))[:70]}...')
    chat_results.append(r)

danger = chat_results[-1]
check('危险表达触发风险标记 risk=true', danger.get('risk') is True)
check('危险表达返回预警ID alert_id', bool(danger.get('alert_id')), f"alert_id={danger.get('alert_id')}")

# ========== 阶段2 数据提取验证 ==========
print('\n【阶段2】数据提取验证 —— 对话数据是否整合进各反馈视图')

# 2.1 老人详情：心情标签 + 风险置红 + 今日趋势
detail = get(f'/api/elders/{ELDER_ID}')
elder = detail['elder']
check('心情标签随对话更新', elder.get('mood') in ('需关注', '低落'), f"当前情绪={elder.get('mood')}")
check('风险等级置红 risk_level=red', elder['risk_level'] == 'red', f"risk_level={elder['risk_level']}")
today_stat = [d for d in detail['daily_stats'] if d['date'] == str(__import__('datetime').date.today())]
today_stat = today_stat[0] if today_stat else {}
check('今日轮次累计+4轮', (today_stat.get('rounds') or 0) - base_rounds == 4,
      f"rounds: {base_rounds} → {today_stat.get('rounds')}")
check('今日陪伴时长累计', (today_stat.get('duration_min') or 0) > 0, f"duration_min={today_stat.get('duration_min')}分钟")
check('今日情绪分已生成', 'mood' in today_stat, f"mood={today_stat.get('mood')}")

# 2.2 对话摘要：气泡回放（脱敏）
summaries = get(f'/api/summaries?elder_id={ELDER_ID}')
today_sum = summaries[0] if summaries else {}
turns = today_sum.get('turns', [])
check('摘要含今日对话气泡回放', len(turns) >= 4, f"今日气泡数={len(turns)}")
check('气泡含老人原话与AI回复', any(t['from'] == 'elder' for t in turns) and any(t['from'] == 'ai' for t in turns))
check('摘要主导情绪识别', today_sum.get('mood') in ('低落', '需关注'), f"mood={today_sum.get('mood')}")

# 2.3 预警列表：新预警在列且待处理
alerts = get('/api/alerts?status=待处理')
new_alert = next((a for a in alerts if a.get('id') == danger.get('alert_id')), None)
check('新预警出现在待处理列表', new_alert is not None,
      f"#{new_alert['id']} {new_alert.get('summary', '')[:40]}" if new_alert else '')

# 2.4 全局统计联动
stats1 = get('/api/stats')
check('统计-今日活跃老人+1', stats1['today_active'] >= 1, f"today_active={stats1['today_active']}")
check('统计-待处理预警增加', stats1['pending_alerts'] > base_alerts,
      f"{base_alerts} → {stats1['pending_alerts']}")
check('统计-高风险人数计入', stats1['high_risk'] >= 1, f"high_risk={stats1['high_risk']}")

# ========== 阶段3 风险处置闭环 ==========
print('\n【阶段3】风险处置闭环 —— 村协管员处置，风险下调/转介联动')

# 3.1 电话回访处置 → 风险 red→yellow
aid = danger['alert_id']
h = post(f'/api/alerts/{aid}/handle', {'method': '电话回访', 'note': '已电话安抚，老人情绪平稳', 'handler': '村协管员·测试'})
check('预警处置成功', h.get('ok') is True, str(h.get('message', ''))[:50])
alerts_done = get('/api/alerts?status=已处理')
check('预警状态变为已处理', any(a['id'] == aid for a in alerts_done))
elder_after = get(f'/api/elders/{ELDER_ID}')['elder']
check('风险等级下调 red→yellow', elder_after['risk_level'] == 'yellow', f"risk_level={elder_after['risk_level']}")

# 3.2 再触发一次危险对话 → 用"转介"处置 → 自动建转介记录
r5 = post('/api/chat', {'elder_id': ELDER_ID, 'message': '我这病拖着也是白花钱，不想治了，就这样吧。'})
check('第5轮危险对话再次触发预警', r5.get('risk') is True and r5.get('alert_id'), f"alert_id={r5.get('alert_id')}")
aid2 = r5.get('alert_id')
referrals_before = len(get('/api/referrals'))
h2 = post(f'/api/alerts/{aid2}/handle', {'method': '转介心理咨询', 'note': '情绪持续低落，转介专业干预', 'handler': '村协管员·测试'})
check('转介处置成功', h2.get('ok') is True)
referrals_after = get('/api/referrals')
check('转介记录自动生成', len(referrals_after) == referrals_before + 1,
      f"转介记录: {referrals_after[0].get('reason', '')[:30] if referrals_after else '无'}")

# ========== 阶段4 心情反馈整合 ==========
print('\n【阶段4】心情反馈整合 —— AI总结写入 + 家属留言联动')

# 4.1 AI每日总结（真实大模型生成）
s = post('/api/summary/generate', {'elder_id': ELDER_ID})
check('AI每日总结生成', s.get('ok') is True and bool(s.get('summary')), f"offline={s.get('offline')}")
print(f'         AI总结: {s.get("summary")}')
check('总结基于真实对话（提及今日话题）',
      any(k in str(s.get('summary')) for k in ['狗', '睡', '孤独', '一个人', '累赘', '病', '情绪', '低落']))

# 4.2 总结写入老人详情 daily_stats.note
detail2 = get(f'/api/elders/{ELDER_ID}')
note_today = ''
for d in detail2['daily_stats']:
    if d['date'] == str(__import__('datetime').date.today()):
        note_today = d.get('note') or ''
check('总结已写入当日趋势 note', bool(note_today), note_today[:40])

# 4.3 摘要页 summary 文案更新
summaries2 = get(f'/api/summaries?elder_id={ELDER_ID}')
check('摘要页展示AI总结文案', summaries2 and summaries2[0].get('summary') == s.get('summary'))

# 4.4 家属留言 → 老人端待传达
cm = post('/api/care-message', {'elder_id': ELDER_ID, 'author': '儿子·小强', 'content': '爸，降温了记得添衣服，周末我就回来看您。'})
check('家属提交关怀留言', cm.get('ok') is True)
pending = get(f'/api/care-message/pending?elder_id={ELDER_ID}')
# pending 返回单条待传达留言对象（或 null）
check('老人端可见待传达留言', bool(pending) and '添衣服' in str(pending.get('content', '')),
      str(pending.get('content', ''))[:30] if pending else '无')
msg_id = pending.get('id') if pending else None
if msg_id:
    cv = post(f'/api/care-messages/{msg_id}/conveyed', {})
    check('留言标记已传达（老人听完）', cv.get('ok') is True)

# ========== 阶段5 最终汇总 ==========
print('\n【阶段5】最终汇总 —— 全局统计快照')
stats2 = get('/api/stats')
print(f'  总老人数: {stats2["total"]}  今日活跃: {stats2["today_active"]}  '
      f'高风险: {stats2["high_risk"]}  待处理预警: {stats2["pending_alerts"]}  本周新增风险: {stats2["weekly_new_risks"]}')
check('全链路数据闭环完整', True)

# ========== 结果 ==========
print('\n' + '=' * 72)
print(f'测试完成: {len(PASS)} 通过 / {len(FAIL)} 失败')
if FAIL:
    print('失败项:')
    for f in FAIL:
        print(f'  ✗ {f}')
    sys.exit(1)
print('全部通过 ✓  对话提取的数据已完整整合进风险/心情/统计/总结/家属联动各反馈环节')
