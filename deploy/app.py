# app.py - 乡音心伴 Flask主应用（契约对齐版 + AI集成版）
# 响应格式完全遵循前端 API-CONTRACT.md：
#   GET  → 直接返回数据本体（如 Elder[] / Stats / AlertItem[]）
#   POST → 返回 { ok: true, ... } 小对象
#   错误 → HTTP 200 + { ok: false, message: '...' }
#
# AI 能力（ai_service.py）：
#   - POST /api/chat          多轮对话：从库中带出最近10轮上下文 → 调大模型 → 保存本轮
#   - POST /api/summary/generate  AI 总结当日对话（脱敏）→ 写入 activities.note
#   - 配置 AI_BASE_URL/AI_API_KEY/AI_MODEL 即启用真实大模型，未配置自动降级 mock
#
# 用户注册（本轮新增，与前端的注册页对接）：
#   - POST /api/register      注册新账号（密码 only 存哈希、手机号唯一）
#   - GET  /api/profile       按手机号取档案（含病史/紧急联系人）供对话注入 AI 背景
#   - GET  /api/ping          健康检查（前端用它探测注册服务是否在线）
#   - 表：user / health_profile / emergency_contact（建表见 init_db.py）

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash
from datetime import datetime, timedelta
from collections import Counter
import os
import re
from dotenv import load_dotenv
from urllib.request import Request as UrlRequest, urlopen
from urllib.error import URLError, HTTPError
import json
import secrets
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

# 加载环境变量
load_dotenv()

app = Flask(__name__)
CORS(app, origins=[x.strip() for x in os.getenv('CORS_ORIGINS', '*').split(',') if x.strip()])

SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
SUPABASE_ANON_KEY = os.getenv('SUPABASE_ANON_KEY', '')
AUTH_MODE = os.getenv('AUTH_MODE', 'supabase').strip().lower()
DEMO_AUTH_SECRET = os.getenv('DEMO_AUTH_SECRET', '')
demo_token_serializer = URLSafeTimedSerializer(DEMO_AUTH_SECRET, salt='xiangyin-demo-auth') if DEMO_AUTH_SECRET else None

def authenticated_supabase_user():
    """Validate the caller's access token with Supabase Auth (never trust client role fields)."""
    token = (request.headers.get('Authorization') or '').removeprefix('Bearer ').strip()
    if AUTH_MODE == 'demo':
        if not demo_token_serializer or not token:
            return None
        try:
            claims = demo_token_serializer.loads(token, max_age=7 * 24 * 60 * 60)
            return {'id': claims['id'], 'phone': claims['phone'], 'user_metadata': claims['user_metadata']}
        except (BadSignature, SignatureExpired, KeyError, TypeError):
            return None
    if not token or not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    req = UrlRequest(f'{SUPABASE_URL}/auth/v1/user', headers={
        'apikey': SUPABASE_ANON_KEY, 'Authorization': f'Bearer {token}'
    })
    try:
        with urlopen(req, timeout=8) as response:
            return json.loads(response.read().decode('utf-8'))
    except (URLError, HTTPError, ValueError, TimeoutError):
        return None

@app.before_request
def require_authenticated_api():
    if request.method != 'OPTIONS' and request.path.startswith('/api/') and request.path not in ('/api/ping', '/api/demo-login'):
        user = authenticated_supabase_user()
        if not user:
            return jsonify({'ok': False, 'message': '登录已失效，请重新登录'}), 401
        request.supabase_user = user

# ==================== AI 服务 ====================

from ai_service import ai_service

# ==================== 配置 ====================

class Config:
    """应用配置"""
    FLASK_ENV = os.getenv('FLASK_ENV', 'development')
    DEBUG = FLASK_ENV == 'development'

    # 数据库配置
    DB_HOST = os.getenv('DB_HOST', 'localhost')
    DB_USER = os.getenv('DB_USER', 'root')
    DB_PASSWORD = os.getenv('DB_PASSWORD', '')
    DB_NAME = os.getenv('DB_NAME', 'xiangyin')
    DB_PORT = int(os.getenv('DB_PORT', 3306))

    # AI配置
    DOUYIN_API_KEY = os.getenv('DOUYIN_API_KEY', '')
    DOUYIN_API_ENDPOINT = os.getenv('DOUYIN_API_ENDPOINT', '')

app.config.from_object(Config)

# ==================== 数据库连接（适配层：SQLite / PostgreSQL 双模式） ====================
# 由 db_compat.py 统一封装，业务代码用同一套写法：
#   conn = get_db()           取连接
#   cur  = db_cursor(conn)    取「字典行」游标（row['id'] 取值）
#   release_db(conn)          归还连接
# 具体走 SQLite 还是 Supabase，由 .env 里的 DB_MODE 决定（不填则按 DB_HOST 自动判断）。

from db_compat import DBError, db_cursor, get_db, release_db, describe

print('[DB] 当前数据库模式:', describe())

# ==================== 工具函数 ====================

def error_response(message="Error"):
    """错误响应：按契约约定，HTTP 200 + { ok: false, message }"""
    return jsonify({"ok": False, "message": message})

def load_chat_history(cursor, elder_id, limit=10):
    """从数据库加载该老人最近 N 轮对话（多轮上下文，旧→新）"""
    cursor.execute("""
    SELECT user_message, ai_reply
    FROM emotion_records
    WHERE elder_id = %s
    ORDER BY timestamp DESC
    LIMIT %s
    """, (elder_id, limit))
    rows = list(reversed(cursor.fetchall()))
    history = []
    for r in rows:
        if r['user_message']:
            history.append({'role': 'user', 'content': r['user_message']})
        if r['ai_reply']:
            history.append({'role': 'assistant', 'content': r['ai_reply']})
    return history

def risk_downgrade(level):
    """风险等级下调一档：红 → 黄 → 绿（绿保持绿）"""
    return {'red': 'yellow', 'yellow': 'green', 'green': 'green'}.get(level, 'green')

def mood_score(emotion, intensity):
    """情绪文本 + 强度 → 情绪分（-2 ~ +2）"""
    mapping = {
        '开心': 2, '平和': 1, '焦虑': -1, '孤独': -1, '低落': -1, '需关注': -2,
    }
    base = mapping.get(emotion, 0)
    if base < 0 and intensity >= 8:
        return -2
    return base


def recalc_day_mood(cursor, elder_id, today):
    """重算当日平均情绪分并写回 activities.mood
    每轮对话落库后调用，保证"情绪温度计"柱子反映当天全部对话的平均心情，
    而不是被最后一轮覆盖"""
    cursor.execute(
        "SELECT emotion, intensity FROM emotion_records WHERE elder_id = %s AND date = %s",
        (elder_id, today)
    )
    rows = cursor.fetchall()
    if not rows:
        return
    avg = round(sum(mood_score(r['emotion'], r['intensity']) for r in rows) / len(rows))
    cursor.execute(
        "UPDATE activities SET mood = %s WHERE elder_id = %s AND date = %s",
        (avg, elder_id, today)
    )


def day_dominant_mood(emotions):
    """当日主导情绪：出现最多者；平票时取最新一条的情绪（最新心情更能代表当下）"""
    if not emotions:
        return None
    counts = {}
    for i, e in enumerate(emotions):
        counts.setdefault(e, []).append(i)
    best = max(counts.values(), key=lambda idxs: (len(idxs), idxs[-1]))
    return emotions[best[-1]]

def active_slot_now():
    """当前时段：上午/中午/下午/晚间"""
    h = datetime.now().hour
    if h < 12:
        return '上午'
    elif h < 14:
        return '中午'
    elif h < 18:
        return '下午'
    return '晚间'

def fmt_dt(dt):
    """DATETIME → 'YYYY-MM-DD HH:MM'
    兼容两种驱动：Postgres 返回 datetime 对象，SQLite 的聚合表达式（如 MIN(ts)）返回字符串。"""
    if not dt:
        return None
    if isinstance(dt, str):
        return dt[:16]
    return dt.strftime('%Y-%m-%d %H:%M')

