"""
db_compat.py — 数据库适配层（一份代码，两种模式）
============================================================
通过环境变量 DB_MODE 切换，业务代码（app.py）完全不用改：

  DB_MODE=sqlite     → 用本地 SQLite 文件（随项目一起跑，适合一键部署/演示）
  DB_MODE=postgres   → 连 Supabase / PostgreSQL（团队共用云库）

若未设置 DB_MODE，则按 DB_HOST 自动判断：
  DB_HOST 为空或 localhost/127.0.0.1  → sqlite
  DB_HOST 是远程地址（如 Supabase）    → postgres

对外暴露：
  DBError      统一异常类型（psycopg2.Error 或 sqlite3.Error）
  get_db()     取一个连接
  release_db() 归还/关闭连接
  db_cursor()  取一个「字典行」游标（可用 row['col'] 取值）
  MODE / DB_FILE / describe()
"""

import os
import re
import sqlite3

# ==================== 模式判定 ====================

def _detect_mode():
    m = (os.getenv('DB_MODE') or '').strip().lower()
    if m in ('sqlite', 'postgres', 'postgresql'):
        return 'postgres' if m.startswith('postgres') else 'sqlite'
    host = (os.getenv('DB_HOST') or '').strip()
    if host and host.lower() not in ('localhost', '127.0.0.1', '::1'):
        return 'postgres'
    return 'sqlite'


MODE = _detect_mode()

# 安全回退：声明了 postgres 模式但环境里没装 psycopg2（如沙箱/一键部署环境），
# 自动降级为 SQLite 本地库，保证服务一定能启动；降级时打印醒目日志。
if MODE == 'postgres':
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        print('=' * 60)
        print('[DB] 警告：DB_MODE=postgres 但未安装 psycopg2，')
        print('[DB] 已自动降级为 SQLite 本地模式（数据存本地文件，不连云库）。')
        print('[DB] 如需连 Supabase，请执行: pip install -r requirements-postgres.txt')
        print('=' * 60)
        MODE = 'sqlite'

DB_FILE = os.getenv('SQLITE_PATH') or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'xiangyin.db'
)


# ==================== SQLite 路径 ====================

_SQLITE_READY = False


def _sqlite_prepare():
    """首次取连接前建表 + 播种（幂等）"""
    global _SQLITE_READY
    if _SQLITE_READY:
        return
    from sqlite_backend import init_db_sqlite
    init_db_sqlite(DB_FILE)
    _SQLITE_READY = True


class _SqliteCursor:
    """把 Postgres 风格的 SQL 透明翻译给 SQLite 执行：
       - %s 占位符        → ?
       - STRING_AGG(x, s ORDER BY t) → GROUP_CONCAT(x, s)
       其余（DATE()/COALESCE/MIN/LIMIT/RETURNING/双引号表名）两边通用，不翻译。
    """

    _RE_STR_AGG = re.compile(
        r"STRING_AGG\(\s*([^,]+?)\s*,\s*('[^']*')\s+ORDER\s+BY\s+[^)]*\)",
        re.IGNORECASE,
    )

    def __init__(self, cur):
        self._cur = cur
        # 最近一次 execute 是带 RETURNING 的写语句、且结果尚未被取走
        self._pending_rows = False

    @staticmethod
    def _translate(sql):
        sql = _SqliteCursor._RE_STR_AGG.sub(
            lambda m: 'GROUP_CONCAT(%s, %s)' % (m.group(1), m.group(2)), sql
        )
        return sql.replace('%s', '?')

    def execute(self, sql, params=None):
        translated = self._translate(sql)
        if params is None:
            self._cur.execute(translated)
        else:
            self._cur.execute(translated, tuple(params))
        # SQLite 规定：带 RETURNING 的语句若结果未取完，连接不允许 commit
        self._pending_rows = 'returning' in sql.lower()
        return self

    def executemany(self, sql, seq):
        self._cur.executemany(self._translate(sql), [tuple(p) for p in seq])
        self._pending_rows = False
        return self

    def fetchone(self):
        self._pending_rows = False
        return self._cur.fetchone()

    def fetchall(self):
        self._pending_rows = False
        return self._cur.fetchall()

    def fetchmany(self, size=None):
        self._pending_rows = False
        return self._cur.fetchmany(size) if size else self._cur.fetchmany()

    def drain(self):
        """丢弃未被业务代码取走的 RETURNING 结果，保证后续 commit 能成功"""
        if self._pending_rows:
            try:
                self._cur.fetchall()
            except Exception:
                pass
            self._pending_rows = False

    # 其余属性/方法直接透传（rowcount / close / description …）
    def __getattr__(self, name):
        return getattr(self._cur, name)


