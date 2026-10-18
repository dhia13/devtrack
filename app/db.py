import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

DB_PATH = os.environ.get("DEVTRACK_DB", "/data/devtrack.db")
SEED_PROJECTS = os.environ.get("DEVTRACK_SEED_PROJECTS", "")

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
    snoozed_until  TEXT
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

# Columns added after the first release; init() adds whichever are missing.
MIGRATIONS = {
    "items": {"waiting_for": "TEXT", "snoozed_until": "TEXT"},
}


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
        for table, cols in MIGRATIONS.items():
            have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
            for col, decl in cols.items():
                if have and col not in have:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
        conn.executescript(SCHEMA)
        empty = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0
        if empty:
            ts = now()
            for slug in filter(None, (s.strip() for s in SEED_PROJECTS.split(","))):
                conn.execute(
                    "INSERT INTO projects (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (slug, slug, ts, ts),
                )
