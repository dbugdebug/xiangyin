"""SQLite local adapter and PostgreSQL/Cloudflare Hyperdrive adapter."""
import os
import re
import sqlite3
from datetime import date as _date, datetime as _dt

MODE = (os.getenv('DB_MODE') or ('postgres' if os.getenv('DB_HOST') else 'sqlite')).strip().lower()
MODE = 'postgres' if MODE.startswith('postgres') else 'sqlite'
DB_FILE = os.getenv('SQLITE_PATH') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'xiangyin.db')


class _WorkerPgCursor:
    """pg8000 cursor adapter that provides the dict rows expected by app.py."""
    def __init__(self, cursor): self._cur = cursor
    def execute(self, sql, params=None): self._cur.execute(sql, params or ()); return self
    def executemany(self, sql, seq): self._cur.executemany(sql, seq); return self
    def _row(self, row): return dict(zip([col[0] for col in self._cur.description], row)) if row is not None else None
    def fetchone(self): return self._row(self._cur.fetchone())
    def fetchall(self): return [self._row(row) for row in self._cur.fetchall()]
    def fetchmany(self, size=None): return [self._row(row) for row in (self._cur.fetchmany(size) if size else self._cur.fetchmany())]
    def __getattr__(self, name): return getattr(self._cur, name)


class _WorkerPgConn:
    def __init__(self, raw): self._raw = raw
    def cursor(self, *args, **kwargs): return _WorkerPgCursor(self._raw.cursor())
    def __getattr__(self, name): return getattr(self._raw, name)

if MODE == 'sqlite':
    DBError = sqlite3.Error
    sqlite3.register_adapter(_date, lambda d: d.isoformat())
    sqlite3.register_adapter(_dt, lambda dt: dt.strftime('%Y-%m-%d %H:%M:%S'))
    def _conv_datetime(s):
        s = s.decode() if isinstance(s, bytes) else s
        try: return _dt.strptime(s[:19], '%Y-%m-%d %H:%M:%S')
        except ValueError: return _dt.strptime(s[:10], '%Y-%m-%d')
    def _conv_date(s):
        s = s.decode() if isinstance(s, bytes) else s
        return _dt.strptime(s[:10], '%Y-%m-%d').date()
    sqlite3.register_converter('DATETIME', _conv_datetime)
    sqlite3.register_converter('TIMESTAMP', _conv_datetime)
    sqlite3.register_converter('DATE', _conv_date)

    class _SqliteCursor:
        _RE_STR_AGG = re.compile(r"STRING_AGG\(\s*([^,]+?)\s*,\s*('[^']*')\s+ORDER\s+BY\s+[^)]*\)", re.I)
        def __init__(self, cur): self._cur, self._pending = cur, False
        def execute(self, sql, params=None):
            sql = self._RE_STR_AGG.sub(lambda m: 'GROUP_CONCAT(%s, %s)' % (m.group(1), m.group(2)), sql).replace('%s', '?')
            self._cur.execute(sql, tuple(params or ())); self._pending = 'returning' in sql.lower(); return self
        def executemany(self, sql, seq):
            self._cur.executemany(sql.replace('%s', '?'), [tuple(p) for p in seq]); return self
        def fetchone(self): self._pending = False; return self._cur.fetchone()
        def fetchall(self): self._pending = False; return self._cur.fetchall()
        def fetchmany(self, size=None): self._pending = False; return self._cur.fetchmany(size) if size else self._cur.fetchmany()
        def drain(self):
            if self._pending:
                try: self._cur.fetchall()
                except Exception: pass
                self._pending = False
        def __getattr__(self, name): return getattr(self._cur, name)

    class _SqliteConn:
        def __init__(self, raw): self._raw, self._cursors = raw, []
        def cursor(self, *args, **kwargs):
            cur = _SqliteCursor(self._raw.cursor()); self._cursors.append(cur); return cur
        def commit(self):
            for cur in self._cursors: cur.drain()
            self._raw.commit()
        def rollback(self):
            for cur in self._cursors: cur.drain()
            self._raw.rollback()
        def close(self): self._raw.close()
        def __getattr__(self, name): return getattr(self._raw, name)
else:
    try:
        import pg8000.dbapi as pg8000
    except ImportError as exc:
        raise RuntimeError('DB_MODE=postgres requires pg8000; refusing to fall back to ephemeral SQLite') from exc
    DBError = pg8000.Error

    class _PgCursor:
        def __init__(self, cursor): self._cur = cursor
        def execute(self, sql, params=None): self._cur.execute(sql, params or ()); return self
        def executemany(self, sql, seq): self._cur.executemany(sql, seq); return self
        def _row(self, row): return dict(zip([col[0] for col in self._cur.description], row)) if row is not None else None
        def fetchone(self): return self._row(self._cur.fetchone())
        def fetchall(self): return [self._row(row) for row in self._cur.fetchall()]
        def fetchmany(self, size=None): return [self._row(row) for row in (self._cur.fetchmany(size) if size else self._cur.fetchmany())]
        def __getattr__(self, name): return getattr(self._cur, name)

    class _PgConn:
        def __init__(self, raw): self._raw = raw
        def cursor(self, *args, **kwargs): return _PgCursor(self._raw.cursor())
        def __getattr__(self, name): return getattr(self._raw, name)


def _sqlite_prepare():
    from sqlite_backend import init_db_sqlite
    init_db_sqlite(DB_FILE)


def get_db():
    # A Python Worker exposes vars and service bindings on each request's WSGI environ,
    # not reliably through os.environ at module import time. Check it before local mode.
    worker_env = None
    try:
        from flask import request, has_request_context
        worker_env = request.environ.get('workers.env') if has_request_context() else None
    except Exception:
        pass
    if worker_env is not None:
        binding = getattr(worker_env, 'HYPERDRIVE', None)
        if binding is None:
            raise RuntimeError('Cloudflare Worker is missing HYPERDRIVE binding; refusing to use ephemeral SQLite')
        import pg8000.dbapi as pg8000
        return _WorkerPgConn(pg8000.connect(
            host=binding.host, port=int(binding.port), user=binding.user,
            password=binding.password, database=binding.database,
            ssl_context=False, timeout=15,
        ))
    if MODE == 'sqlite':
        _sqlite_prepare()
        conn = sqlite3.connect(DB_FILE, detect_types=sqlite3.PARSE_DECLTYPES)
        conn.row_factory = sqlite3.Row
        return _SqliteConn(conn)
    host, port = os.getenv('DB_HOST'), os.getenv('DB_PORT', 5432)
    user, password = os.getenv('DB_USER'), os.getenv('DB_PASSWORD')
    database = os.getenv('DB_NAME', 'postgres')
    if not all((host, user, password, database)):
        raise RuntimeError('Missing DB_* config; refusing to fall back to SQLite')
    raw = pg8000.connect(host=host, port=int(port), user=user, password=password,
                         database=database,
                         ssl_context=(os.getenv('DB_SSLMODE', 'require').lower() == 'require'),
                         timeout=15)
    return _PgConn(raw)


def release_db(conn):
    if conn is not None:
        try: conn.close()
        except Exception: pass


def db_cursor(conn):
    return conn.cursor()


def describe():
    if MODE == 'sqlite':
        return 'SQLite local (%s); Cloudflare requests use the HYPERDRIVE binding' % DB_FILE
    return 'PostgreSQL (Cloudflare Hyperdrive or local DB_* config)'
