-- Fictional demonstration records. Do not use real people's sensitive data here.
insert into public.elders
  (id,name,age,dialect,living,family_name,relation,last_call,phone,risk_level,last_active,mood,mood_summary,screened)
values
  (1,'王桂兰',78,'前院村','独居','李娟','孙女','今天 09:40',null,'yellow',now(),'低落','本周整体平稳，偶尔情绪偏低，建议家人多联系。',true),
  (2,'李福贵',81,'后山村','独居','李梅','女儿','今天 09:40',null,'red',now(),'需关注','多次表达消极情绪，需尽快联系家属。',true),
  (3,'张秀英',76,'前院村','与子女同住','张强','儿子','今天 09:40',null,'green',now(),'平和','本周情绪平稳，喜欢聊赶集和菜园子。',true),
  (4,'赵铁柱',73,'后山村','留守','赵丽','女儿','昨天 09:40',null,'yellow',now()-interval '1 day','低落','提到腿疼不想出门，建议多关心。',true),
  (5,'陈桂香',80,'前院村','独居','陈静','女儿','昨天 09:40',null,'green',now()-interval '1 day','平和','本周情绪平稳。',true),
  (6,'孙守田',84,'后山村','独居','孙伟','儿子','4 天前',null,'red',now()-interval '4 days','需关注','连续多日未活跃，需尽快电话回访。',true),
  (7,'周玉兰',75,'前院村','留守','周强','儿子','今天 09:40',null,'green',now(),'平和','本周情绪较好。',true),
  (8,'吴德贵',79,'后山村','留守','吴芳','女儿','今天 09:40',null,'yellow',now(),'平和','近一周话变少，建议家属多联系。',true),
  (9,'何秀珍',77,'前院村','独居','何亮','孙子','今天 09:40',null,'red',now(),'低落','提到睡眠不佳和情绪低落。',false),
  (10,'马长顺',82,'后山村','与子女同住','马丽','女儿','今天 09:40',null,'green',now(),'平和','本周情绪平稳。',true),
  (11,'郑桂英',74,'前院村','独居','郑小燕','女儿','昨天 09:40',null,'yellow',now()-interval '1 day','低落','提到独自吃饭没滋味，建议家属多联系。',false),
  (12,'冯天顺',85,'后山村','独居','冯建','儿子','3 天前',null,'green',now()-interval '3 days','平和','数日未活跃，历史情绪平稳。',true)
on conflict (id) do nothing;

select setval(pg_get_serial_sequence('public.elders','id'), (select coalesce(max(id),1) from public.elders));

insert into public.alerts (elder_id,keyword,summary,status,severity,created_at) values
  (2,'消极情绪表达','近期多次表达消极想法，建议尽快联系家属并上门了解。','pending','high',now()-interval '20 minutes'),
  (1,'睡不着 / 心里闷','连续提到睡眠不佳和心里发闷，建议家属多联系。','pending','mid',now()-interval '2 hours'),
  (6,'长时间未对话','多日没有对话记录，请电话回访或上门查看。','pending','mid',now()-interval '1 day'),
  (9,'情绪低落','老人提到夜里睡不好，情绪较低落。','pending','high',now()-interval '2 days')
on conflict do nothing;

insert into public.activities (elder_id,date,rounds,duration_min,active_slot,mood,note)
select e.id, current_date - d.n, case when e.id=6 and d.n<4 then 0 else 2 end,
       case when e.id=6 and d.n<4 then 0 else 4 end,
       case when d.n%2=0 then '上午' else '下午' end,
       case e.risk_level when 'red' then -1 when 'yellow' then 0 else 1 end,
       null
from public.elders e cross join generate_series(0,6) as d(n)
on conflict (elder_id,date) do nothing;