def upsert_activity(cursor, elder_id, rounds, today=None, duration_min=None):
    """累计当日对话轮次/陪伴时长，并刷新老人最后活跃时间
    duration_min 未提供时按每轮约2分钟估算"""
    today = today or datetime.now().date()
    delta_min = int(duration_min) if duration_min else rounds * 2
    cursor.execute(
        "SELECT id, rounds, duration_min FROM activities WHERE elder_id = %s AND date = %s",
        (elder_id, today)
    )
    row = cursor.fetchone()
    if row:
        cursor.execute(
            "UPDATE activities SET rounds = rounds + %s, duration_min = duration_min + %s, active_slot = %s WHERE id = %s",
            (rounds, delta_min, active_slot_now(), row['id'])
        )
    else:
        cursor.execute(
            """INSERT INTO activities (elder_id, date, rounds, duration_min, active_slot, mood, note)
               VALUES (%s, %s, %s, %s, %s, 0, NULL)""",
            (elder_id, today, rounds, delta_min, active_slot_now())
        )
    now = datetime.now()
    cursor.execute(
        "UPDATE elders SET last_active = %s, last_call = %s WHERE id = %s",
        (now, '今天 %02d:%02d' % (now.hour, now.minute), elder_id)
    )

# ==================== 老人对象组装 ====================

ELDER_FIELDS = "e.id, e.name, e.age, e.dialect, e.living, e.family_name, e.relation, e.last_call, e.risk_level, e.last_active, e.mood, e.mood_summary, e.screened"

def build_elder(cursor, elder_row, today=None):
    """Elder 行 → 前端 Elder 结构（补 pending_count / days_inactive / today_active）"""
    today = today or datetime.now().date()
    eid = elder_row['id']

    cursor.execute(
        "SELECT COUNT(*) AS c FROM alerts WHERE elder_id = %s AND status = 'pending'",
        (eid,)
    )
    pending_count = cursor.fetchone()['c']

    last_active = elder_row['last_active']
    if last_active:
        days_inactive = (today - last_active.date()).days
    else:
        days_inactive = 99

    # 今日是否有过对话/活跃（由 last_active 判定，chat 与 activity 上报都会刷新它）
    today_active = bool(last_active and last_active.date() == today)

    return {
        'id': eid,
        'name': elder_row['name'],
        'age': elder_row['age'],
        'dialect': elder_row['dialect'],
        'living': elder_row['living'],
        'family_name': elder_row['family_name'],
        'relation': elder_row['relation'],
        'last_call': elder_row['last_call'],
        'risk_level': elder_row['risk_level'],
        'last_active': fmt_dt(last_active),
        'mood': elder_row['mood'],
        'mood_summary': elder_row['mood_summary'],
        'screened': bool(elder_row['screened']),
        'pending_count': pending_count,
        'days_inactive': days_inactive,
        'today_active': today_active,
    }

def build_alert(alert_row, elder_name):
    """alerts 行 → 前端 AlertItem 结构（含处置信息）"""
    processed = alert_row['status'] == 'processed'
    item = {
        'id': alert_row['id'],
        'elder_id': alert_row['elder_id'],
        'elder_name': elder_name,
        'created_at': fmt_dt(alert_row['created_at']),
        'keyword': alert_row['keyword'],
        'summary': alert_row['summary'],
        'status': '已处理' if processed else '待处理',
        'severity': alert_row['severity'],
    }
    if processed:
        item['method'] = alert_row['method'] or ''
        item['disposal'] = {
            'id': alert_row['id'],
            'alert_id': alert_row['id'],
            'method': alert_row['method'] or '',
            'note': alert_row['handle_note'] or '',
            'handler': alert_row['handler'] or '',
            'created_at': fmt_dt(alert_row['processed_at']),
        }
    return item

# ==================== API路由 ====================

# ========== 对话（核心，供老人端/AI集成使用） ==========

