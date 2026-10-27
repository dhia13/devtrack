import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

from . import config

DB_PATH = config.DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    repo_path   TEXT,
    repo_url    TEXT,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
    id             INTEGER PRIMARY KEY,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    description    TEXT,
    kind           TEXT NOT NULL DEFAULT 'task',
    status         TEXT NOT NULL DEFAULT 'todo',
    assignee       TEXT NOT NULL DEFAULT 'agent',
    priority       TEXT NOT NULL DEFAULT 'normal',
    ticket_ref     TEXT,
    branch         TEXT,
    base_branch    TEXT,
    pr_url         TEXT,
    built_on       TEXT,
    submit_on      TEXT,
    commit_date    TEXT,
    merge_on       TEXT,
    deploy_on      TEXT,
    due_on         TEXT,
    estimate_hours REAL,
    actual_hours   REAL,
    cost           REAL,
    currency       TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    completed_at   TEXT,
    waiting_for    TEXT,
    snoozed_until  TEXT,
    repeat_every   TEXT,
    repeat_of      INTEGER REFERENCES items(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS items_project ON items(project_id);
CREATE INDEX IF NOT EXISTS items_status ON items(status);

CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_id    INTEGER REFERENCES items(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL DEFAULT 'progress',
    author     TEXT,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_project ON notes(project_id, created_at);
CREATE INDEX IF NOT EXISTS notes_item ON notes(item_id);

-- "item_id can't move until blocked_by is finished" (merged or later, or cancelled).
CREATE TABLE IF NOT EXISTS item_deps (
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    blocked_by INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, blocked_by)
);
CREATE INDEX IF NOT EXISTS item_deps_blocker ON item_deps(blocked_by);

-- Focus timer sessions (the island). item_id is optional; project_id follows the item.
CREATE TABLE IF NOT EXISTS focus_sessions (
    id         INTEGER PRIMARY KEY,
    item_id    INTEGER REFERENCES items(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    day        TEXT NOT NULL,
    started_at TEXT,
    minutes    INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS focus_day ON focus_sessions(day);

-- Last git/MR sync result per item (written by gitsync, never edited by hand).
CREATE TABLE IF NOT EXISTS git_status (
    item_id       INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    repos         TEXT,
    head_sha      TEXT,
    last_commit_at TEXT,
    ahead         INTEGER,
    behind        INTEGER,
    base_ref      TEXT,
    unpushed      INTEGER,
    on_remote     INTEGER,
    early_commits INTEGER,
    mr_url        TEXT,
    mr_state      TEXT,
    mr_merged_at  TEXT,
    error         TEXT,
    checked_at    TEXT NOT NULL
);
"""

def _add_columns(conn, table: str, cols: dict) -> None:
    have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    for col, decl in cols.items():
        if col not in have:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def _v1_on_hold(conn):
    # Databases from before versioning may or may not have these, hence _add_columns.
    _add_columns(conn, "items", {"waiting_for": "TEXT", "snoozed_until": "TEXT"})


def _v2_repeat(conn):
    _add_columns(conn, "items", {"repeat_every": "TEXT", "repeat_of": "INTEGER REFERENCES items(id) ON DELETE SET NULL"})


# Schema changes since the first release, oldest first. PRAGMA user_version records how many a
# database has had. Append new steps; never edit or reorder old ones. SCHEMA above is always the
# latest shape, so a new database skips them.
MIGRATIONS = (_v1_on_hold, _v2_repeat)
SCHEMA_VERSION = len(MIGRATIONS)


def schema_version(conn) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def tx():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init() -> None:
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    with tx() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        version = schema_version(conn)
        if version > SCHEMA_VERSION:
            raise RuntimeError(f"database schema v{version} is newer than this DevTrack (v{SCHEMA_VERSION}); update the app")
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items'").fetchone():
            for step in MIGRATIONS[version:]:
                step(conn)
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        empty = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0
        if empty:
            ts = now()
            for slug in config.SEED_PROJECTS:
                conn.execute(
                    "INSERT INTO projects (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (slug, slug, ts, ts),
                )
