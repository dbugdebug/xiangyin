-- ============================================================================
--  乡音心伴 · 共享数据库建表脚本（Supabase / PostgreSQL 版）
-- ============================================================================
--  使用方法：
--    1. 打开 Supabase 项目 → 左侧菜单 SQL Editor → New query
--    2. 把本文件全部内容复制进去 → 点 Run
--    3. 看到 "Success. No rows returned" 即建库完成
--
--  注意：
--    · 本脚本可重复执行（IF NOT EXISTS / ON CONFLICT），不会重复插数据
--    · 建表顺序有依赖，请勿调换
--    · 团队两个后端（聊天后端 / 注册后端）都连这一个库
-- ============================================================================

-- ---------- 0. 清理（可选，仅在需要彻底重置时手动执行） ----------
-- DROP TABLE IF EXISTS emotion_records, activities, alerts, family_relations,
--   care_messages, referrals, health_profile, emergency_contact, "user", elders CASCADE;

-- ============================================================================
--  一、业务表（聊天后端使用）
-- ============================================================================

-- 老人表
CREATE TABLE IF NOT EXISTS elders (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(50)  NOT NULL,
  age           INTEGER      NOT NULL,
  dialect       VARCHAR(50),                        -- 方言片区
  living        VARCHAR(20),                        -- 独居/留守/与子女同住
  family_name   VARCHAR(50),                        -- 绑定家属姓名
  relation      VARCHAR(20),                        -- 绑定关系
  last_call     VARCHAR(50),                        -- 上次通话（展示文案）
  phone         VARCHAR(20),
  language      VARCHAR(20)  DEFAULT 'zh-CN',
  risk_level    VARCHAR(10)  DEFAULT 'green'
                CHECK (risk_level IN ('red','yellow','green')),
  last_active   TIMESTAMP,
  mood          VARCHAR(20),                        -- 最近情绪标签
  mood_summary  TEXT,                               -- AI 陪聊小结
  screened      SMALLINT     DEFAULT 0,             -- 是否已情绪筛查
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_elders_risk ON elders (risk_level);

-- 情绪记录表（核心）：每轮对话一条
CREATE TABLE IF NOT EXISTS emotion_records (
  id            SERIAL PRIMARY KEY,
  elder_id      INTEGER      NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  emotion       VARCHAR(50)  NOT NULL,
  reason        VARCHAR(255),
  intensity     INTEGER,
  user_message  TEXT,
  ai_reply      TEXT,
  date          DATE,
  timestamp     TIMESTAMP,
  language      VARCHAR(20)  DEFAULT 'zh-CN',
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_emotion_elder_date ON emotion_records (elder_id, date);

-- 每日陪伴统计表
CREATE TABLE IF NOT EXISTS activities (
  id            SERIAL PRIMARY KEY,
  elder_id      INTEGER      NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  date          DATE         NOT NULL,
  rounds        INTEGER      DEFAULT 0,             -- 当日对话轮次
  duration_min  INTEGER      DEFAULT 0,             -- 当日陪伴时长
  active_slot   VARCHAR(10),                        -- 上午/中午/下午/晚间
  mood          INTEGER      DEFAULT 0,             -- 情绪分 -2~+2
  note          TEXT,                               -- AI 一日话题摘要（脱敏）
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_activity_elder_date UNIQUE (elder_id, date)
);

-- 风险预警表
CREATE TABLE IF NOT EXISTS alerts (
  id            SERIAL PRIMARY KEY,
  elder_id      INTEGER      NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  keyword       VARCHAR(255),                       -- 命中的风险词
  summary       TEXT,                               -- AI 一句话摘要
  status        VARCHAR(20)  DEFAULT 'pending'
                CHECK (status IN ('pending','processed')),
  severity      VARCHAR(10)  DEFAULT 'mid'
                CHECK (severity IN ('high','mid')),
  method        VARCHAR(100),                       -- 处置方式
  handle_note   TEXT,                               -- 处置备注
  handler       VARCHAR(100),                       -- 处置人
  processed_at  TIMESTAMP,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_elder  ON alerts (elder_id);

-- 家属关系表
CREATE TABLE IF NOT EXISTS family_relations (
  id            SERIAL PRIMARY KEY,
  family_id     INTEGER      NOT NULL,
  elder_id      INTEGER      NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  relationship  VARCHAR(50),
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_family_family ON family_relations (family_id);
CREATE INDEX IF NOT EXISTS idx_family_elder  ON family_relations (elder_id);

-- 关怀留言表
CREATE TABLE IF NOT EXISTS care_messages (
  id            SERIAL PRIMARY KEY,
  elder_id      INTEGER      NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  content       TEXT         NOT NULL,
  conveyed      SMALLINT     DEFAULT 0,             -- 0未转达 1已转达
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_care_elder_conveyed ON care_messages (elder_id, conveyed);

-- 转介记录表
CREATE TABLE IF NOT EXISTS referrals (
  id            SERIAL PRIMARY KEY,
  elder_id      INTEGER      NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  target        VARCHAR(100),                       -- 转介对象
  status        VARCHAR(20)  DEFAULT '待跟进',
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referral_elder  ON referrals (elder_id);
CREATE INDEX IF NOT EXISTS idx_referral_status ON referrals (status);

-- ============================================================================
--  二、账号注册表（注册后端使用）
--     注意：user 是 SQL 保留字，必须写成 "user"（带双引号）
-- ============================================================================

CREATE TABLE IF NOT EXISTS "user" (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(50)  NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,             -- 只存哈希，绝不存明文
  phone          VARCHAR(20)  NOT NULL UNIQUE,      -- 手机号唯一
  role           VARCHAR(20)  DEFAULT 'elder',      -- elder 老人 / family 家属 / villager 村协管员
  village        VARCHAR(50),                       -- 所属村镇（仅村协管员）
  age            INTEGER,
  gender         VARCHAR(10),
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_role ON "user" (role);

-- 健康背景（病史）
CREATE TABLE IF NOT EXISTS health_profile (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  medical_history  TEXT,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_health_user ON health_profile (user_id);

-- 紧急联系人
CREATE TABLE IF NOT EXISTS emergency_contact (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  name        VARCHAR(50),
  phone       VARCHAR(20),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ec_user ON emergency_contact (user_id);

-- 单向绑定：家属 / 村协 → 老人（老人端无感，不产生任何确认流程）
-- 只存姓名 + 手机号，不存称谓/关系字段
CREATE TABLE IF NOT EXISTS elder_binding (
  id           SERIAL PRIMARY KEY,
  role         VARCHAR(20) NOT NULL,          -- 发起方：family 家属 / villager 村协管员
  user_phone   VARCHAR(20),                   -- 发起人手机号（演示模式可能为空）
  user_name    VARCHAR(50),                   -- 发起人姓名
  elder_phone  VARCHAR(20) NOT NULL,          -- 被绑定老人手机号
  elder_name   VARCHAR(50),                   -- 被绑定老人姓名（以库中注册名为准）
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_bind UNIQUE (role, user_phone, elder_phone)
);
CREATE INDEX IF NOT EXISTS idx_binding_user ON elder_binding (role, user_phone);

-- ============================================================================
--  三、演示种子数据（12 位老人等，与前端 demoStore 一致）
--     使用 ON CONFLICT DO NOTHING，可重复执行
-- ============================================================================

INSERT INTO elders (id, name, phone, age, dialect, living, family_name, relation, last_call,
                    risk_level, last_active, mood, mood_summary, screened) VALUES
 (1,'王桂兰','13800000001',78,'前院村','独居','李娟','孙女','今天 09:40','yellow',NOW(),'低落','王奶奶本周整体平稳，周三情绪偏低，主要聊到子女不在身边、夜里睡不踏实。',1),
 (2,'李福贵','13800000002',81,'后山村','独居','李梅','女儿','今天 09:40','red',NOW(),'需关注','李爷爷近三天情绪持续走低，多次提到"活着没意思"，已触发高风险预警，建议尽快上门。',1),
 (3,'张秀英','13800000003',76,'前院村','与子女同住','张强','儿子','今天 09:40','green',NOW(),'平和','张奶奶本周情绪平稳，最爱聊赶集和菜园子，胃口也不错。',1),
 (4,'赵铁柱','13800000004',73,'后山村','留守','赵丽','女儿','今天 09:40','yellow',NOW(),'低落','赵大爷提到腿疼不想出门，情绪略低，聊天时长短于往常。',1),
 (5,'陈桂香','13800000005',80,'前院村','独居','陈静','女儿','昨天 16:30','green',NOW()-INTERVAL '1 day','平和','陈奶奶本周情绪平稳，昨天聊了腌菜和邻居串门。',1),
 (6,'孙守田','13800000006',84,'后山村','独居','孙伟','儿子','4 天前','red',NOW()-INTERVAL '4 day','需关注','孙爷爷已连续 4 天没有对话记录，系统自动生成"长时间未对话"预警。',1),
 (7,'周玉兰','13800000007',75,'前院村','留守','周强','儿子','今天 09:40','green',NOW(),'平和','周奶奶本周情绪很好，天天跟乡音念叨广场舞。',1),
 (8,'吴德贵','13800000008',79,'后山村','留守','吴芳','女儿','今天 09:40','yellow',NOW(),'平和','吴大爷情绪尚可，但近一周话变少了，建议家属多打电话。',1),
 (9,'何秀珍','13800000009',77,'前院村','独居','何亮','孙子','今天 09:40','red',NOW(),'低落','何奶奶提到夜里腿抽筋睡不好、心里发空，情绪偏低落。',0),
 (10,'马长顺','13800000010',82,'后山村','与子女同住','马丽','女儿','今天 09:40','green',NOW(),'平和','马爷爷本周情绪平稳，聊得最多的是孙子上学的事。',1),
 (11,'郑桂英','13800000011',74,'前院村','独居','郑小燕','女儿','昨天 16:30','yellow',NOW()-INTERVAL '1 day','低落','郑奶奶昨天提到"一个人吃饭没滋味"，情绪偏低。',0),
 (12,'冯天顺','13800000012',85,'后山村','独居','冯建','儿子','3 天前','green',NOW()-INTERVAL '3 day','平和','冯爷爷 3 天未活跃，历史情绪平稳，已列入关注名单。',1)
ON CONFLICT (id) DO NOTHING;

-- 让 SERIAL 序列与手工指定的 id 对齐（否则后续自增会主键冲突）
SELECT setval(pg_get_serial_sequence('elders','id'), (SELECT MAX(id) FROM elders));

-- 预警种子（6 条，含 2 条已处理）
INSERT INTO alerts (elder_id, keyword, summary, severity, status, method, handle_note, handler, processed_at, created_at) VALUES
 (2,'疑似轻生念头（"活着没意思"）','对话中多次提到"活着没意思"，情绪明显低落，建议尽快上门探访或联系家属。','high','pending',NULL,NULL,NULL,NULL,NOW()-INTERVAL '4 hour'),
 (1,'睡不着 / 心里闷','连续两天提到睡不着、心里发闷，情绪偏低落，可安排家属多联系。','mid','pending',NULL,NULL,NULL,NULL,NOW()-INTERVAL '6 hour'),
 (6,'长时间未对话（48 小时）','已超过 48 小时无任何对话记录，请尽快电话回访或上门查看。','high','pending',NULL,NULL,NULL,NULL,NOW()-INTERVAL '1 day'),
 (9,'情绪低落 / 睡不好','提到夜里腿抽筋睡不好、心里发空，情绪偏低，建议村医上门看看。','mid','pending',NULL,NULL,NULL,NULL,NOW()-INTERVAL '2 hour'),
 (11,'孤单 / 一个人没滋味','提到"一个人吃饭没滋味"，情绪偏低落。','mid','processed','电话回访','已电话回访，郑奶奶情绪已平稳，答应周末去女儿家吃饭。','村协管员 · 老李',NOW()-INTERVAL '1 day'+INTERVAL '45 min',NOW()-INTERVAL '1 day'),
 (4,'腿疼不想出门','提到腿疼不愿出门，情绪略低。','mid','processed','建议转介乡镇卫生院','已协助预约乡镇卫生院骨关节门诊，家属陪同前往。','村协管员 · 老李',NOW()-INTERVAL '2 day'+INTERVAL '45 min',NOW()-INTERVAL '2 day');

-- 转介种子
INSERT INTO referrals (elder_id, target, status, created_at) VALUES
 (4,'乡镇卫生院 · 骨关节门诊','已完成',NOW()-INTERVAL '2 day'),
 (2,'乡镇卫生院 · 心理咨询','随访中',NOW()-INTERVAL '3 day'),
 (9,'村医 · 上门随访','已联系',NOW()-INTERVAL '5 day'),
 (12,'村委 · 网格员定期探望','待跟进',NOW()-INTERVAL '6 day');

-- 关怀留言种子
INSERT INTO care_messages (elder_id, content, conveyed, created_at) VALUES
 (1,'奶奶，天冷了记得加衣裳，周末我尽量回来看您。',0,NOW());

-- 家属关系种子（家属账号 1 绑定 王桂兰、李福贵）
INSERT INTO family_relations (family_id, elder_id, relationship) VALUES
 (1,1,'孙女'),(1,2,'女儿');

-- 情绪记录种子（供摘要页展示）
INSERT INTO emotion_records (elder_id, emotion, reason, intensity, user_message, ai_reply, date, timestamp) VALUES
 (1,'平和','聊到孙女考试进步',8,'俺孙女这次考试又进步了！','哈哈，真是好孩子！您平时教得好啊。',(NOW()-INTERVAL '1 day')::date,NOW()-INTERVAL '1 day'),
 (2,'需关注','出现消极表达',9,'唉，人老了，活着没啥意思。','哎，您可千万别这么想！您的平安比啥都金贵，家里人可离不开您。',NOW()::date,NOW()-INTERVAL '6 hour'),
 (3,'平和','赶集买东西，心情不错',8,'今儿个赶集去，买点新鲜的。','好呀，出门慢点走，逛累了就歇歇。',NOW()::date,NOW()-INTERVAL '7 hour'),
 (9,'低落','夜里腿抽筋睡不好',6,'夜里腿抽筋，睡不好觉。','那可难受了。喝口热牛奶，让村医给您瞧瞧？',NOW()::date,NOW()-INTERVAL '3 hour');

-- ============================================================================
--  四、验证：查看各表数据量
-- ============================================================================
SELECT 'elders' AS 表名, COUNT(*) AS 条数 FROM elders
UNION ALL SELECT 'emotion_records', COUNT(*) FROM emotion_records
UNION ALL SELECT 'activities', COUNT(*) FROM activities
UNION ALL SELECT 'alerts', COUNT(*) FROM alerts
UNION ALL SELECT 'family_relations', COUNT(*) FROM family_relations
UNION ALL SELECT 'care_messages', COUNT(*) FROM care_messages
UNION ALL SELECT 'referrals', COUNT(*) FROM referrals
UNION ALL SELECT 'user', COUNT(*) FROM "user"
UNION ALL SELECT 'health_profile', COUNT(*) FROM health_profile
UNION ALL SELECT 'emergency_contact', COUNT(*) FROM emergency_contact;
