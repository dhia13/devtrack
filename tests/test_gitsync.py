import os
import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest

from app import gitsync, service as s

pytestmark = pytest.mark.skipif(not shutil.which("git"), reason="git not installed")


def run(repo, *args, when=None):
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x"}
    if when:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = when
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=env)


@pytest.fixture
def repos(tmp_root):
    """repos/app (a repo) and repos/multi/{api,web} (repos one level down), on main."""
    root = Path(gitsync.REPOS_ROOT)
    shutil.rmtree(root, ignore_errors=True)
    made = {}
    for rel in ("app", "multi/api", "multi/web"):
        r = root / rel
        r.mkdir(parents=True)
        run(r, "init", "-q", "-b", "main")
        (r / "a.txt").write_text("a")
        run(r, "add", ".")
        run(r, "commit", "-q", "-m", "base")
        made[rel] = r
    return made


def commit(repo, name, when):
    (repo / name).write_text(name)
    run(repo, "add", ".")
    run(repo, "commit", "-q", "-m", name, when=when)


def test_container_path_mapping():
    assert gitsync.container_path("D:\\Work\\frub") == gitsync.REPOS_ROOT / "frub"
    assert gitsync.container_path("d:/work/pc 3d viewer") == gitsync.REPOS_ROOT / "pc 3d viewer"
    assert gitsync.container_path("C:\\Other\\x") is None
    assert gitsync.container_path(None) is None


def test_project_repos_one_level_down(repos):
    assert gitsync.project_repos("D:\\Work\\app") == [repos["app"]]
    assert gitsync.project_repos("D:\\Work\\multi") == [repos["multi/api"], repos["multi/web"]]


def test_branch_status_counts_ahead_and_early_commits(repos):
    r = repos["app"]
    run(r, "switch", "-q", "-c", "feat/x")
    submit = (date.today() + timedelta(days=3)).isoformat()
    commit(r, "one", "2026-01-01T10:00:00")
    commit(r, "two", f"{submit}T10:00:00")
    st = gitsync.branch_status(r, "feat/x", "main (some note)", submit)
    assert st["ahead"] == 2 and st["behind"] == 0 and st["base_ref"] == "main"
    assert st["early_commits"] == 1  # only the commit dated before submit day
    assert st["on_remote"] == 0
    assert gitsync.branch_status(r, "feat/missing", "main", None) is None


def test_sync_item_aggregates_repos_without_tokens(repos):
    for rel in ("multi/api", "multi/web"):
        run(repos[rel], "switch", "-q", "-c", "feat/y")
        commit(repos[rel], "y", "2026-01-02T10:00:00")
    s.upsert_project("multi", repo_path="D:\\Work\\multi")
    it = s.create_item("multi", "feature y", branch="feat/y", base_branch="main", status="parked", submit_on="+2d")
    out = gitsync.sync(item_id=it["id"])
    assert out["items"] == 1 and out["changed"] == []
    g = s.get_item(it["id"])["git"]
    assert g["repos"] == ["multi/api", "multi/web"] and g["ahead"] == 2 and g["early_commits"] == 2
    assert g["mr_state"] is None and g["error"] is None  # no token: MR lookup skipped quietly


def test_auto_status_from_merged_mr(repos, monkeypatch):
    s.upsert_project("app", repo_path="D:\\Work\\app")
    it = s.create_item("app", "z", branch="main", pr_url="https://github.com/o/r/pull/7", status="submitted")
    monkeypatch.setattr(gitsync, "mr_status", lambda *a: {"mr_url": "https://github.com/o/r/pull/7", "mr_state": "merged", "mr_merged_at": "2026-01-03T10:00:00Z"})
    out = gitsync.sync(item_id=it["id"])
    assert out["changed"][0]["changed"] == "merged"
    after = s.get_item(it["id"])
    assert after["status"] == "merged" and any("Git sync" in n["body"] for n in after["notes"])
    # never moves backwards
    monkeypatch.setattr(gitsync, "mr_status", lambda *a: {"mr_url": None, "mr_state": "open", "mr_merged_at": None})
    gitsync.sync(item_id=it["id"])
    assert s.get_item(it["id"])["status"] == "merged"
