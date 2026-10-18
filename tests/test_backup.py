import sqlite3

import pytest

from app import backup, service as s


@pytest.fixture(autouse=True)
def empty_backups():
    backup.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    for p in backup.BACKUP_DIR.iterdir():
        p.unlink()
    yield


def test_backup_is_one_self_contained_file():
    s.create_item("demo", "keep me")
    b = backup.create_backup("manual")
    assert b["counts"]["items"] == 1 and b["reason"] == "manual"
    names = sorted(p.name for p in backup.BACKUP_DIR.iterdir())
    assert names == [b["name"]]  # no -wal / -shm / .part leftovers
    mode = sqlite3.connect(backup.BACKUP_DIR / b["name"]).execute("PRAGMA journal_mode").fetchone()[0]
    assert mode == "delete"


def test_restore_round_trip_takes_safety_copy():
    s.create_item("demo", "before")
    snap = backup.create_backup()
    s.create_item("demo", "after")
    out = backup.restore(snap["name"])
    assert out["counts"]["items"] == 1
    assert [i["title"] for i in s.list_items("demo")] == ["before"]
    names = [b["name"] for b in backup.list_backups()["backups"]]
    assert out["safety_backup"] in names and "pre-restore" in out["safety_backup"]


def test_prune_keeps_newest(monkeypatch):
    monkeypatch.setattr(backup, "KEEP", 2)
    for i in range(4):
        (backup.BACKUP_DIR / f"devtrack-2026010{i + 1}-090000.db").write_bytes(b"")
    backup.prune()
    assert sorted(p.name for p in backup.BACKUP_DIR.iterdir()) == ["devtrack-20260103-090000.db", "devtrack-20260104-090000.db"]


@pytest.mark.parametrize("name", ["../devtrack.db", "devtrack.db", "devtrack-20260101-090000.db/../../x", "x.db"])
def test_bad_names_rejected(name):
    with pytest.raises(backup.BackupError):
        backup.path_of(name)


def test_due_when_none_or_old():
    assert backup.due()
    backup.create_backup()
    assert not backup.due()
