# init_db.py - 数据库初始化脚本（对齐前端 API-CONTRACT 契约版）
# 表结构 + 种子数据与前端 demoStore.ts 的 12 位老人完全一致，方便联调对数据
#
# 用户注册与绑定相关表（供前端注册页 / POST /api/register、绑定接口使用）：
#   user（注册主档，密码哈希 + role 角色 + village 所属村镇）
#   health_profile（病史）/ emergency_contact（紧急联系人）
#   elder_binding（家属/村协 单向绑定老人，无称谓字段）

import os
import sys
from datetime import datetime, timedelta

from dotenv import load_dotenv
import mysql.connector

load_dotenv()

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'port': int(os.getenv('DB_PORT', 3306)),
}

DB_NAME = os.getenv('DB_NAME', 'xiangyin')


def get_admin_connection():
    """获取不指定数据库的管理连接"""
    return mysql.connector.connect(**DB_CONFIG)


# ==================== 表结构定义 ====================

# 老人表：对齐前端 Elder 类型（risk_level 使用 red/yellow/green）
TABLE_ELDERS = """
CREATE TABLE IF NOT EXISTS elders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  age INT NOT NULL,
  dialect VARCHAR(50) COMMENT '方言片区（如前院村）',
  living VARCHAR(20) COMMENT '居住状态：独居/留守/与子女同住',
  family_name VARCHAR(50) COMMENT '绑定家属姓名',
  relation VARCHAR(20) COMMENT '绑定关系：孙女/子女/儿子…',
  last_call VARCHAR(50) COMMENT '上次通话时间（展示文案）',
  phone VARCHAR(20),
  language VARCHAR(20) DEFAULT 'zh-CN',
  risk_level ENUM('red', 'yellow', 'green') DEFAULT 'green',
  last_active DATETIME,
  mood VARCHAR(20) COMMENT '最近情绪标签：平和/低落/需关注',
  mood_summary TEXT COMMENT 'AI 陪聊小结（家属端本周卡片）',
  screened TINYINT(1) DEFAULT 0 COMMENT '是否已完成情绪筛查',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_risk (risk_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 情绪记录表（核心）：每轮对话一条
TABLE_EMOTION_RECORDS = """
CREATE TABLE IF NOT EXISTS emotion_records (
  id INT PRIMARY KEY AUTO_INCREMENT,
  elder_id INT NOT NULL,
  emotion VARCHAR(50) NOT NULL,
  reason VARCHAR(255),
  intensity INT,
  user_message TEXT,
  ai_reply TEXT,
  date DATE,
  timestamp DATETIME,
  language VARCHAR(20) DEFAULT 'zh-CN',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_elder_date (elder_id, date),
  FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 每日陪伴统计表：对齐前端 DailyStat 类型
TABLE_ACTIVITIES = """
CREATE TABLE IF NOT EXISTS activities (
  id INT PRIMARY KEY AUTO_INCREMENT,
  elder_id INT NOT NULL,
  date DATE NOT NULL,
  rounds INT DEFAULT 0 COMMENT '当日对话轮次',
  duration_min INT DEFAULT 0 COMMENT '当日陪伴时长（分钟）',
  active_slot VARCHAR(10) COMMENT '当日活跃时段：上午/中午/下午/晚间',
  mood INT DEFAULT 0 COMMENT '情绪分：-2(很低落)~+2(很好)',
  note TEXT COMMENT 'AI 生成的一日话题摘要（脱敏）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_elder_date (elder_id, date),
  FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 预警表：severity 对齐前端 AlertItem（high/mid），处置信息内联
TABLE_ALERTS = """
CREATE TABLE IF NOT EXISTS alerts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  elder_id INT NOT NULL,
  keyword VARCHAR(255) COMMENT '命中的风险词/消极表达',
  summary TEXT COMMENT 'AI 生成的一句话摘要',
  status ENUM('pending', 'processed') DEFAULT 'pending',
  severity ENUM('high', 'mid') DEFAULT 'mid',
  method VARCHAR(100) COMMENT '处置方式（已处理时展示）',
  handle_note TEXT COMMENT '处置备注',
  handler VARCHAR(100) COMMENT '处置人',
  processed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_elder (elder_id),
  FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 家属关系表
TABLE_FAMILY_RELATIONS = """
CREATE TABLE IF NOT EXISTS family_relations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  family_id INT NOT NULL,
  elder_id INT NOT NULL,
  relationship VARCHAR(50),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_family (family_id),
  INDEX idx_elder (elder_id),
  FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 关怀留言表
TABLE_CARE_MESSAGES = """
CREATE TABLE IF NOT EXISTS care_messages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  elder_id INT NOT NULL,
  content TEXT NOT NULL,
  conveyed TINYINT DEFAULT 0 COMMENT '0=未转达 1=已由乡音转达',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_elder_conveyed (elder_id, conveyed),
  FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 转介记录表
TABLE_REFERRALS = """
CREATE TABLE IF NOT EXISTS referrals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  elder_id INT NOT NULL,
  target VARCHAR(100) COMMENT '转介对象：乡镇卫生院 · 心理咨询 / 村医 · 上门随访…',
  status ENUM('已联系', '随访中', '已完成', '待跟进') DEFAULT '待跟进',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_elder (elder_id),
  INDEX idx_status (status),
  FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# ==================== 用户注册相关表（本轮新增） ====================

# 注册主档：密码只存哈希，绝不存明文；手机号唯一（用于验证 / 找回）
# 注意：表名 user 在 MySQL 中是关键字，所有 SQL 都需写成 `user`（带反引号）
# 本轮扩展：role 区分三种注册角色（elder 老人 / family 家属 / villager 村协管员），
#          village 存村协管员的所属村镇。旧库升级可直接执行：
#          ALTER TABLE `user` ADD COLUMN role VARCHAR(20) DEFAULT 'elder', ADD COLUMN village VARCHAR(50);
TABLE_USER = """
CREATE TABLE IF NOT EXISTS `user` (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL COMMENT '姓名（老人/家属/村协均用）',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希（绝不存明文）',
  phone VARCHAR(20) NOT NULL COMMENT '手机号（唯一，用于验证/找回）',
  role VARCHAR(20) DEFAULT 'elder' COMMENT '角色：elder 老人 / family 家属 / villager 村协管员',
  village VARCHAR(50) COMMENT '所属村镇（仅村协管员）',
  age INT COMMENT '年龄（老人端选填）',
  gender VARCHAR(10) COMMENT '性别：男/女（老人端选填）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_phone (phone),
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 单向绑定：家属 / 村协 → 老人（老人端无感，不产生任何确认流程）
# 只存姓名 + 手机号，不存称谓/关系字段（如"我是他孙女"），符合"不显示关系字段"的要求。
TABLE_ELDER_BINDING = """
CREATE TABLE IF NOT EXISTS elder_binding (
  id INT PRIMARY KEY AUTO_INCREMENT,
  role VARCHAR(20) NOT NULL COMMENT '发起绑定方：family 家属 / villager 村协管员',
  user_phone VARCHAR(20) COMMENT '发起人手机号（演示模式可能为空）',
  user_name VARCHAR(50) COMMENT '发起人姓名',
  elder_phone VARCHAR(20) NOT NULL COMMENT '被绑定老人手机号',
  elder_name VARCHAR(50) COMMENT '被绑定老人姓名（注册名，以库中为准）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bind (role, user_phone, elder_phone),
  INDEX idx_user (role, user_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 健康背景扩展：过往病史（单独建表，方便 AI 对话按需调用，也便于将来做数据脱敏与权限分离）
TABLE_HEALTH_PROFILE = """
CREATE TABLE IF NOT EXISTS health_profile (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL COMMENT '关联 user.id',
  medical_history TEXT COMMENT '高血压、糖尿病、心脏病等慢性病史',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# 紧急联系人（单独建表）
TABLE_EMERGENCY_CONTACT = """
CREATE TABLE IF NOT EXISTS emergency_contact (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL COMMENT '关联 user.id',
  name VARCHAR(50) COMMENT '联系人姓名',
  phone VARCHAR(20) COMMENT '联系人电话',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

TABLES = {
    'elders': TABLE_ELDERS,
    'emotion_records': TABLE_EMOTION_RECORDS,
    'activities': TABLE_ACTIVITIES,
    'alerts': TABLE_ALERTS,
    'family_relations': TABLE_FAMILY_RELATIONS,
    'care_messages': TABLE_CARE_MESSAGES,
    'referrals': TABLE_REFERRALS,
    # ---- 用户注册与绑定（本轮新增，供前端注册页 / 绑定接口使用）----
    'user': TABLE_USER,
    'health_profile': TABLE_HEALTH_PROFILE,
    'emergency_contact': TABLE_EMERGENCY_CONTACT,
    'elder_binding': TABLE_ELDER_BINDING,
}


# ==================== 种子数据（与前端 demoStore.ts 一致） ====================

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


# 12 位老人：红3/黄4/绿5（id/姓名/年龄/方言片区/居住/家属/关系/风险/情绪/未活跃天数/已筛查/AI小结）
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

# 各档风险近7天情绪曲线（旧→新）
MOOD_BY_RISK = {
    'red': [-1, -1, -2, -1, -2, -1, -2],
    'yellow': [0, -1, 0, -1, -1, 0, -1],
    'green': [1, 0, 1, 0, 1, 1, 1],
}
MOOD_ELDER1 = [-1, -1, 0, 1, 0, -2, -1]
SLOTS = ['上午', '中午', '下午', '晚间']

# 一日话题摘要（脱敏）：elder_id -> {date偏移: 文案}
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
    """生成某位老人近 7 天每日统计（旧→新，date 升序）"""
    curve = MOOD_ELDER1 if elder_id == 1 else MOOD_BY_RISK[risk_level]
    base = {'green': 6, 'yellow': 4, 'red': 3}[risk_level]
    rows = []
    for i in range(7):
        days_ago = 6 - i  # i=6 → 今天
        # 1号老人（演示聊天账号）的"今天"不种统计——今天的数据由真实聊天产生
        if elder_id == 1 and days_ago == 0:
            continue
        rounds = 0 if days_ago < inactive_days else max(1, base + ((elder_id * 7 + i * 3) % 5) - 2)
        rows.append((
            elder_id,
            date_ago(days_ago),
            rounds,
            rounds * 2,  # 每轮约2分钟
            SLOTS[(elder_id + i) % len(SLOTS)],
            curve[6 - days_ago],
            NOTES.get(elder_id, {}).get(days_ago),
        ))
    return rows


# 预警种子：与前端 demoStore 一致（6条，含2条已处理带处置记录）
ALERT_SEED = [
    # (elder_id, keyword, summary, severity, status, days_ago, hour, minute, method, note, handler)
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

# 转介种子（与前端一致，4条）
REFERRAL_SEED = [
    (4, '乡镇卫生院 · 骨关节门诊', '已完成', 2, 11, 0),
    (2, '乡镇卫生院 · 心理咨询', '随访中', 3, 9, 20),
    (9, '村医 · 上门随访', '已联系', 5, 10, 30),
    (12, '村委 · 网格员定期探望', '待跟进', 6, 14, 0),
]

# 关怀留言种子（与前端一致，1条）
CARE_MESSAGE_SEED = [
    (1, '奶奶，天冷了记得加衣裳，周末我尽量回来看您。', 0, 0, 7, 40),
]

# 情绪记录种子：为对话摘要页提供数据
# 注意：1号老人（前端演示聊天的 DEMO_ELDER_ID）不种"今天"的记录——
# 今天的对话/情绪全部由真实聊天产生，避免种子假数据盖住真实数据
EMOTION_RECORD_SEED = [
    # (elder_id, emotion, reason, intensity, user_msg, ai_reply, days_ago, hour, minute)
    (1, '平和', '聊到孙女考试进步', 8, '俺孙女这次考试又进步了！',
     '哈哈，真是好孩子！您平时教得好啊。', 1, 19, 30),
    (1, '平和', '按点吃药、胃口好', 6, '吃了吃了，药没断。',
     '您记性真好，就这样按点吃，身子骨才硬朗。', 3, 15, 2),
    (1, '需关注', '腿疼不想出门', 7, '腿又疼了，懒得出门。',
     '那可不能硬扛，让家里人陪您去卫生院瞧瞧。', 4, 10, 47),
    (2, '需关注', '出现消极表达', 9, '唉，人老了，活着没啥意思。',
     '哎，您可千万别这么想！您的平安比啥都金贵，家里人可离不开您。', 0, 9, 40),
    (2, '低落', '一个人吃饭没滋味', 6, '一个人吃饭，没啥滋味。',
     '有乡音陪着您呢。明儿让村协老李来陪您下下棋？', 1, 20, 10),
    (3, '平和', '赶集买东西，心情不错', 8, '今儿个赶集去，买点新鲜的。',
     '好呀，出门慢点走，逛累了就歇歇。', 0, 7, 58),
    (9, '低落', '夜里腿抽筋睡不好', 6, '夜里腿抽筋，睡不好觉。',
     '那可难受了。喝口热牛奶，让村医给您瞧瞧？', 0, 9, 55),
]


# ==================== 初始化流程 ====================

def create_database(cursor):
    print("\n📝 正在创建数据库...")
    cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    print("✅ 数据库创建成功")


def create_tables(cursor):
    print("\n📝 正在创建表...")
    for name, ddl in TABLES.items():
        cursor.execute(f"USE {DB_NAME}")
        cursor.execute(ddl)
        print(f"  ✅ 表 {name} 创建成功")
    print("✅ 所有表创建成功")


def seed_data(cursor):
    print("\n📝 正在插入测试数据...")

    # 判断是否已有种子（幂等）
    cursor.execute(f"SELECT COUNT(*) AS c FROM {DB_NAME}.elders")
    if cursor.fetchone()['c'] > 0:
        print("  ℹ️ 已有数据，跳过种子插入")
        return

    # 老人（本轮补：写入手机号，与前端 demoStore 的 13800000001~13800000012 完全一致，
    # 这样家属/村协「添加老人」在前后端两种模式下都能校验通过）
    for (eid, name, age, dialect, living, fam, rel, risk, mood, inactive, screened, summary) in ELDER_SEED:
        last_active = datetime_ago(inactive, 16 if inactive > 0 else 9, 30 if inactive > 0 else 40)
        last_call = rel_label(inactive, 9 if inactive == 0 else 16, 40 if inactive == 0 else 30)
        cursor.execute(f"""
        INSERT INTO {DB_NAME}.elders
        (id, name, phone, age, dialect, living, family_name, relation, last_call,
         risk_level, last_active, mood, mood_summary, screened)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (eid, name, '13800000%03d' % eid, age, dialect, living, fam, rel, last_call,
              risk, last_active, mood, summary, screened))

    # 每日统计（近7天）
    for (eid, name, age, dialect, living, fam, rel, risk, mood, inactive, screened, summary) in ELDER_SEED:
        for row in build_daily_stats(eid, risk, inactive):
            cursor.execute(f"""
            INSERT INTO {DB_NAME}.activities
            (elder_id, date, rounds, duration_min, active_slot, mood, note)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, row)

    # 预警
    for (eid, kw, summ, sev, status, d_ago, hh, mm, method, note, handler) in ALERT_SEED:
        created = datetime_ago(d_ago, hh, mm)
        processed = created + timedelta(minutes=45) if status == 'processed' else None
        cursor.execute(f"""
        INSERT INTO {DB_NAME}.alerts
        (elder_id, keyword, summary, severity, status, method, handle_note, handler, processed_at, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (eid, kw, summ, sev, status, method, note, handler, processed, created))

    # 转介
    for (eid, target, status, d_ago, hh, mm) in REFERRAL_SEED:
        cursor.execute(f"""
        INSERT INTO {DB_NAME}.referrals (elder_id, target, status, created_at)
        VALUES (%s,%s,%s,%s)
        """, (eid, target, status, datetime_ago(d_ago, hh, mm)))

    # 关怀留言
    for (eid, content, conveyed, d_ago, hh, mm) in CARE_MESSAGE_SEED:
        cursor.execute(f"""
        INSERT INTO {DB_NAME}.care_messages (elder_id, content, conveyed, created_at)
        VALUES (%s,%s,%s,%s)
        """, (eid, content, conveyed, datetime_ago(d_ago, hh, mm)))

    # 情绪记录
    for (eid, emotion, reason, intensity, umsg, areply, d_ago, hh, mm) in EMOTION_RECORD_SEED:
        ts = datetime_ago(d_ago, hh, mm)
        cursor.execute(f"""
        INSERT INTO {DB_NAME}.emotion_records
        (elder_id, emotion, reason, intensity, user_message, ai_reply, date, timestamp)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """, (eid, emotion, reason, intensity, umsg, areply, ts.date(), ts))

    # 家属关系（演示：家属账号1 绑定 王桂兰、李福贵）
    for (fid, eid, rel) in [(1, 1, '孙女'), (1, 2, '女儿')]:
        cursor.execute(f"""
        INSERT INTO {DB_NAME}.family_relations (family_id, elder_id, relationship)
        VALUES (%s,%s,%s)
        """, (fid, eid, rel))

    print("  ✅ 测试数据插入成功")


def verify(cursor):
    print("\n📊 当前数据：")
    for table in ['elders', 'activities', 'emotion_records', 'alerts', 'care_messages', 'referrals', 'family_relations',
                  'user', 'health_profile', 'emergency_contact', 'elder_binding']:
        cursor.execute(f"SELECT COUNT(*) AS c FROM {DB_NAME}.`{table}`")
        print(f"  - {table}: {cursor.fetchone()['c']} 条")


def main():
    print("=" * 50)
    print("🚀 开始初始化数据库（契约对齐版）...")
    print("=" * 50)

    conn = get_admin_connection()
    cursor = conn.cursor(dictionary=True)

    try:
        create_database(cursor)
        create_tables(cursor)
        conn.commit()
        seed_data(cursor)
        conn.commit()
        verify(cursor)
        print("\n" + "=" * 50)
        print("✅ 数据库初始化完成！")
        print("=" * 50)
        print("\n现在可以运行: python app.py")
    except Exception as e:
        conn.rollback()
        print(f"\n❌ 初始化失败: {e}")
        sys.exit(1)
    finally:
        cursor.close()
        conn.close()


if __name__ == '__main__':
    main()
