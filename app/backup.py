"""Daily SQLite snapshots in DEVTRACK_BACKUP_DIR (a host folder), with restore."""

import os
import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from .db import DB_PATH

BACKUP_DIR = Path(os.environ.get("DEVTRACK_BACKUP_DIR", "/backups"))
KEEP = max(1, int(os.environ.get("DEVTRACK_BACKUP_KEEP", "14")))
EVERY = timedelta(hours=float(os.environ.get("DEVTRACK_BACKUP_EVERY_HOURS", "24")))
NAME_RE = re.compile(r"devtrack-(\d{8}-\d{6})(?:-([a-z-]+))?\.db")


class BackupError(RuntimeError):
    pass


def _counts(path: Path) -> dict:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("projects", "items", "notes")}
    finally:
        conn.close()


def _info(path: Path) -> dict:
    m = NAME_RE.fullmatch(path.name)
    taken = datetime.strptime(m.group(1), "%Y%m%d-%H%M%S")
    try:
        counts = _counts(path)
    except sqlite3.Error:
        counts = None
    return {"name": path.name, "taken_at": taken.isoformat(timespec="seconds"), "reason": m.group(2) or "daily",
            "size": path.stat().st_size, "counts": counts}


def _files() -> list[Path]:
    if not BACKUP_DIR.is_dir():
        return []
    return sorted((p for p in BACKUP_DIR.iterdir() if NAME_RE.fullmatch(p.name)), key=lambda p: p.name, reverse=True)


def list_backups() -> dict:
    files = _files()
    return {"dir": str(BACKUP_DIR), "host_dir": os.environ.get("DEVTRACK_BACKUP_HOST_DIR"), "keep": KEEP,
            "every_hours": EVERY.total_seconds() / 3600, "writable": _writable(),
            "backups": [_info(p) for p in files]}


def _writable() -> bool:
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        return os.access(BACKUP_DIR, os.W_OK)
    except OSError:
        return False


def _snapshot(dest: Path) -> None:
    src = sqlite3.connect(DB_PATH, timeout=10)
    out = sqlite3.connect(dest)
    try:
        src.backup(out)  # consistent copy even while the app writes (WAL)
        out.execute("PRAGMA journal_mode = DELETE")  # one self-contained file, no -wal/-shm
    finally:
        out.close()
        src.close()


def create_backup(reason: str | None = None) -> dict:
    if not _writable():
        raise BackupError(f"backup folder {BACKUP_DIR} is not writable")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"devtrack-{stamp}{'-' + reason if reason else ''}.db"
    tmp = BACKUP_DIR / (name + ".part")
    _snapshot(tmp)
    tmp.replace(BACKUP_DIR / name)
    prune()
    return _info(BACKUP_DIR / name)


def prune() -> None:
    """Keep the newest KEEP backups of each kind (daily/manual vs pre-restore)."""
    daily = [p for p in _files() if "pre-restore" not in p.name]
    safety = [p for p in _files() if "pre-restore" in p.name]
    for p in daily[KEEP:] + safety[5:]:
        p.unlink(missing_ok=True)
    keep = {p.name for p in _files()}
    for stray in BACKUP_DIR.glob("devtrack-*.db-*"):
        if stray.name.rsplit("-", 1)[0] not in keep or stray.stat().st_size == 0:
            stray.unlink(missing_ok=True)


def path_of(name: str) -> Path:
    if not NAME_RE.fullmatch(name):
        raise BackupError("unknown backup")
    p = BACKUP_DIR / name
    if not p.is_file():
        raise BackupError("unknown backup")
    return p


def restore(name: str) -> dict:
    src_path = path_of(name)
    try:
        _counts(src_path)
    except sqlite3.Error as e:
        raise BackupError(f"{name} is not a readable DevTrack database: {e}") from None
    safety = create_backup("pre-restore")
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    live = sqlite3.connect(DB_PATH, timeout=30)
    try:
        src.backup(live)
    finally:
        live.close()
        src.close()
    return {"restored": name, "safety_backup": safety["name"], "counts": _counts(Path(DB_PATH))}


def due() -> bool:
    """True when the newest regular backup is older than EVERY (or there is none)."""
    for p in _files():
        if "pre-restore" in p.name:
            continue
        taken = datetime.strptime(NAME_RE.fullmatch(p.name).group(1), "%Y%m%d-%H%M%S")
        return datetime.now() - taken >= EVERY
    return True
