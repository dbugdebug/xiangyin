/**
 * 乡音心伴 · 演示数据层闭环自检（离线跑，不依赖浏览器）
 * 校验：种子数据完整性 → 老人端触发预警 → 家属端可见 → 村协端处置 → 风险下调
 */
const s = require('C:/Users/LENOVO/AppData/Local/Temp/demoStore.cjs')

let fail = 0
const ok = (cond, msg, extra = '') => {
  if (cond) console.log('  ✅ ' + msg + (extra ? ' ' + extra : ''))
  else {
    fail++
    console.log('  ❌ ' + msg + (extra ? ' ' + extra : ''))
  }
}

console.log('\n【1】种子数据完整性')
const elders = s.listElders()
ok(elders.length >= 8, `老人数 ≥ 8`, `实际 ${elders.length} 位`)
const byLevel = { red: 0, yellow: 0, green: 0 }
elders.forEach((e) => byLevel[e.risk_level]++)
ok(byLevel.red > 0 && byLevel.yellow > 0 && byLevel.green > 0, '红/黄/绿三档都有', JSON.stringify(byLevel))
const aloneOld = elders.filter((e) => e.living === '独居' && e.age >= 80)
ok(aloneOld.length >= 2, '独居高龄 ≥ 2 位', aloneOld.map((e) => `${e.name}${e.age}岁`).join('、'))
const inactive3 = elders.filter((e) => (e.days_inactive ?? 0) >= 3)
ok(inactive3.length >= 2, '连续 3 天以上未活跃 ≥ 2 位', inactive3.map((e) => `${e.name}(${e.days_inactive}天)`).join('、'))

const allAlerts = s.listAlerts()
ok(allAlerts.length >= 4, '预警样例 ≥ 4 条', `实际 ${allAlerts.length} 条`)
const handled = allAlerts.filter((a) => a.status === '已处理')
ok(handled.length >= 1 && handled.every((a) => a.disposal), '含已处理且带处置记录的预警', handled.map((a) => a.disposal.method).join('、'))
ok(s.listSummaries(1).length >= 1, '家属端对话摘要非空（王桂兰）')
ok(s.listReferrals().length >= 1, '转介记录非空')
ok(s.listElders().every((e) => s.elderDailyStats(e.id).length === 7), '每位老人都有近 7 天情绪曲线')

console.log('\n【2】初始看板统计')
const st0 = s.getStats()
console.log('  →', JSON.stringify(st0))
ok(st0.total === elders.length, '在册总数一致')
ok(st0.high_risk === byLevel.red, '高风险人数 = 红档人数')

console.log('\n【3】老人端触发风险 → 预案写入（演示动线 ①②）')
const e1Before = s.getElder(1)
console.log(`  → 触发前：${e1Before.name} 风险=${e1Before.risk_level} 待处置=${e1Before.pending_count}`)
const newAlert = s.reportRisk({
  elder_id: 1,
  keyword: '活着没意思',
  summary: '对话中出现消极表达，亲属需尽快关注',
})
ok(!!newAlert && newAlert.status === '待处理', '新增预警为「待处理」')
const e1After = s.getElder(1)
ok(e1After.risk_level === 'red', '该老人风险等级已置为「红」', `→ ${e1After.risk_level}`)
ok((e1After.pending_count ?? 0) === (e1Before.pending_count ?? 0) + 1, '待处置数 +1')
const st1 = s.getStats()
ok(st1.pending_alerts === st0.pending_alerts + 1, '看板「待处置预警数」+1', `${st0.pending_alerts} → ${st1.pending_alerts}`)
ok(st1.high_risk === st0.high_risk + 1, '看板「高风险人数」+1', `${st0.high_risk} → ${st1.high_risk}`)
ok(
  s.listAlerts({ elder_id: 1 }).some((a) => a.id === newAlert.id),
  '家属端能立刻查到这条红色预警',
)

console.log('\n【4】村协端处置 → 风险下调一档（演示动线 ④⑤）')
const r = s.handleAlert(newAlert.id, {
  method: '电话回访',
  note: '已电话回访，老人情绪平稳，答应明天到村委坐坐',
  handler: '村协管员 · 老李',
})
ok(r.alert && r.alert.status === '已处理', '预警状态转为「已处理」')
ok(!!r.alert.disposal && r.alert.disposal.handler === '村协管员 · 老李', '写入处置记录（谁/何时/做了什么）')
ok(r.elder && r.elder.risk_level === 'yellow', '老人风险等级由红下调为黄', `→ ${r.elder.risk_level}`)
const st2 = s.getStats()
ok(st2.pending_alerts === st1.pending_alerts - 1, '看板「待处置预警数」-1', `${st1.pending_alerts} → ${st2.pending_alerts}`)
ok(st2.high_risk === st1.high_risk - 1, '看板「高风险人数」-1', `${st1.high_risk} → ${st2.high_risk}`)

console.log('\n【5】转介类处置自动生成转介记录')
const alert2 = s.listAlerts({ status: '待处理' })[0]
const before = s.listReferrals().length
s.handleAlert(alert2.id, { method: '建议转介乡镇卫生院', note: '已协助预约门诊', handler: '村协管员 · 老李' })
ok(s.listReferrals().length === before + 1, '转介记录 +1', `${before} → ${s.listReferrals().length}`)

console.log('\n【6】家属留言 → 老人端转达（家属端 ↔ 老人端闭环）')
const before2 = s.listCareMessages(1, true).length
const msg = s.addCareMessage(1, '奶奶，天冷了记得加衣裳，周末我尽量回来看您。')
ok(s.listCareMessages(1, true).length === before2 + 1, '新增一条待转达留言')
s.conveyCareMessage(msg.id)
ok(!s.listCareMessages(1, true).some((m) => m.id === msg.id), '标记已转达后不再重复推送')

console.log('\n【7】筛查统计 & 活跃上报')
const sc = s.getScreenStats()
console.log('  →', JSON.stringify(sc))
ok(sc.screened <= sc.total && sc.rate >= 0 && sc.rate <= 1, '筛查完成率取值合法')
const actBefore = s.elderDailyStats(6).find((d) => d.date === s.TODAY)
const beforeRounds = actBefore ? actBefore.rounds : 0 // 先取数值快照：对象是引用，调用后会被原地修改
s.reportActivity({ elder_id: 6, rounds: 2 })
const actAfter = s.elderDailyStats(6).find((d) => d.date === s.TODAY)
ok((actAfter.rounds ?? 0) === beforeRounds + 2, '活跃上报后今日轮次累加', `${beforeRounds} → ${actAfter.rounds}`)
ok(s.getElder(6).days_inactive === 0, '久未活跃老人上报后被标记为今日活跃')

console.log('\n【8】订阅通知（页面实时刷新）')
let hits = 0
const off = s.subscribe(() => hits++)
s.reportActivity({ elder_id: 3, rounds: 1 })
off()
const hitsAtOff = hits
s.reportActivity({ elder_id: 3, rounds: 1 })
ok(hits > 0, '订阅回调被触发', `触发 ${hits} 次`)
ok(hits === hitsAtOff, '取消订阅后不再收到通知')

console.log(fail === 0 ? '\n🎉 全部校验通过（' + '闭环可用）\n' : `\n⚠️ 有 ${fail} 项未通过\n`)
process.exit(fail === 0 ? 0 : 1)
