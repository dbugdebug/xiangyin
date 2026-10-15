"""
sqlite_backend.py — SQLite 模式的建表 / 播种（从已验证版本抽取，等价 init_db.py）

由 db_compat 在 sqlite 模式下首次取连接时调用 init_db_sqlite()。
表结构与 PostgreSQL 版（schema.sql）保持一致：
  elders / emotion_records / activities / alerts / family_relations /
  care_messages / referrals / "user"(含 role,village) / health_profile /
  emergency_contact / elder_binding
"""

import os
import sqlite3
from datetime import datetime, timedelta, date as _date

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'xiangyin.db')

sqlite3.register_adapter(_date, lambda d: d.isoformat())
sqlite3.register_adapter(datetime, lambda dt: dt.strftime('%Y-%m-%d %H:%M:%S'))


# DB 文件路径由 init_db_sqlite(db_file) 参数传入

# date/datetime 适配器：存 ISO 文本，取时按声明类型还原为对象
sqlite3.register_adapter(_date, lambda d: d.isoformat())
sqlite3.register_adapter(datetime, lambda dt: dt.strftime('%Y-%m-%d %H:%M:%S'))

def _conv_datetime(s):
    s = s.decode() if isinstance(s, bytes) else s
    try:
        return datetime.strptime(s[:19], '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return datetime.strptime(s[:10], '%Y-%m-%d')

def _conv_date(s):
    s = s.decode() if isinstance(s, bytes) else s
    return datetime.strptime(s[:10], '%Y-%m-%d').date()

sqlite3.register_converter('DATETIME', _conv_datetime)
sqlite3.register_converter('TIMESTAMP', _conv_datetime)
sqlite3.register_converter('DATE', _conv_date)

# ---------- 建表 + 种子（首次启动自动完成，等价 init_db.py） ----------

DDL = [
    """CREATE TABLE IF NOT EXISTS elders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, age INTEGER NOT NULL,
      dialect TEXT, living TEXT, family_name TEXT, relation TEXT,
      last_call TEXT, phone TEXT, language TEXT DEFAULT 'zh-CN',
      risk_level TEXT DEFAULT 'green' CHECK(risk_level IN ('red','yellow','green')),
      last_active DATETIME, mood TEXT, mood_summary TEXT,
      screened INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS emotion_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      elder_id INTEGER NOT NULL, emotion TEXT NOT NULL, reason TEXT,
      intensity INTEGER, user_message TEXT, ai_reply TEXT,
      date DATE, timestamp DATETIME, language TEXT DEFAULT 'zh-CN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      elder_id INTEGER NOT NULL, date DATE NOT NULL,
      rounds INTEGER DEFAULT 0, duration_min INTEGER DEFAULT 0,
      active_slot TEXT, mood INTEGER DEFAULT 0, note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(elder_id, date)
    )""",
    """CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      elder_id INTEGER NOT NULL, keyword TEXT, summary TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processed')),
      severity TEXT DEFAULT 'mid' CHECK(severity IN ('high','mid')),
      method TEXT, handle_note TEXT, handler TEXT,
      processed_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS family_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL, elder_id INTEGER NOT NULL,
      relationship TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS care_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      elder_id INTEGER NOT NULL, content TEXT NOT NULL,
      conveyed INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      elder_id INTEGER NOT NULL, target TEXT,
      status TEXT DEFAULT '待跟进', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS "user" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, password_hash TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      role TEXT DEFAULT 'elder', village TEXT,
      age INTEGER, gender TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS health_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, medical_history TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS emergency_contact (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, name TEXT, phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS elder_binding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      user_phone TEXT, user_name TEXT,
      elder_phone TEXT NOT NULL, elder_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(role, user_phone, elder_phone)
    )""",
]

def date_ago(days_ago):
    return (datetime.now() - timedelta(days=days_ago)).date()

def datetime_ago(days_ago, hour=9, minute=40):
    return datetime.now().replace(hour=hour, minute=minute, second=0, microsecond=0) - timedelta(days=days_ago)

def rel_label(days_ago, hh=9, mm=40):
    if days_ago == 0:
        return '今天 %02d:%02d' % (hh, mm)
    if days_ago == 1:
        return '昨天 %02d:%02d' % (hh, mm)
    return '%d 天前' % days_ago

ELDER_SEED = [
    (1, '王桂兰', 78, '前院村', '独居', '李娟', '孙女', 'yellow', '低落', 0, 1,
     '王奶奶本周整体平稳，周三情绪偏低，主要聊到子女不在身边、夜里睡不踏实。'),
    (2, '李福贵', 81, '后山村', '独居', '李梅', '女儿', 'red', '需关注', 0, 1,
     '李爷爷近三天情绪持续走低，多次提到"活着没意思"，已触发高风险预警，建议尽快上门。'),
    (3, '张秀英', 76, '前院村', '与子女同住', '张强', '儿子', 'green', '平和', 0, 1,
     '张奶奶本周情绪平稳，最爱聊赶集和菜园子，胃口也不错。'),
    (4, '赵铁柱', 73, '后山村', '留守', '赵丽', '女儿', 'yellow', '低落', 0, 1,
     '赵大爷提到腿疼不想出门，情绪略低，聊天时长短于往常。'),
    (5, '陈桂香', 80, '前院村', '独居', '陈静', '女儿', 'green', '平和', 1, 1,
     '陈奶奶本周情绪平稳，昨天聊了腌菜和邻居串门。'),
    (6, '孙守田', 84, '后山村', '独居', '孙伟', '儿子', 'red', '需关注', 4, 1,
     '孙爷爷已连续 4 天没有对话记录，系统自动生成"长时间未对话"预警。'),
    (7, '周玉兰', 75, '前院村', '留守', '周强', '儿子', 'green', '平和', 0, 1,
     '周奶奶本周情绪很好，天天跟乡音念叨广场舞。'),
    (8, '吴德贵', 79, '后山村', '留守', '吴芳', '女儿', 'yellow', '平和', 0, 1,
     '吴大爷情绪尚可，但近一周话变少了，建议家属多打电话。'),
    (9, '何秀珍', 77, '前院村', '独居', '何亮', '孙子', 'red', '低落', 0, 0,
     '何奶奶提到夜里腿抽筋睡不好、心里发空，情绪偏低落。'),
    (10, '马长顺', 82, '后山村', '与子女同住', '马丽', '女儿', 'green', '平和', 0, 1,
     '马爷爷本周情绪平稳，聊得最多的是孙子上学的事。'),
    (11, '郑桂英', 74, '前院村', '独居', '郑小燕', '女儿', 'yellow', '低落', 1, 0,
     '郑奶奶昨天提到"一个人吃饭没滋味"，情绪偏低。'),
    (12, '冯天顺', 85, '后山村', '独居', '冯建', '儿子', 'green', '平和', 3, 1,
     '冯爷爷 3 天未活跃，历史情绪平稳，已列入关注名单。'),
]

MOOD_BY_RISK = {'red': [-1,-1,-2,-1,-2,-1,-2], 'yellow': [0,-1,0,-1,-1,0,-1], 'green': [1,0,1,0,1,1,1]}
MOOD_ELDER1 = [-1,-1,0,1,0,-2,-1]
SLOTS = ['上午', '中午', '下午', '晚间']
NOTES = {
    1: {0: '睡得不太好，心里发闷，反复念叨想念在外地的孩子们。',
        1: '说到孙女考试考了好名次，情绪不错，笑声挺多。',
        3: '提醒按时吃了降压药，说中午胃口挺好。',
        4: '提到腿疼不想出门，已连续两天没出门晒太阳。'},
    2: {0: '情绪明显低落，多次出现消极表达，已触发高风险预警。',
        1: '说儿女常年不在身边，一个人吃饭没滋味。'},
    3: {0: '晨间问候，说今天要去赶集，心情不错。'},
    9: {0: '提到夜里腿抽筋睡不好，情绪一般。'},
    6: {4: '长时间未对话预警：近 48 小时无任何对话记录。'},
}

def build_daily_stats(elder_id, risk_level, inactive_days):
    curve = MOOD_ELDER1 if elder_id == 1 else MOOD_BY_RISK[risk_level]
    base = {'green': 6, 'yellow': 4, 'red': 3}[risk_level]
    rows = []
    for i in range(7):
        days_ago = 6 - i
        if elder_id == 1 and days_ago == 0:
            continue
        rounds = 0 if days_ago < inactive_days else max(1, base + ((elder_id * 7 + i * 3) % 5) - 2)
        rows.append((elder_id, date_ago(days_ago), rounds, rounds * 2,
                     SLOTS[(elder_id + i) % len(SLOTS)], curve[6 - days_ago],
                     NOTES.get(elder_id, {}).get(days_ago)))
    return rows

ALERT_SEED = [
    (2, '疑似轻生念头（"活着没意思"）', '对话中多次提到"活着没意思"，情绪明显低落，建议尽快上门探访或联系家属。',
     'high', 'pending', 0, 9, 42, None, None, None),
    (1, '睡不着 / 心里闷', '连续两天提到睡不着、心里发闷，情绪偏低落，可安排家属多联系。',
     'mid', 'pending', 0, 8, 26, None, None, None),
    (6, '长时间未对话（48 小时）', '已超过 48 小时无任何对话记录，请尽快电话回访或上门查看。',
     'high', 'pending', 1, 21, 30, None, None, None),
    (9, '情绪低落 / 睡不好', '提到夜里腿抽筋睡不好、心里发空，情绪偏低，建议村医上门看看。',
     'mid', 'pending', 0, 9, 55, None, None, None),
    (11, '孤单 / 一个人没滋味', '提到"一个人吃饭没滋味"，情绪偏低落。',
     'mid', 'processed', 1, 15, 20, '电话回访', '已电话回访，郑奶奶情绪已平稳，答应周末去女儿家吃饭。', '村协管员 · 老李'),
    (4, '腿疼不想出门', '提到腿疼不愿出门，情绪略低。',
     'mid', 'processed', 2, 10, 15, '建议转介乡镇卫生院', '已协助预约乡镇卫生院骨关节门诊，家属陪同前往。', '村协管员 · 老李'),
]

REFERRAL_SEED = [
    (4, '乡镇卫生院 · 骨关节门诊', '已完成', 2, 11, 0),
    (2, '乡镇卫生院 · 心理咨询', '随访中', 3, 9, 20),
    (9, '村医 · 上门随访', '已联系', 5, 10, 30),
    (12, '村委 · 网格员定期探望', '待跟进', 6, 14, 0),
]

CARE_MESSAGE_SEED = [
    (1, '奶奶，天冷了记得加衣裳，周末我尽量回来看您。', 0, 0, 7, 40),
]

EMOTION_RECORD_SEED = [
    (1, '平和', '聊到孙女考试进步', 8, '俺孙女这次考试又进步了！', '哈哈，真是好孩子！您平时教得好啊。', 1, 19, 30),
    (1, '平和', '按点吃药、胃口好', 6, '吃了吃了，药没断。', '您记性真好，就这样按点吃，身子骨才硬朗。', 3, 15, 2),
    (1, '需关注', '腿疼不想出门', 7, '腿又疼了，懒得出门。', '那可不能硬扛，让家里人陪您去卫生院瞧瞧。', 4, 10, 47),
    (2, '需关注', '出现消极表达', 9, '唉，人老了，活着没啥意思。', '哎，您可千万别这么想！您的平安比啥都金贵，家里人可离不开您。', 0, 9, 40),
    (2, '低落', '一个人吃饭没滋味', 6, '一个人吃饭，没啥滋味。', '有乡音陪着您呢。明儿让村协老李来陪您下下棋？', 1, 20, 10),
    (3, '平和', '赶集买东西，心情不错', 8, '今儿个赶集去，买点新鲜的。', '好呀，出门慢点走，逛累了就歇歇。', 0, 7, 58),
    (9, '低落', '夜里腿抽筋睡不好', 6, '夜里腿抽筋，睡不好觉。', '那可难受了。喝口热牛奶，让村医给您瞧瞧？', 0, 9, 55),
]


def _migrate(cur):
    """兼容旧版本残留的数据库文件：补齐后加的列 / 数据（幂等，可重复执行）"""
    # 1) user 表补齐 role / village 两列
    cur.execute('PRAGMA table_info("user")')
    cols = {r[1] for r in cur.fetchall()}
    if cols:
        if 'role' not in cols:
            cur.execute('ALTER TABLE "user" ADD COLUMN role TEXT DEFAULT \'elder\'')
        if 'village' not in cols:
            cur.execute('ALTER TABLE "user" ADD COLUMN village TEXT')
    # 2) 老人手机号为空的历史数据 → 按 id 补齐（与前端演示手机号 13800000001~13800000012 一致）
    try:
        cur.execute("UPDATE elders SET phone = printf('13800000%03d', id) "
                    "WHERE phone IS NULL OR phone = ''")
    except sqlite3.Error:
        pass


def init_db_sqlite(db_file=None):
    """首次启动自动建表 + 播种（等价 init_db.py）；对旧库自动补齐结构"""
    conn = sqlite3.connect(db_file or DB_FILE, detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    for ddl in DDL:
        cur.execute(ddl)
    _migrate(cur)
    conn.commit()
    cur.execute("SELECT COUNT(*) AS c FROM elders")
    if cur.fetchone()['c'] == 0:
        for (eid, name, age, dialect, living, fam, rel, risk, mood, inactive, screened, summary) in ELDER_SEED:
            last_active = datetime_ago(inactive, 16 if inactive > 0 else 9, 30 if inactive > 0 else 40)
            last_call = rel_label(inactive, 9 if inactive == 0 else 16, 40 if inactive == 0 else 30)
            cur.execute("""INSERT INTO elders
            (id, name, phone, age, dialect, living, family_name, relation, last_call,
             risk_level, last_active, mood, mood_summary, screened)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (eid, name, '13800000%03d' % eid, age, dialect, living, fam, rel,
             last_call, risk, last_active, mood, summary, screened))
        for (eid, name, age, dialect, living, fam, rel, risk, mood, inactive, screened, summary) in ELDER_SEED:
            for row in build_daily_stats(eid, risk, inactive):
                cur.execute("""INSERT INTO activities
                (elder_id, date, rounds, duration_min, active_slot, mood, note)
                VALUES (?,?,?,?,?,?,?)""", row)
        for (eid, kw, summ, sev, status, d_ago, hh, mm, method, note, handler) in ALERT_SEED:
            created = datetime_ago(d_ago, hh, mm)
            processed = created + timedelta(minutes=45) if status == 'processed' else None
            cur.execute("""INSERT INTO alerts
            (elder_id, keyword, summary, severity, status, method, handle_note, handler, processed_at, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (eid, kw, summ, sev, status, method, note, handler, processed, created))
        for (eid, target, status, d_ago, hh, mm) in REFERRAL_SEED:
            cur.execute("INSERT INTO referrals (elder_id, target, status, created_at) VALUES (?,?,?,?)",
                        (eid, target, status, datetime_ago(d_ago, hh, mm)))
        for (eid, content, conveyed, d_ago, hh, mm) in CARE_MESSAGE_SEED:
            cur.execute("INSERT INTO care_messages (elder_id, content, conveyed, created_at) VALUES (?,?,?,?)",
                        (eid, content, conveyed, datetime_ago(d_ago, hh, mm)))
        for (eid, emotion, reason, intensity, umsg, areply, d_ago, hh, mm) in EMOTION_RECORD_SEED:
            ts = datetime_ago(d_ago, hh, mm)
            cur.execute("""INSERT INTO emotion_records
            (elder_id, emotion, reason, intensity, user_message, ai_reply, date, timestamp)
            VALUES (?,?,?,?,?,?,?,?)""",
            (eid, emotion, reason, intensity, umsg, areply, ts.date(), ts))
        for (fid, eid, rel) in [(1, 1, '孙女'), (1, 2, '女儿')]:
            cur.execute("INSERT INTO family_relations (family_id, elder_id, relationship) VALUES (?,?,?)", (fid, eid, rel))
        conn.commit()
    conn.close()

