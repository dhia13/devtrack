import os
import tempfile
from pathlib import Path

# The app reads its settings at import time, so point them at a scratch folder first.
_TMP = Path(tempfile.mkdtemp(prefix="devtrack-test-"))
os.environ.update({
    "DEVTRACK_DB": str(_TMP / "devtrack.db"),
    "DEVTRACK_BACKUP_DIR": str(_TMP / "backups"),
    "DEVTRACK_ALLOWED_HOSTS": "testserver,localhost",
    "DEVTRACK_GIT_SYNC_MINUTES": "0",
    "DEVTRACK_SEED_PROJECTS": "",
    "DEVTRACK_REPOS_ROOT": str(_TMP / "repos"),
    "DEVTRACK_REPOS_HOST": "D:/Work",
    "GITHUB_TOKEN": "",
    "GITLAB_TOKEN": "",
})

import pytest  # noqa: E402

from app import db  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    """Every test starts from an empty database."""
    for suffix in ("", "-wal", "-shm"):
        Path(db.DB_PATH + suffix).unlink(missing_ok=True)
    db.init()
    yield


@pytest.fixture(scope="session")
def client():
    # One client per run: the MCP session manager can only start once per process.
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def tmp_root():
    return _TMP