class _SqliteConn:
    """SQLite 连接包装：commit/rollback 前先清掉挂起的 RETURNING 结果"""

    def __init__(self, raw):
        self._raw = raw
        self._cursors = []

    def cursor(self, *args, **kwargs):
        cur = _SqliteCursor(self._raw.cursor())
        self._cursors.append(cur)
        return cur

    def _drain_all(self):
        for c in self._cursors:
            c.drain()

    def commit(self):
        self._drain_all()
        self._raw.commit()

    def rollback(self):
        self._drain_all()
        self._raw.rollback()

    def close(self):
        try:
            self._raw.close()
        except Exception:
            pass

    def __getattr__(self, name):
        return getattr(self._raw, name)


if MODE == 'sqlite':
    from datetime import datetime as _dt
    from datetime import date as _date

    DBError = sqlite3.Error

    # 写入：date/datetime → ISO 文本
    sqlite3.register_adapter(_date, lambda d: d.isoformat())
    sqlite3.register_adapter(_dt, lambda dt: dt.strftime('%Y-%m-%d %H:%M:%S'))

    # 读取：按列的声明类型还原为 date/datetime 对象
    def _conv_datetime(s):
        s = s.decode() if isinstance(s, bytes) else s
        try:
            return _dt.strptime(s[:19], '%Y-%m-%d %H:%M:%S')
        except ValueError:
            return _dt.strptime(s[:10], '%Y-%m-%d')

    def _conv_date(s):
        s = s.decode() if isinstance(s, bytes) else s
        return _dt.strptime(s[:10], '%Y-%m-%d').date()

    sqlite3.register_converter('DATETIME', _conv_datetime)
    sqlite3.register_converter('TIMESTAMP', _conv_datetime)
    sqlite3.register_converter('DATE', _conv_date)


# ==================== PostgreSQL 路径 ====================

else:
    try:
        import psycopg2
        import psycopg2.extras
        from psycopg2 import pool as pg_pool
    except ImportError:      # 没装驱动时给出明确指引
        raise SystemExit(
            '[ERROR] 当前是 postgres 模式，但未安装 psycopg2。\n'
            '        请执行：pip install -r requirements-postgres.txt\n'
            '        （或把 .env 里的 DB_MODE 改成 sqlite 走本地文件库）'
        )

    DBError = psycopg2.Error

    _DB_CFG = {
        'host': os.getenv('DB_HOST'),
        'user': os.getenv('DB_USER'),
        'password': os.getenv('DB_PASSWORD'),
        'dbname': os.getenv('DB_NAME', 'postgres'),
        'port': int(os.getenv('DB_PORT', 5432)),
        'sslmode': os.getenv('DB_SSLMODE', 'require'),
    }

    try:
        _pool = pg_pool.SimpleConnectionPool(1, 10, **_DB_CFG)
    except Exception as _e:      # 启动时不可达：不崩溃，由接口报错
        print('[WARN] 数据库连接池初始化失败: %s' % _e)
        _pool = None


# ==================== 统一接口 ====================

def get_db():
    """取一个连接（sqlite：新连接；postgres：从池里取）"""
    if MODE == 'sqlite':
        _sqlite_prepare()
        conn = sqlite3.connect(DB_FILE, detect_types=sqlite3.PARSE_DECLTYPES)
        conn.row_factory = sqlite3.Row
        return _SqliteConn(conn)
    if _pool is None:
        raise RuntimeError('数据库连接池不可用，请检查 .env 中的 DB_* 配置')
    return _pool.getconn()


def release_db(conn):
    """归还（postgres）或关闭（sqlite）连接"""
    if conn is None:
        return
    try:
        if MODE == 'sqlite':
            conn.close()
        else:
            _pool.putconn(conn)
    except Exception:
        pass


def db_cursor(conn):
    """取「字典行」游标：可用 cur.fetchone()['id'] 这样取值"""
    if MODE == 'sqlite':
        return conn.cursor()          # _SqliteConn 已返回翻译过的字典行游标
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def describe():
    """启动时打印当前数据库模式，便于排查"""
    if MODE == 'sqlite':
        return 'SQLite（本地文件：%s）' % DB_FILE
    return 'PostgreSQL（%s:%s/%s）' % (
        os.getenv('DB_HOST'), os.getenv('DB_PORT', 5432), os.getenv('DB_NAME', 'postgres')
    )
