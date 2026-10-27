"""Every setting DevTrack reads from the environment, in one place.

Values are read once, at import. docker-compose.yml passes the user-facing ones through from .env
(see .env.example); the paths inside the container rarely need changing.
"""

import os
from pathlib import Path


class ConfigError(RuntimeError):
    pass


def _str(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _num(name: str, default: float, kind=float, minimum: float | None = None):
    raw = _str(name, str(default))
    try:
        value = kind(raw)
    except ValueError:
        raise ConfigError(f"{name}={raw!r} must be a number") from None
    if minimum is not None and value < minimum:
        raise ConfigError(f"{name}={raw!r} must be at least {minimum:g}")
    return value


def _flag(name: str, default: bool) -> bool:
    return _str(name, "1" if default else "0").lower() not in ("0", "false", "no", "off")


def _list(name: str, default: str) -> list[str]:
    return [v.strip() for v in _str(name, default).split(",") if v.strip()]


# ---- storage (paths inside the container)
DB_PATH = _str("DEVTRACK_DB", "/data/devtrack.db")
SEED_PROJECTS = _list("DEVTRACK_SEED_PROJECTS", "")
DEFAULT_CURRENCY = _str("DEVTRACK_CURRENCY", "USD") or "USD"
# Invoices: who they are from (write \n between lines) and the rate for items with hours but no cost.
INVOICE_FROM = _str("DEVTRACK_INVOICE_FROM").replace("\\n", "\n")
HOURLY_RATE = _num("DEVTRACK_HOURLY_RATE", 0, minimum=0)

# ---- HTTP: host names the app answers to (blocks DNS rebinding, see README "Security")
ALLOWED_HOSTS = _list("DEVTRACK_ALLOWED_HOSTS", "localhost,127.0.0.1")
# Shared access token; empty = no login (only safe while the port is bound to localhost)
TOKEN = _str("DEVTRACK_TOKEN")
if TOKEN and len(TOKEN) < 16:
    raise ConfigError("DEVTRACK_TOKEN must be at least 16 characters (try: openssl rand -hex 24)")

# ---- backups
BACKUP_DIR = Path(_str("DEVTRACK_BACKUP_DIR", "/backups"))
BACKUP_HOST_DIR = _str("DEVTRACK_BACKUP_HOST_DIR") or None  # only shown in Settings
BACKUP_KEEP = _num("DEVTRACK_BACKUP_KEEP", 14, int, minimum=1)
BACKUP_EVERY_HOURS = _num("DEVTRACK_BACKUP_EVERY_HOURS", 24, minimum=0.1)

# ---- git sync
REPOS_ROOT = Path(_str("DEVTRACK_REPOS_ROOT", "/repos"))
REPOS_HOST = _str("DEVTRACK_REPOS_HOST").replace("\\", "/").rstrip("/")
GIT_SYNC_MINUTES = _num("DEVTRACK_GIT_SYNC_MINUTES", 15, minimum=0)  # 0 turns it off
GIT_AUTO_STATUS = _flag("DEVTRACK_GIT_AUTO_STATUS", True)
GITHUB_TOKEN = _str("GITHUB_TOKEN")
GITLAB_TOKEN = _str("GITLAB_TOKEN")
GITLAB_URL = (_str("GITLAB_URL", "https://gitlab.com") or "https://gitlab.com").rstrip("/")