@app.route('/api/chat', methods=['POST'])
def chat():
    """POST /api/chat - 多轮对话（核心）
    ① 从库中带出该老人最近10轮对话作为上下文
    ② 调用大模型（未配置/不可达时自动降级 mock）
    ③ 保存本轮 user_message + ai_reply + 情绪识别结果
    ④ 命中风险时自动生成预警并置红
    """
    try:
        data = request.json or {}
        elder_id = data.get('elder_id')
        message = data.get('message')
        language = data.get('language', 'zh-CN')

        if not elder_id or not message:
            return error_response("缺少必要参数: elder_id 或 message")

        conn = get_db()
        cursor = db_cursor(conn)

        # 校验老人存在
        cursor.execute("SELECT id, name FROM elders WHERE id = %s", (elder_id,))
        if not cursor.fetchone():
            cursor.close()
            release_db(conn)
            return error_response("老人不存在")

        now = datetime.now()
        today = now.date()

        # ① 多轮上下文：库中最近对话 + 本轮新消息
        history = load_chat_history(cursor, elder_id, limit=10)
        history.append({'role': 'user', 'content': message})

        # ② 调用 AI（真实大模型或 mock 降级）
        result = ai_service.chat(history, language)

        # ③ 保存本轮对话（多次对话信息均入库）
        cursor.execute("""
        INSERT INTO emotion_records
        (elder_id, emotion, reason, intensity, user_message, ai_reply, date, timestamp, language, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (elder_id, result['emotion'], result['reason'], result['intensity'],
              message, result['reply'], today, now, language, now))

        # 累计当日活跃 + 重算当天平均情绪分
        upsert_activity(cursor, elder_id, 1, today)
        recalc_day_mood(cursor, elder_id, today)

        # 更新老人当前情绪标签
        new_mood = '需关注' if result['risk'] else result['emotion']
        cursor.execute(
            "UPDATE elders SET mood = %s WHERE id = %s", (new_mood, elder_id)
        )

        # ④ 风险联动：生成预警 + 置红
        alert_id = None
        if result['risk']:
            summary = (result['reply'][:60] or f"识别到{result['emotion']}情绪")
            cursor.execute("""
            INSERT INTO alerts (elder_id, keyword, summary, status, severity, created_at)
            VALUES (%s, %s, %s, 'pending', 'high', %s)
            RETURNING id
            """, (elder_id, result['reason'], summary, now))
            alert_id = cursor.fetchone()['id']
            cursor.execute(
                "UPDATE elders SET risk_level = 'red' WHERE id = %s", (elder_id,)
            )

        conn.commit()
        cursor.close()
        release_db(conn)

        resp = {
            'ok': True,
            'emotion': result['emotion'],
            'reason': result['reason'],
            'intensity': result['intensity'],
            'ai_reply': result['reply'],
            'timestamp': now.isoformat(),
            'risk': result['risk'],
            'offline': result['offline'],  # true=本地mock回复（大模型不可达）
        }
        if alert_id:
            resp['alert_id'] = alert_id
        return jsonify(resp)

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== 全村统计 ==========

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """GET /api/stats - 全村统计（村协端顶部四个卡），返回 Stats 本体"""
    try:
        conn = get_db()
        cursor = db_cursor(conn)
        today = datetime.now().date()
        week_ago = today - timedelta(days=7)

        cursor.execute("SELECT COUNT(*) AS c FROM elders")
        total = cursor.fetchone()['c']

        cursor.execute(
            "SELECT COUNT(*) AS c FROM elders WHERE last_active >= %s", (today,)
        )
        today_active = cursor.fetchone()['c']

        cursor.execute("SELECT COUNT(*) AS c FROM alerts WHERE status = 'pending'")
        pending_alerts = cursor.fetchone()['c']

        cursor.execute(
            "SELECT COUNT(*) AS c FROM alerts WHERE created_at >= %s", (week_ago,)
        )
        weekly_new_risks = cursor.fetchone()['c']

        cursor.execute("SELECT COUNT(*) AS c FROM elders WHERE risk_level = 'red'")
        high_risk = cursor.fetchone()['c']

        cursor.close()
        release_db(conn)

        return jsonify({
            'total': total,
            'today_active': today_active,
            'pending_alerts': pending_alerts,
            'weekly_new_risks': weekly_new_risks,
            'high_risk': high_risk,
        })

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/screen-stats', methods=['GET'])
def get_screen_stats():
    """GET /api/screen-stats - 筛查统计，返回 ScreenStat 本体"""
    try:
        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute("SELECT COUNT(*) AS c FROM elders")
        total = cursor.fetchone()['c']

        cursor.execute("SELECT COUNT(*) AS c FROM elders WHERE screened = 1")
        screened = cursor.fetchone()['c']

        cursor.execute("""
        SELECT risk_level, COUNT(*) AS c FROM elders GROUP BY risk_level
        """)
        by_level = {'red': 0, 'yellow': 0, 'green': 0}
        for row in cursor.fetchall():
            by_level[row['risk_level']] = row['c']

        cursor.close()
        release_db(conn)

        return jsonify({
            'total': total,
            'screened': screened,
            'rate': round(screened / total, 2) if total else 0,
            'byLevel': by_level,
        })

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== 老人管理 ==========

@app.route('/api/elders', methods=['GET'])
def get_all_elders():
    """GET /api/elders - 老人花名册，返回 Elder[]（已按风险降序 红→黄→绿）"""
    try:
        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute(f"""
        SELECT {ELDER_FIELDS}
        FROM elders e
        ORDER BY CASE e.risk_level WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, e.id
        """)
        rows = cursor.fetchall()

        data = [build_elder(cursor, r) for r in rows]

        cursor.close()
        release_db(conn)

        return jsonify(data)

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/elders/<int:elder_id>', methods=['GET'])
def get_elder_detail(elder_id):
    """GET /api/elders/:id - 老人详情：{ elder, daily_stats }（近7天，按日期升序）"""
    try:
        conn = get_db()
        cursor = db_cursor(conn)
        today = datetime.now().date()

        cursor.execute(f"SELECT {ELDER_FIELDS} FROM elders e WHERE e.id = %s", (elder_id,))
        row = cursor.fetchone()

        if not row:
            cursor.close()
            release_db(conn)
            return error_response("老人不存在")

        elder = build_elder(cursor, row, today)

        # 近7天每日统计（按日期升序）
        cursor.execute("""
        SELECT elder_id, date, rounds, duration_min, active_slot, mood, note
        FROM activities
        WHERE elder_id = %s AND date >= %s
        ORDER BY date ASC
        """, (elder_id, today - timedelta(days=6)))

        daily_stats = [{
            'elder_id': r['elder_id'],
            'date': str(r['date']),
            'rounds': r['rounds'],
            'duration_min': r['duration_min'],
            'active_slot': r['active_slot'],
            'mood': r['mood'],
            'note': r['note'],
        } for r in cursor.fetchall()]

        cursor.close()
        release_db(conn)

        return jsonify({'elder': elder, 'daily_stats': daily_stats})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== 风险预警 ==========

@app.route('/api/alerts', methods=['GET'])
def get_alerts():
    """GET /api/alerts - 预警列表，返回 AlertItem[]（时间倒序）
    支持 ?status=待处理|已处理（也兼容 pending|processed）与 ?elder_id="""
    try:
        status = request.args.get('status')
        elder_id = request.args.get('elder_id')
        limit = int(request.args.get('limit', 100))

        conn = get_db()
        cursor = db_cursor(conn)

        query = """
        SELECT a.id, a.elder_id, e.name AS elder_name, a.created_at,
               a.keyword, a.summary, a.status, a.severity,
               a.method, a.handle_note, a.handler, a.processed_at
        FROM alerts a JOIN elders e ON a.elder_id = e.id
        WHERE 1=1
        """
        params = []

        if status:
            if status in ('待处理', 'pending'):
                query += " AND a.status = 'pending'"
            elif status in ('已处理', 'processed'):
                query += " AND a.status = 'processed'"

        if elder_id:
            query += " AND a.elder_id = %s"
            params.append(elder_id)

        query += " ORDER BY a.created_at DESC LIMIT %s"
        params.append(limit)

        cursor.execute(query, params)
        rows = cursor.fetchall()

        data = [build_alert(r, r['elder_name']) for r in rows]

        cursor.close()
        release_db(conn)

        return jsonify(data)

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/alerts/<int:alert_id>/handle', methods=['POST'])
def handle_alert(alert_id):
    """POST /api/alerts/:id/handle - 处置闭环
    ① 预警→已处理 ② 写处置记录 ③ 老人风险下调一档 ④ method含"转介"自动生成转介记录"""
    try:
        data = request.json or {}
        method = data.get('method', '电话回访')
        note = data.get('note', '')
        handler = data.get('handler', '村协管员 · 老李')

        conn = get_db()
        cursor = db_cursor(conn)
        now = datetime.now()

        cursor.execute(
            "SELECT id, elder_id FROM alerts WHERE id = %s", (alert_id,)
        )
        alert = cursor.fetchone()
        if not alert:
            cursor.close()
            release_db(conn)
            return error_response("预警不存在")

        elder_id = alert['elder_id']

        # ①② 更新预警状态并写入处置信息
        cursor.execute("""
        UPDATE alerts
        SET status = 'processed', processed_at = %s, method = %s, handle_note = %s, handler = %s
        WHERE id = %s
        """, (now, method, note, handler, alert_id))

        # ③ 老人风险下调一档
        cursor.execute("SELECT risk_level FROM elders WHERE id = %s", (elder_id,))
        elder_row = cursor.fetchone()
        new_level = risk_downgrade(elder_row['risk_level'])
        cursor.execute(
            "UPDATE elders SET risk_level = %s, mood_summary = %s WHERE id = %s",
            (new_level, f"最近一次处置：{method}（{note or '已完成跟进'}）", elder_id)
        )

        # ④ 建议转介 → 自动生成转介记录
        if '转介' in method:
            cursor.execute("""
            INSERT INTO referrals (elder_id, target, status, created_at)
            VALUES (%s, '乡镇卫生院 · 转介随访', '待跟进', %s)
            """, (elder_id, now))

        conn.commit()

        # 组装响应：完整 elder + alert
        cursor.execute(f"SELECT {ELDER_FIELDS} FROM elders e WHERE e.id = %s", (elder_id,))
        elder = build_elder(cursor, cursor.fetchone())

        cursor.execute("""
        SELECT a.*, e.name AS elder_name FROM alerts a JOIN elders e ON a.elder_id = e.id
        WHERE a.id = %s
        """, (alert_id,))
        updated = cursor.fetchone()
        alert_out = build_alert(updated, updated['elder_name'])

        cursor.close()
        release_db(conn)

        return jsonify({'ok': True, 'elder': elder, 'alert': alert_out})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/risk-report', methods=['POST'])
def report_risk():
    """POST /api/risk-report - 老人端对话命中消极表达时静默上报
    新增待处理预警 + 该老人置红 + 情绪标记"需关注"，返回 { ok: true, alert_id }"""
    try:
        data = request.json or {}
        elder_id = data.get('elder_id')
        keyword = data.get('keyword', '消极情绪表达')
        summary = data.get('summary', '')

        if not elder_id:
            return error_response("缺少必要参数: elder_id")

        conn = get_db()
        cursor = db_cursor(conn)
        now = datetime.now()

        cursor.execute("""
        INSERT INTO alerts (elder_id, keyword, summary, status, severity, created_at)
        VALUES (%s, %s, %s, 'pending', 'high', %s)
        RETURNING id
        """, (elder_id, keyword, summary, now))
        alert_id = cursor.fetchone()['id']

        cursor.execute(
            "UPDATE elders SET risk_level = 'red', mood = '需关注' WHERE id = %s",
            (elder_id,)
        )

        conn.commit()
        cursor.close()
        release_db(conn)

        return jsonify({'ok': True, 'alert_id': alert_id})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== 活跃上报 ==========

def classify_emotion(message):
    """本地情绪初筛（关键词规则）：直连模式下前端已有 AI 回复，
    后端只需轻量识别情绪入库存档，不产生额外大模型开销"""
    if any(w in message for w in ['不想活', '活着没意思', '没啥意思', '想不开', '不想活了', '解脱']):
        return '需关注', '出现危险信号表达', 10
    if any(w in message for w in ['孤独', '一个人', '没人陪我', '没人说话', '冷清']):
        return '孤独', '表达孤独感', 8
    if any(w in message for w in ['睡不着', '失眠', '焦虑', '担心', '心里闷', '发愁']):
        return '低落', '提到睡眠或担忧问题', 7
    if any(w in message for w in ['伤心', '难过', '哭', '烦', '想孩子', '想念']):
        return '低落', '提到消极的事物', 7
    if any(w in message for w in ['开心', '高兴', '快乐', '小狗', '舒服', '挺好', '不错']):
        return '开心', '提到积极的事物', 8
    return '平和', '日常对话', 5


@app.route('/api/activity', methods=['POST'])
def record_activity():
    """POST /api/activity - 老人端每轮对话上报活跃度（前端直连大模型模式的落库入口）
    基础: { elder_id, rounds }                    → 只累计轮次/时长/刷新活跃
    扩展: { elder_id, rounds, duration_min?,       → 传入对话原文时：
           user_message, ai_reply,                     ① 本地情绪初筛(或用前端传的 emotion)
           emotion?, language? }                       ② 存入 emotion_records（多轮对话存档）
                                                      ③ 更新当日 mood 与老人情绪标签
    完全向后兼容：不带 user_message 时行为与旧版一致"""
    try:
        data = request.json or {}
        elder_id = data.get('elder_id')
        rounds = int(data.get('rounds', 1) or 1)
        duration_min = data.get('duration_min')
        user_message = data.get('user_message')
        ai_reply = data.get('ai_reply')
        emotion = data.get('emotion')
        language = data.get('language', 'zh-CN')

        if not elder_id:
            return error_response("缺少参数: elder_id")

        conn = get_db()
        cursor = db_cursor(conn)

        now = datetime.now()
        today = now.date()

        # ① 对话原文落库（保存多次对话信息）
        detected = None
        if user_message and str(user_message).strip():
            detected = emotion or classify_emotion(str(user_message))[0]
            emo, reason, intensity = classify_emotion(str(user_message)) if not emotion \
                else (emotion, '前端识别', 5)
            cursor.execute("""
            INSERT INTO emotion_records
            (elder_id, emotion, reason, intensity, user_message, ai_reply, date, timestamp, language, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (elder_id, emo, reason, intensity, str(user_message),
                  str(ai_reply) if ai_reply else '', today, now, language, now))

            # ② 更新当日情绪分（全天平均）与老人情绪标签
            recalc_day_mood(cursor, elder_id, today)
            new_mood = '需关注' if emo == '需关注' else emo
            cursor.execute(
                "UPDATE elders SET mood = %s WHERE id = %s", (new_mood, elder_id)
            )

        # ③ 累计轮次/时长，刷新活跃（duration_min 缺省按每轮2分钟估算）
        upsert_activity(cursor, elder_id, rounds, today, duration_min)

        conn.commit()
        cursor.close()
        release_db(conn)

        resp = {'ok': True}
        if detected:
            resp['emotion'] = detected
        return jsonify(resp)

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== 对话摘要 ==========

@app.route('/api/summaries', methods=['GET'])
def get_summaries():
    """GET /api/summaries?elder_id=1 - 对话摘要，返回 Summary[]（脱敏气泡回放）
    summary 文案优先取当日 AI 生成的一日总结（activities.note），未生成时用模板句"""
    try:
        elder_id = request.args.get('elder_id')
        limit = int(request.args.get('limit', 20))

        if not elder_id:
            return error_response("缺少参数: elder_id")

        conn = get_db()
        cursor = db_cursor(conn)

        # 当日 AI 总结缓存表（date → note）
        cursor.execute(
            "SELECT date, note FROM activities WHERE elder_id = %s", (elder_id,)
        )
        notes = {str(r['date']): r['note'] for r in cursor.fetchall()}

        # 按天聚合（Postgres：STRING_AGG 替代 MySQL 的 GROUP_CONCAT）
        cursor.execute("""
        SELECT DATE(timestamp) AS date,
               STRING_AGG(emotion, ',' ORDER BY timestamp) AS emotions,
               STRING_AGG(user_message, '|TURN|' ORDER BY timestamp) AS user_msgs,
               STRING_AGG(ai_reply, '|TURN|' ORDER BY timestamp) AS ai_msgs,
               MIN(timestamp) AS first_ts
        FROM emotion_records
        WHERE elder_id = %s
        GROUP BY DATE(timestamp)
        ORDER BY DATE(timestamp) DESC
        LIMIT %s
        """, (elder_id, limit))

        rows = cursor.fetchall()

        summaries = []
        for i, row in enumerate(rows):
            user_messages = row['user_msgs'].split('|TURN|') if row['user_msgs'] else []
            ai_replies = row['ai_msgs'].split('|TURN|') if row['ai_msgs'] else []
            emotion_list = row['emotions'].split(',') if row['emotions'] else []

            mood = day_dominant_mood(emotion_list) if emotion_list else '无数据'
            date_str = str(row['date'])
            # 优先用 AI 生成的一日总结，其次模板句
            summary_text = notes.get(date_str) or \
                f"今天共进行了{len(user_messages)}轮对话，主要情绪为{mood}"

            turns = []
            for j in range(min(len(user_messages), len(ai_replies))):
                turns.append({'from': 'elder', 'text': user_messages[j]})
                turns.append({'from': 'ai', 'text': ai_replies[j]})
            turns = turns[:6]  # 只给脱敏的少量气泡回放

            summaries.append({
                'id': i + 1,
                'elder_id': int(elder_id),
                'time': fmt_dt(row['first_ts']),
                'mood': mood,
                'summary': summary_text,
                'turns': turns,
            })

        cursor.close()
        release_db(conn)

        return jsonify(summaries)

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/summary/generate', methods=['POST'])
def generate_daily_summary():
    """POST /api/summary/generate - AI 总结当日对话（信息总结职责的核心接口）
    body: { elder_id, date? }
    ① 取当日全部对话轮次 → ② 大模型生成一句话脱敏总结 →
    ③ 写入 activities.note（前端 daily_stats.note / summaries 摘要都会用）
    ④ 同步刷新 elders.mood_summary（家属端本周卡片）
    返回 { ok, summary, offline }"""
    try:
        data = request.json or {}
        elder_id = data.get('elder_id')
        date_str = data.get('date')
        date = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else datetime.now().date()

        if not elder_id:
            return error_response("缺少参数: elder_id")

        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute("SELECT id, name FROM elders WHERE id = %s", (elder_id,))
        elder = cursor.fetchone()
        if not elder:
            cursor.close()
            release_db(conn)
            return error_response("老人不存在")

        # 取当日全部对话（旧→新）
        cursor.execute("""
        SELECT user_message, ai_reply FROM emotion_records
        WHERE elder_id = %s AND date = %s
        ORDER BY timestamp ASC
        """, (elder_id, date))
        rows = cursor.fetchall()

        turns = []
        for r in rows:
            if r['user_message']:
                turns.append({'role': 'user', 'content': r['user_message']})
            if r['ai_reply']:
                turns.append({'role': 'assistant', 'content': r['ai_reply']})

        # 当日主导情绪
        mood = None
        if rows:
            cursor.execute("""
            SELECT emotion, COUNT(*) AS c FROM emotion_records
            WHERE elder_id = %s AND date = %s GROUP BY emotion ORDER BY c DESC LIMIT 1
            """, (elder_id, date))
            mood = cursor.fetchone()['emotion']

        # 调用大模型生成总结（不可达时自动降级规则摘要）
        summary, offline = ai_service.summarize_day(turns, elder['name'])

        # 写入 activities.note（无记录则建一条空统计行）
        cursor.execute(
            "SELECT id FROM activities WHERE elder_id = %s AND date = %s", (elder_id, date)
        )
        row = cursor.fetchone()
        if row:
            cursor.execute(
                "UPDATE activities SET note = %s WHERE id = %s", (summary, row['id'])
            )
        else:
            cursor.execute("""
            INSERT INTO activities (elder_id, date, rounds, duration_min, active_slot, mood, note)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (elder_id, date, len(turns) // 2, len(turns), active_slot_now(),
                  mood_score(mood, 5) if mood else 0, summary))

        # 家属端"本周卡片"同步刷新
        if date == datetime.now().date():
            cursor.execute(
                "UPDATE elders SET mood_summary = %s WHERE id = %s", (summary, elder_id)
            )

        conn.commit()
        cursor.close()
        release_db(conn)

        return jsonify({'ok': True, 'summary': summary, 'offline': offline})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== 家属关怀留言 ==========

@app.route('/api/care-messages', methods=['GET'])
def get_care_messages():
    """GET /api/care-messages?elder_id=1&pending=1 - 留言列表，返回 CareMessage[]"""
    try:
        elder_id = request.args.get('elder_id')
        pending = request.args.get('pending', '0')

        if not elder_id:
            return error_response("缺少参数: elder_id")

        conn = get_db()
        cursor = db_cursor(conn)

        query = "SELECT * FROM care_messages WHERE elder_id = %s"
        params = [elder_id]
        if pending == '1':
            query += " AND conveyed = 0"
        query += " ORDER BY created_at ASC"

        cursor.execute(query, params)
        rows = cursor.fetchall()

        data = [{
            'id': r['id'],
            'elder_id': r['elder_id'],
            'content': r['content'],
            'conveyed': r['conveyed'],
            'created_at': fmt_dt(r['created_at']),
        } for r in rows]

        cursor.close()
        release_db(conn)

        return jsonify(data)

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/care-message/pending', methods=['GET'])
def get_pending_care_message():
    """GET /api/care-message/pending?elder_id=1 - 待转达留言（一条）或 null"""
    try:
        elder_id = request.args.get('elder_id')

        if not elder_id:
            return error_response("缺少参数: elder_id")

        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute("""
        SELECT * FROM care_messages
        WHERE elder_id = %s AND conveyed = 0
        ORDER BY created_at ASC LIMIT 1
        """, (elder_id,))

        r = cursor.fetchone()
        cursor.close()
        release_db(conn)

        if not r:
            return jsonify(None)

        return jsonify({
            'id': r['id'],
            'elder_id': r['elder_id'],
            'content': r['content'],
            'conveyed': r['conveyed'],
            'created_at': fmt_dt(r['created_at']),
        })

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/care-messages', methods=['POST'])
@app.route('/api/care-message', methods=['POST'])
def post_care_message():
    """POST /api/care-messages（兼容单数 /api/care-message）- 家属提交关怀留言"""
    try:
        data = request.json or {}
        elder_id = data.get('elder_id')
        content = data.get('content')

        if not elder_id or not content:
            return error_response("缺少参数: elder_id 或 content")

        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute("""
        INSERT INTO care_messages (elder_id, content, conveyed, created_at)
        VALUES (%s, %s, 0, %s)
        RETURNING id
        """, (elder_id, content.strip(), datetime.now()))
        message_id = cursor.fetchone()['id']

        conn.commit()
        cursor.close()
        release_db(conn)

        return jsonify({'ok': True, 'id': message_id})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/care-messages/<int:message_id>/conveyed', methods=['POST'])
def mark_care_message_conveyed(message_id):
    """POST /api/care-messages/:id/conveyed - 标记留言已转达"""
    try:
        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute(
            "UPDATE care_messages SET conveyed = 1 WHERE id = %s",
            (message_id,)
        )
        conn.commit()
        cursor.close()
        release_db(conn)

        return jsonify({'ok': True})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== 转介记录 ==========

@app.route('/api/referrals', methods=['GET'])
def get_referrals():
    """GET /api/referrals - 转介记录，返回 Referral[]（时间倒序）"""
    try:
        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute("""
        SELECT r.id, r.elder_id, e.name AS elder_name, r.target, r.status, r.created_at
        FROM referrals r JOIN elders e ON r.elder_id = e.id
        ORDER BY r.created_at DESC
        """)
        rows = cursor.fetchall()

        data = [{
            'id': r['id'],
            'elder_id': r['elder_id'],
            'elder_name': r['elder_name'],
            'target': r['target'],
            'time': fmt_dt(r['created_at']),
            'status': r['status'],
        } for r in rows]

        cursor.close()
        release_db(conn)

        return jsonify(data)

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== 模拟外呼 ==========

@app.route('/api/mock-call', methods=['POST'])
def mock_call():
    """POST /api/mock-call - 模拟外呼（纯提示，不真实拨号）"""
    try:
        data = request.json or {}
        name = data.get('name', '家人')

        return jsonify({'ok': True, 'message': f"已模拟拨打给 {name}"})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ========== AI 状态 ==========

@app.route('/api/ai/status', methods=['GET'])
def get_ai_status():
    """GET /api/ai/status - 大模型服务状态（前端可用来显示"真模型/mock"角标）"""
    configured = ai_service.is_configured()
    available = ai_service.available() if configured else False
    return jsonify({
        'configured': configured,
        'available': available,
        'model': ai_service.model or None,
        'base_url': ai_service.base_url or None,
        'mode': 'real' if available else 'mock',
    })


# ========== 家属端补充API（后端扩展，前端契约未要求，保留备用） ==========

@app.route('/api/family/elders', methods=['GET'])
def get_family_elders():
    """GET /api/family/elders?family_id=1 - 家属查看绑定老人列表"""
    try:
        family_id = request.args.get('family_id')
        if not family_id:
            return error_response("缺少参数: family_id")

        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute(f"""
        SELECT {ELDER_FIELDS.replace('e.', 'e.')}, fr.relationship AS fr_relation
        FROM elders e
        JOIN family_relations fr ON e.id = fr.elder_id
        WHERE fr.family_id = %s
        ORDER BY CASE e.risk_level WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END
        """, (family_id,))
        rows = cursor.fetchall()

        data = []
        for r in rows:
            elder = build_elder(cursor, r)
            elder['relationship'] = r['fr_relation']
            data.append(elder)

        cursor.close()
        release_db(conn)

        return jsonify({'elders': data})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/family/elders/<int:elder_id>/trend', methods=['GET'])
def get_family_elder_trend(elder_id):
    """GET /api/family/elders/:id/trend?days=7 - 家属查看情绪趋势"""
    try:
        days = int(request.args.get('days', 7))
        days = min(max(days, 1), 30)

        conn = get_db()
        cursor = db_cursor(conn)

        cutoff = datetime.now().date() - timedelta(days=days)
        cursor.execute("""
        SELECT date, rounds, duration_min, active_slot, mood, note
        FROM activities
        WHERE elder_id = %s AND date >= %s
        ORDER BY date ASC
        """, (elder_id, cutoff))

        trend = [{
            'date': str(r['date']),
            'rounds': r['rounds'],
            'duration_min': r['duration_min'],
            'active_slot': r['active_slot'],
            'mood': r['mood'],
            'note': r['note'],
        } for r in cursor.fetchall()]

        cursor.close()
        release_db(conn)

        return jsonify({'trend': trend})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


@app.route('/api/family/notifications', methods=['GET'])
def get_family_notifications():
    """GET /api/family/notifications?family_id=1 - 家属查看通知（关联老人的预警）"""
    try:
        family_id = request.args.get('family_id')
        limit = int(request.args.get('limit', 10))

        if not family_id:
            return error_response("缺少参数: family_id")

        conn = get_db()
        cursor = db_cursor(conn)

        cursor.execute("""
        SELECT a.id, e.name AS elder_name, a.keyword, a.summary, a.severity, a.created_at
        FROM alerts a
        JOIN elders e ON a.elder_id = e.id
        JOIN family_relations fr ON e.id = fr.elder_id
        WHERE fr.family_id = %s
        ORDER BY a.created_at DESC
        LIMIT %s
        """, (family_id, limit))

        notifications = [{
            'id': r['id'],
            'elder_name': r['elder_name'],
            'type': 'emotion_alert' if r['severity'] == 'high' else 'emotion_warning',
            'title': f"{r['elder_name']}的情绪异常",
            'message': r['summary'] or f"检测到{r['keyword']}情绪，强度较高",
            'severity': r['severity'],
            'created_at': fmt_dt(r['created_at']),
            'read': False,
        } for r in cursor.fetchall()]

        cursor.close()
        release_db(conn)

        return jsonify({'notifications': notifications})

    except Exception as e:
        return error_response(f"服务器错误: {str(e)}")


# ==================== 用户注册（本轮新增，供前端注册页调用） ====================
# 与前端 src/lib/api.ts 的 registerAccount() 对接：
#   后端在线 → POST /api/register 真实入库；后端离线 → 前端自动降级本机 localStorage。
# 三张表（建表见 init_db.py，首次使用请先执行 python init_db.py）：
#   user                注册主档（密码只存哈希，绝不存明文；手机号唯一）
#   health_profile      过往病史（独立表，便于 AI 对话按需调用与将来做数据脱敏）
#   emergency_contact   紧急联系人（独立表）
#
# 注意：本组接口用 HTTP 状态码表达成败（201/400/409），前端 registerAccount 依赖
# res.ok 判断；与其它 /api/* 接口「HTTP 200 + { ok:false }」的约定不同。

PHONE_RE = re.compile(r'^1\d{10}$')

# 注册角色白名单与中文名映射（老人 / 家属 / 村协管员）
VALID_ROLES = ('elder', 'family', 'villager')
ROLE_LABEL = {'elder': '老人', 'family': '家属', 'villager': '村协管员'}

# 可发起绑定的角色（老人端不能绑别人）
BIND_ROLES = ('family', 'villager')


def normalize_role(raw):
    """角色归一化：空 → elder；非法 → None（由调用方报错）"""
    role = (raw or '').strip() or 'elder'
    return role if role in VALID_ROLES else None


def validate_register(form):
    """注册表单二次校验（前端已校验一遍，这里兜底）。返回错误文案，通过则 None"""
    name = (form.get('name') or '').strip()
    password = form.get('password') or ''
    confirm = form.get('confirm_password') or ''
    phone = (form.get('phone') or '').strip()

    if not name:
        return '请填写姓名'
    if len(name) > 20:
        return '姓名太长了'
    if len(password) < 6:
        return '密码至少 6 位'
    if password != confirm:
        return '两次输入的密码不一致'
    if not PHONE_RE.match(phone):
        return '手机号格式不正确'

    # 角色：elder / family / villager；村协管员必须填所属村镇
    role = normalize_role(form.get('role'))
    if role is None:
        return '注册角色不正确'
    if role == 'villager' and not (form.get('village') or '').strip():
        return '请填写所属村镇'

    age = form.get('age')
    if age not in (None, ''):
        try:
            if not 0 < int(age) <= 130:
                return '年龄请填 1~130 之间的数字'
        except (TypeError, ValueError):
            return '年龄请填数字'

    gender = form.get('gender')
    if gender not in (None, '', '男', '女'):
        return '性别只能选 男 / 女'

    ec_phone = (form.get('ec_phone') or '').strip()
    if ec_phone and not PHONE_RE.match(ec_phone):
        return '紧急联系人电话格式不正确'
    return None


@app.route('/api/register', methods=['POST', 'OPTIONS'])
def register():
    """POST /api/register - 注册新账号（老人 / 家属 / 村协管员）
    201 成功 / 400 校验失败 / 409 手机号已注册；密码只存哈希，病史与紧急联系人分表存。
    body: { name, password, confirm_password, phone, role?, village?, age?, gender?,
            medical_history?, ec_name?, ec_phone?, living?, address? }
    """
    if request.method == 'OPTIONS':      # CORS 预检
        return ('', 204)

    form = request.get_json(silent=True) or {}
    err = validate_register(form)
    if err:
        return jsonify({'ok': False, 'message': err}), 400

    name = form['name'].strip()
    phone = form['phone'].strip()
    role = normalize_role(form.get('role')) or 'elder'
    village = (form.get('village') or '').strip() or None
    now = datetime.now()

    conn = get_db()
    try:
        cursor = db_cursor(conn)

        # 手机号唯一：已注册则拒绝（前端提示"请直接登录"）
        cursor.execute('SELECT id FROM "user" WHERE phone = %s', (phone,))
        if cursor.fetchone():
            cursor.close()
            return jsonify({'ok': False, 'message': '该手机号已注册，请直接登录'}), 409

        cursor.execute(
            """INSERT INTO "user" (name, password_hash, phone, role, village, age, gender, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING id""",
            (
                name,
                generate_password_hash(form['password']),   # 密码只存哈希
                phone,
                role,
                village,
                int(form['age']) if form.get('age') not in (None, '') else None,
                form.get('gender') or None,
                now,
            ),
        )
        user_id = cursor.fetchone()['id']

        # 病史单独入 health_profile（有内容才写，节约一条空记录）
        med = (form.get('medical_history') or '').strip()
        if med:
            cursor.execute(
                "INSERT INTO health_profile (user_id, medical_history, updated_at) VALUES (%s, %s, %s)",
                (user_id, med, now),
            )

        # 紧急联系人单独入 emergency_contact
        ec_name = (form.get('ec_name') or '').strip()
        ec_phone = (form.get('ec_phone') or '').strip()
        if ec_name or ec_phone:
            cursor.execute(
                "INSERT INTO emergency_contact (user_id, name, phone, created_at) VALUES (%s, %s, %s, %s)",
                (user_id, ec_name, ec_phone, now),
            )

        conn.commit()
        cursor.close()
        return jsonify({
            'ok': True,
            'user_id': user_id,
            'role': role,
            'message': f'{ROLE_LABEL[role]}账号注册成功',
        }), 201

    except DBError as e:
        conn.rollback()
        return jsonify({
            'ok': False,
            'message': f'注册失败：数据库错误（{e}）——若提示表不存在，请先执行 schema.sql',
        }), 500
    finally:
        release_db(conn)


@app.route('/api/profile', methods=['GET'])
def profile():
    """GET /api/profile?phone= - 按手机号取档案（含健康背景）
    供老人端对话时注入 AI 系统提示词（前端当前用 userStore.healthBrief() 本地生成）
    """
    phone = (request.args.get('phone') or '').strip()
    if not PHONE_RE.match(phone):
        return error_response('手机号格式不正确')
    auth_phone = (request.supabase_user.get('phone') or '').strip()
    auth_phone = auth_phone[3:] if auth_phone.startswith('+86') else auth_phone
    if phone != auth_phone:
        return jsonify({'ok': False, 'message': '只能查看自己的档案'}), 403

    conn = get_db()
    try:
        cursor = db_cursor(conn)
        cursor.execute('SELECT id, name, phone, age, gender FROM "user" WHERE phone = %s', (phone,))
        row = cursor.fetchone()
        if not row:
            return error_response('未找到该用户')

        cursor.execute(
            "SELECT medical_history FROM health_profile WHERE user_id = %s ORDER BY id DESC LIMIT 1",
            (row['id'],),
        )
        med = cursor.fetchone()
        cursor.execute(
            "SELECT name, phone FROM emergency_contact WHERE user_id = %s ORDER BY id DESC LIMIT 1",
            (row['id'],),
        )
        ec = cursor.fetchone()
        cursor.close()

        return jsonify({
            'ok': True,
            'profile': {
                'name': row['name'],
                'phone': row['phone'],
                'age': row['age'],
                'gender': row['gender'],
                'medical_history': (med['medical_history'] if med else '') or '',
                'ec_name': (ec['name'] if ec else '') or '',
                'ec_phone': (ec['phone'] if ec else '') or '',
            },
        })
    finally:
        release_db(conn)


@app.route('/api/me', methods=['GET'])
def current_account():
    """Create or load the app profile for the verified Supabase phone account."""
    auth_user = request.supabase_user
    phone = (auth_user.get('phone') or '').strip()
    phone = phone[3:] if phone.startswith('+86') else phone
    if not PHONE_RE.match(phone):
        return jsonify({'ok': False, 'message': 'Supabase 账号缺少有效的中国手机号'}), 400
    metadata = auth_user.get('user_metadata') or {}
    role = normalize_role(metadata.get('role')) or 'elder'
    requested_name = str(metadata.get('name') or '').strip()[:20]
    name = requested_name or '乡音用户'
    village = str(metadata.get('village') or '').strip()[:50] or None
    conn = get_db()
    try:
        cursor = db_cursor(conn)
        cursor.execute('SELECT id, role FROM "user" WHERE phone = %s', (phone,))
        row = cursor.fetchone()
        if row:
            user_id = row['id']
            role = row['role'] or role
            cursor.execute('UPDATE "user" SET name = COALESCE(NULLIF(%s, %s), name), role = %s, village = COALESCE(village, %s) WHERE id = %s', (requested_name, '', role, village, user_id))
        else:
            cursor.execute(
                'INSERT INTO "user" (name, password_hash, phone, role, village, created_at) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id',
                (name, generate_password_hash(secrets.token_urlsafe(32)), phone, role, village, datetime.now()),
            )
            user_id = cursor.fetchone()['id']
        elder_id = None
        if role == 'elder':
            cursor.execute('SELECT id FROM elders WHERE phone = %s ORDER BY id LIMIT 1', (phone,))
            elder = cursor.fetchone()
            if elder:
                elder_id = elder['id']
            else:
                cursor.execute('INSERT INTO elders (name, age, phone, risk_level, screened) VALUES (%s, %s, %s, %s, %s) RETURNING id', (name, 70, phone, 'green', 0))
                elder_id = cursor.fetchone()['id']
        elif role == 'family':
            elder_phone = str(metadata.get('elder_phone') or '').strip()
            if not elder_phone:
                cursor.execute('SELECT elder_phone FROM elder_binding WHERE role = %s AND user_phone = %s ORDER BY created_at LIMIT 1', ('family', phone))
                prior_binding = cursor.fetchone()
                elder_phone = str(prior_binding['elder_phone'] if prior_binding else '').strip()
            if not PHONE_RE.match(elder_phone):
                conn.rollback()
                return jsonify({'ok': False, 'message': '家属账号缺少有效的老人手机号，请重新注册'}), 400
            cursor.execute('SELECT id FROM elder_binding WHERE role = %s AND user_phone = %s AND elder_phone = %s', ('family', phone, elder_phone))
            if not cursor.fetchone():
                elder, bind_error, _ = do_bind(cursor, 'family', phone, name, elder_phone)
                if bind_error:
                    conn.rollback()
                    return jsonify({'ok': False, 'message': bind_error}), 400
            cursor.execute('SELECT id FROM elders WHERE phone = %s ORDER BY id LIMIT 1', (elder_phone,))
            bound_elder = cursor.fetchone()
            elder_id = bound_elder['id'] if bound_elder else None
        conn.commit()
        cursor.close()
        return jsonify({'ok': True, 'user_id': user_id, 'role': role, 'elder_id': elder_id})
    except DBError as e:
        conn.rollback()
        return jsonify({'ok': False, 'message': f'账号初始化失败：{e}'}), 500
    finally:
        release_db(conn)


# ==================== 老人绑定（家属 / 村协管员 → 老人，单向） ====================
# 与前端 src/lib/api.ts 的 bindElder() / batchBindElders() / listBindings() 对接。
# 老人端完全无感：不通知、不弹确认，绑定只由家属/村协单向发起。

def find_elder_by_phone(cursor, phone):
    """按手机号找"已注册老人账号"，返回 {name, phone} 或 None
    ① user 表里 role='elder' 的真实注册老人；
    ② elders 在册老人库（内置 12 位演示老人，手机号 13800000001~13800000012）。
    """
    cursor.execute('SELECT name, phone FROM "user" WHERE phone = %s AND role = %s', (phone, 'elder'))
    row = cursor.fetchone()
    if row:
        return {'name': row['name'], 'phone': row['phone']}
    cursor.execute("SELECT name, phone FROM elders WHERE phone = %s", (phone,))
    row = cursor.fetchone()
    return {'name': row['name'], 'phone': row['phone']} if row else None


def do_bind(cursor, role, user_phone, user_name, elder_phone):
    """执行一次绑定校验 + 写入。返回 (elder, err, new_id)：
    elder 为老人信息（成功）或 None；err 为失败原因（成功时为 None）；
    new_id 为新绑定的自增 id（等价原 MySQL 版的 cursor.lastrowid）。"""
    if not PHONE_RE.match(elder_phone):
        return None, '手机号格式错误（需 11 位数字）', None

    elder = find_elder_by_phone(cursor, elder_phone)
    if not elder:
        return None, ('该用户不存在或不是老人账号' if role == 'family' else '手机号未注册或不是老人账号'), None

    cursor.execute(
        'SELECT id FROM elder_binding WHERE role = %s AND COALESCE(user_phone, %s) = %s AND elder_phone = %s',
        (role, '', user_phone or '', elder_phone),
    )
    if cursor.fetchone():
        return None, '该老人已在列表中，无需重复添加', None

    cursor.execute(
        """INSERT INTO elder_binding (role, user_phone, user_name, elder_phone, elder_name, created_at)
           VALUES (%s, %s, %s, %s, %s, %s)
           RETURNING id""",
        (role, user_phone or '', user_name or '', elder_phone, elder['name'], datetime.now()),
    )
    _row = cursor.fetchone()
    new_id = _row['id'] if _row else None
    return elder, None, new_id


def binding_row(row):
    """统一输出格式（与前端 ElderBinding 一一对应）"""
    return {
        'id': row['id'],
        'role': row['role'],
        'user_phone': row['user_phone'] or '',
        'user_name': row['user_name'] or '',
        'elder_name': row['elder_name'] or '',
        'elder_phone': row['elder_phone'] or '',
        'created_at': fmt_dt(row['created_at']) or '',
    }


@app.route('/api/bind-elder', methods=['POST', 'OPTIONS'])
def bind_elder():
    """POST /api/bind-elder - 单向绑定一位老人
    body: { role: family|villager, user_phone, user_name, elder_phone }
    201 成功 / 400 失败（message 即失败原因，前端直接展示）
    """
    if request.method == 'OPTIONS':
        return ('', 204)

    b = request.get_json(silent=True) or {}
    role = (b.get('role') or '').strip()
    if role not in BIND_ROLES:
        return jsonify({'ok': False, 'message': '绑定角色不正确'}), 400

    user_phone = (b.get('user_phone') or '').strip()
    user_name = (b.get('user_name') or '').strip()
    elder_phone = (b.get('elder_phone') or '').strip()
    if user_phone and not PHONE_RE.match(user_phone):
        return jsonify({'ok': False, 'message': '发起人手机号格式不正确'}), 400

    conn = get_db()
    try:
        cursor = db_cursor(conn)
        elder, err, new_id = do_bind(cursor, role, user_phone, user_name, elder_phone)
        if err:
            conn.rollback()
            return jsonify({'ok': False, 'message': err}), 400
        conn.commit()
        cursor.close()
        return jsonify({
            'ok': True,
            'id': new_id,
            'elder_name': elder['name'],
            'elder_phone': elder['phone'],
            'message': '添加成功',
        }), 201
    except DBError as e:
        conn.rollback()
        return jsonify({'ok': False, 'message': f'绑定失败：数据库错误（{e}）'}), 500
    finally:
        release_db(conn)


@app.route('/api/unbind-elder', methods=['POST', 'OPTIONS'])
def unbind_elder():
    """POST /api/unbind-elder - 解绑（body: { id } 或 { role, user_phone, elder_phone }）"""
    if request.method == 'OPTIONS':
        return ('', 204)

    b = request.get_json(silent=True) or {}
    conn = get_db()
    try:
        cursor = db_cursor(conn)
        if b.get('id'):
            cursor.execute("DELETE FROM elder_binding WHERE id = %s", (int(b['id']),))
        else:
            role = (b.get('role') or '').strip()
            elder_phone = (b.get('elder_phone') or '').strip()
            if role not in BIND_ROLES or not elder_phone:
                cursor.close()
                return jsonify({'ok': False, 'message': '缺少解绑参数（id 或 role + elder_phone）'}), 400
            cursor.execute(
                'DELETE FROM elder_binding WHERE role = %s AND COALESCE(user_phone, %s) = %s AND elder_phone = %s',
                (role, '', (b.get('user_phone') or '').strip(), elder_phone),
            )
        deleted = cursor.rowcount
        conn.commit()
        cursor.close()
        return jsonify({'ok': True, 'deleted': deleted, 'message': '已解绑'})
    finally:
        release_db(conn)


@app.route('/api/bindings', methods=['GET'])
def list_bindings():
    """GET /api/bindings?role=family&user_phone= - 我绑定的老人列表（按添加时间倒序）"""
    role = (request.args.get('role') or '').strip()
    user_phone = (request.args.get('user_phone') or '').strip()

    sql = "SELECT * FROM elder_binding WHERE 1 = 1"
    params = []
    if role:
        sql += " AND role = %s"
        params.append(role)
    if user_phone:
        sql += " AND user_phone = %s"
        params.append(user_phone)
    sql += " ORDER BY created_at DESC, id DESC"

    conn = get_db()
    try:
        cursor = db_cursor(conn)
        cursor.execute(sql, tuple(params))
        rows = cursor.fetchall()
        cursor.close()
        return jsonify([binding_row(r) for r in rows])   # GET 直接返回数据本体（契约约定）
    finally:
        release_db(conn)


@app.route('/api/bind-elders/batch', methods=['POST', 'OPTIONS'])
def batch_bind_elders():
    """POST /api/bind-elders/batch - Excel 批量绑定（逐行校验）
    body: { role, user_phone, user_name, rows: [{ name, phone }, ...] }
    返回 { ok, results: [{ row, name, phone, ok, reason }], success, failed }
    行号从 2 开始（Excel 第 1 行是表头），与前端展示一致。
    """
    if request.method == 'OPTIONS':
        return ('', 204)

    b = request.get_json(silent=True) or {}
    role = (b.get('role') or '').strip()
    if role not in BIND_ROLES:
        return jsonify({'ok': False, 'message': '绑定角色不正确'}), 400

    rows = b.get('rows') or []
    if not isinstance(rows, list) or not rows:
        return jsonify({'ok': False, 'message': '没有可导入的数据'}), 400

    user_phone = (b.get('user_phone') or '').strip()
    user_name = (b.get('user_name') or '').strip()

    results = []
    conn = get_db()
    try:
        cursor = db_cursor(conn)
        for i, r in enumerate(rows):
            name = str((r or {}).get('name') or '').strip()
            phone = str((r or {}).get('phone') or '').strip()
            item = {'row': i + 2, 'name': name, 'phone': phone, 'ok': False, 'reason': ''}

            if not phone:
                item['reason'] = '手机号为空'
            else:
                elder, err, _new_id = do_bind(cursor, role, user_phone, user_name, phone)
                if err:
                    item['reason'] = err
                else:
                    item['ok'] = True
                    item['name'] = elder['name'] or name   # 以库里注册名为准
            results.append(item)

        conn.commit()
        success = sum(1 for x in results if x['ok'])
        cursor.close()
        return jsonify({
            'ok': True,
            'results': results,
            'success': success,
            'failed': len(results) - success,
            'message': f'导入完成：成功 {success} 条，失败 {len(results) - success} 条',
        })
    except DBError as e:
        conn.rollback()
        return jsonify({'ok': False, 'message': f'批量绑定失败：数据库错误（{e}）'}), 500
    finally:
        release_db(conn)


@app.route('/api/ping', methods=['GET'])
def ping():
    """GET /api/ping - 健康检查：前端 registerAccount() 用它判断注册服务是否在线"""
    return jsonify({'ok': True, 'service': 'xiangyin'})


@app.route('/api/demo-login', methods=['POST', 'OPTIONS'])
def demo_login():
    """Development-only login: any non-empty code is accepted by the client."""
    if request.method == 'OPTIONS':
        return ('', 204)
    if AUTH_MODE != 'demo' or not demo_token_serializer:
        return jsonify({'ok': False, 'message': '演示登录未启用'}), 404
    form = request.get_json(silent=True) or {}
    phone = str(form.get('phone') or '').strip()
    role = normalize_role(form.get('role'))
    name = str(form.get('name') or '').strip()[:20]
    village = str(form.get('village') or '').strip()[:50]
    elder_phone = str(form.get('elder_phone') or '').strip()
    if not PHONE_RE.match(phone):
        return jsonify({'ok': False, 'message': '手机号格式不正确'}), 400
    code = str(form.get('code') or '').strip()
    if not code:
        return jsonify({'ok': False, 'message': '请输入验证码'}), 400
    if role is None:
        return jsonify({'ok': False, 'message': '注册角色不正确'}), 400
    if form.get('registering') and not name:
        return jsonify({'ok': False, 'message': '请填写姓名'}), 400
    if form.get('registering') and role == 'villager' and not village:
        return jsonify({'ok': False, 'message': '请填写所属村镇'}), 400
    if form.get('registering') and role == 'family' and not PHONE_RE.match(elder_phone):
        return jsonify({'ok': False, 'message': '请填写要守护的老人手机号'}), 400

    # Fake OTP is only an input gate for demos; account existence and role still
    # come from the existing user table so login cannot silently create profiles.
    conn = get_db()
    try:
        cursor = db_cursor(conn)
        cursor.execute('SELECT id, role FROM "user" WHERE phone = %s', (phone,))
        existing = cursor.fetchone()
        cursor.close()
        if form.get('registering') and existing:
            return jsonify({'ok': False, 'message': '该手机号已注册，请切换到登录'}), 409
        if not form.get('registering') and not existing:
            return jsonify({'ok': False, 'message': '该手机号尚未注册，请先注册'}), 404
        if existing and existing['role'] != role:
            return jsonify({'ok': False, 'message': '账号角色不匹配，请选择已注册的角色'}), 403
    except Exception as e:
        return jsonify({'ok': False, 'message': f'账号查询失败：{e}'}), 500
    finally:
        release_db(conn)

    claims = {
        'id': phone,
        'phone': f'+86{phone}',
        'user_metadata': {'name': name, 'role': role, 'village': village, 'elder_phone': elder_phone,
                          'registering': bool(form.get('registering'))},
    }
    token = demo_token_serializer.dumps(claims)
    return jsonify({
        'access_token': token,
        'refresh_token': token,
        'expires_at': int((datetime.now() + timedelta(days=7)).timestamp()),
        'user': {'id': phone, 'phone': f'+86{phone}', 'user_metadata': claims['user_metadata']},
    })


# ==================== 错误处理 ====================

@app.errorhandler(404)
def not_found(error):
    return error_response("接口不存在")

@app.errorhandler(500)
def server_error(error):
    return error_response("服务器内部错误")


# ==================== 前端静态托管（一体化部署） ====================
# 若存在 frontend_dist 目录（前端构建产物），由本服务一并伺服：
#   http://localhost:5000/        → 前端页面
#   http://localhost:5000/api/*   → 后端接口
# 没有该目录时此功能自动跳过，纯 API 模式照常运行。

FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frontend_dist')


@app.route('/')
def serve_index():
    if os.path.exists(os.path.join(FRONTEND_DIST, 'index.html')):
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return jsonify({'ok': True, 'message': '乡音心伴后端运行中，API 文档见 README'})


@app.route('/<path:subpath>')
def serve_static(subpath):
    # /api/* 已被上方具体路由接管，不会走到这里
    if os.path.isfile(os.path.join(FRONTEND_DIST, subpath)):
        return send_from_directory(FRONTEND_DIST, subpath)
    # SPA 路由回退：非资源路径一律返回首页
    if os.path.exists(os.path.join(FRONTEND_DIST, 'index.html')):
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return error_response('Not Found')


# ==================== 启动应用 ====================

if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5000)),
        debug=os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true')
    )
