import sqlite3
from pathlib import Path

import pytest

from app import backup, db, service as s


def _legacy_db():
    """A database as the first release made it: no on-hold columns, no user_version."""
    for suffix in ("", "-wal", "-shm"):
        Path(db.DB_PATH + suffix).unlink(missing_ok=True)
    conn = sqlite3.connect(db.DB_PATH)
    later = ",\n    waiting_for    TEXT,\n    snoozed_until  TEXT,\n    repeat_every   TEXT,\n" \
            "    repeat_of      INTEGER REFERENCES items(id) ON DELETE SET NULL"
    assert later in db.SCHEMA
    schema = db.SCHEMA.replace(later, "")
    conn.executescript(schema)
    conn.execute("INSERT INTO projects (slug, name, created_at, updated_at) VALUES ('old', 'old', 'x', 'x')")
    conn.commit()
    conn.close()


def _columns(table):
    with db.tx() as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_new_database_is_at_latest_version():
    with db.tx() as conn:
        assert db.schema_version(conn) == db.SCHEMA_VERSION


def test_legacy_database_is_migrated_and_init_is_idempotent():
    _legacy_db()
    db.init()
    assert {"waiting_for", "snoozed_until", "repeat_every", "repeat_of"} <= _columns("items")
    db.init()  # running again changes nothing
    with db.tx() as conn:
        assert db.schema_version(conn) == db.SCHEMA_VERSION
    assert [p["slug"] for p in s.list_projects()] == ["old"]
    s.create_item("old", "held", waiting_for="ops")


def test_newer_database_refused():
    with db.tx() as conn:
        conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
    with pytest.raises(RuntimeError, match="newer"):
        db.init()
    with db.tx() as conn:
        conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION}")


def test_restore_refuses_snapshot_from_newer_app():
    backup.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    snap = backup.create_backup("manual")
    conn = sqlite3.connect(backup.BACKUP_DIR / snap["name"])
    conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
    conn.commit()
    conn.close()
    with pytest.raises(backup.BackupError, match="newer"):
        backup.restore(snap["name"])
