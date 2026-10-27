"""Read-only git and MR/PR sync.

Repos are mounted read-only at REPOS_ROOT (the host folder DEVTRACK_REPOS_HOST). For every open
item with a branch, this finds the repo(s) holding that branch and records how far it is ahead of
its base, unpushed commits, commits dated before submit_on, and the state of its merge request
(GitLab) or pull request (GitHub). An item whose MR opens or merges moves forward to submitted /
merged, with a note. Nothing here writes to a repo; it never fetches either, so remote refs are as
fresh as the developer's last fetch.
"""

import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

from . import service as s
from .db import now, tx

REPOS_ROOT = Path(os.environ.get("DEVTRACK_REPOS_ROOT", "/repos"))
REPOS_HOST = os.environ.get("DEVTRACK_REPOS_HOST", "").replace("\\", "/").rstrip("/")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
GITLAB_TOKEN = os.environ.get("GITLAB_TOKEN", "").strip()
GITLAB_URL = os.environ.get("GITLAB_URL", "https://gitlab.com").rstrip("/")
AUTO_STATUS = os.environ.get("DEVTRACK_GIT_AUTO_STATUS", "1") not in ("0", "false", "no")

GH_PR = re.compile(r"https?://github\.com/([^/]+/[^/]+)/pull/(\d+)")
GL_MR = re.compile(r"https?://[^/]+/(.+?)/-/merge_requests/(\d+)")

TRUNKS = ("main", "master", "develop", "dev", "staging")
last_run: dict = {}


# ---------------------------------------------------------------- local git

def _git(repo: Path, *args, timeout=20) -> str:
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=timeout,
                       env={**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"})
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"git {args[0]} failed")
    return r.stdout.strip()


def _ref_ok(repo: Path, ref: str) -> bool:
    try:
        _git(repo, "rev-parse", "--verify", "--quiet", ref + "^{commit}")
        return True
    except RuntimeError:
        return False


def container_path(repo_path: str | None) -> Path | None:
    """Map a host path like D:\\Work\\frub to the read-only mount, e.g. /repos/frub."""
    if not repo_path or not REPOS_HOST:
        return None
    p = repo_path.replace("\\", "/").rstrip("/")
    if p.lower() == REPOS_HOST.lower():
        return REPOS_ROOT
    if not p.lower().startswith(REPOS_HOST.lower() + "/"):
        return None
    return REPOS_ROOT / p[len(REPOS_HOST) + 1:]


def project_repos(repo_path: str | None) -> list[Path]:
    """The repo itself, or the git repos one level below it (frub/backend, frub/admin, ...)."""
    root = container_path(repo_path)
    if not root or not root.is_dir():
        return []
    if (root / ".git").exists():
        return [root]
    return sorted(d for d in root.iterdir() if d.is_dir() and (d / ".git").exists())


def _default_branch(repo: Path) -> str:
    try:
        return _git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").removeprefix("origin/")
    except RuntimeError:
        for b in ("main", "master", "develop"):
            if _ref_ok(repo, b):
                return b
    return "main"


def _base_ref(repo: Path, base: str | None) -> str | None:
    """First word of base_branch (it is free text, e.g. "develop (ffbf9ba, ...)"), preferring origin/."""
    name = s.base_branch_name(base) or _default_branch(repo)
    for ref in (f"origin/{name}", name):
        if _ref_ok(repo, ref):
            return ref
    d = _default_branch(repo)
    for ref in (f"origin/{d}", d):
        if _ref_ok(repo, ref):
            return ref
    return None


def remote_slug(repo: Path) -> tuple[str, str] | None:
    """('github'|'gitlab', 'owner/repo') from the origin URL."""
    try:
        url = _git(repo, "remote", "get-url", "origin")
    except RuntimeError:
        return None
    m = re.match(r"(?:https?://(?:[^@/]+@)?|git@)([^/:]+)[/:](.+?)(?:\.git)?/?$", url)
    if not m:
        return None
    host, path = m.group(1).lower(), m.group(2)
    if host == "github.com":
        return "github", path
    if host == urllib.parse.urlparse(GITLAB_URL).hostname or "gitlab" in host:
        return "gitlab", path
    return None


def branch_status(repo: Path, branch: str, base: str | None, submit_on: str | None) -> dict | None:
    if not _ref_ok(repo, f"refs/heads/{branch}") and not _ref_ok(repo, f"refs/remotes/origin/{branch}"):
        return None
    head = f"refs/heads/{branch}" if _ref_ok(repo, f"refs/heads/{branch}") else f"refs/remotes/origin/{branch}"
    sha = _git(repo, "rev-parse", head)
    last = _git(repo, "log", "-1", "--format=%cI", head)
    out = {"repo": repo, "head_sha": sha[:12], "last_commit_at": last, "ahead": None, "behind": None,
           "base_ref": None, "unpushed": None, "on_remote": None, "early_commits": None}
    base_ref = _base_ref(repo, base)
    is_base = base_ref and base_ref.removeprefix("origin/") == branch
    if base_ref and not is_base:
        behind, ahead = _git(repo, "rev-list", "--left-right", "--count", f"{base_ref}...{head}").split()
        out.update(ahead=int(ahead), behind=int(behind), base_ref=base_ref)
        if submit_on and int(ahead):
            dates = _git(repo, "log", "--format=%aI", f"{base_ref}..{head}").splitlines()
            out["early_commits"] = sum(1 for d in dates if d[:10] < submit_on)
    remote = f"refs/remotes/origin/{branch}"
    if _ref_ok(repo, remote):
        out["on_remote"] = 1
        if head.startswith("refs/heads/"):
            out["unpushed"] = int(_git(repo, "rev-list", "--count", f"{remote}..{head}"))
    else:
        out["on_remote"] = 0
    return out


# ---------------------------------------------------------------- MR / PR APIs

def _get(url: str, headers: dict) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": "devtrack", **headers})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def _gh(path: str):
    h = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return _get(f"https://api.github.com/{path}", h)


def _gl(path: str):
    return _get(f"{GITLAB_URL}/api/v4/{path}", {"PRIVATE-TOKEN": GITLAB_TOKEN} if GITLAB_TOKEN else {})


def _from_gh(pr: dict) -> dict:
    state = "merged" if pr.get("merged_at") else ("draft" if pr.get("draft") and pr["state"] == "open" else pr["state"])
    return {"mr_url": pr["html_url"], "mr_state": state, "mr_merged_at": pr.get("merged_at")}


def _from_gl(mr: dict) -> dict:
    state = {"opened": "draft" if mr.get("draft") else "open", "locked": "open"}.get(mr["state"], mr["state"])
    return {"mr_url": mr["web_url"], "mr_state": state, "mr_merged_at": mr.get("merged_at")}


def mr_status(pr_url: str | None, branch: str, repos: list[Path]) -> dict:
    """State of the item's MR/PR; finds one by source branch when pr_url is empty."""
    try:
        if pr_url and (m := GH_PR.match(pr_url)):
            return _from_gh(_gh(f"repos/{m.group(1)}/pulls/{m.group(2)}")) if GITHUB_TOKEN else {}
        if pr_url and (m := GL_MR.match(pr_url)):
            if not GITLAB_TOKEN:
                return {}
            return _from_gl(_gl(f"projects/{urllib.parse.quote(m.group(1), safe='')}/merge_requests/{m.group(2)}"))
        if pr_url or branch in TRUNKS:
            return {}  # a commit link, or a trunk branch that has no MR of its own
        for repo in repos:
            rs = remote_slug(repo)
            if not rs:
                continue
            kind, slug = rs
            if not (GITHUB_TOKEN if kind == "github" else GITLAB_TOKEN):
                continue  # private repos need a token; Settings says which one is missing
            if kind == "github":
                owner = slug.split("/")[0]
                found = _gh(f"repos/{slug}/pulls?state=all&head={urllib.parse.quote(owner + ':' + branch)}")
                if found:
                    return _from_gh(found[0])
            else:
                q = urllib.parse.urlencode({"source_branch": branch, "order_by": "updated_at"})
                found = _gl(f"projects/{urllib.parse.quote(slug, safe='')}/merge_requests?{q}")
                if found:
                    return _from_gl(found[0])
        return {}
    except urllib.error.HTTPError as e:
        hint = {401: "token rejected", 403: "rate limited or no access", 404: "not found (private repo? set a token)"}.get(e.code, f"HTTP {e.code}")
        return {"error": f"MR lookup: {hint}"}
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as e:
        return {"error": f"MR lookup failed: {e}"}


# ---------------------------------------------------------------- sync

def _save(item_id: int, row: dict) -> None:
    cols = list(row)
    with tx() as conn:
        conn.execute(
            f"INSERT INTO git_status (item_id, {', '.join(cols)}) VALUES (?, {', '.join('?' * len(cols))}) "
            f"ON CONFLICT(item_id) DO UPDATE SET {', '.join(f'{c} = excluded.{c}' for c in cols)}",
            (item_id, *row.values()),
        )


def sync_item(it: dict, repos_cache: dict) -> dict:
    """Refresh one item; returns {'item_id', 'changed': status or None, ...}."""
    key = it["project"]
    if key not in repos_cache:
        with tx() as conn:
            p = conn.execute("SELECT repo_path FROM projects WHERE slug = ?", (key,)).fetchone()
        repos_cache[key] = project_repos(p["repo_path"] if p else None)
    repos = repos_cache[key]
    found, errors = [], []
    for repo in repos:
        try:
            st = branch_status(repo, it["branch"], it["base_branch"], it["submit_on"])
            if st:
                found.append(st)
        except (RuntimeError, subprocess.TimeoutExpired, ValueError) as e:
            errors.append(f"{repo.name}: {e}")
    row = {"repos": None, "head_sha": None, "last_commit_at": None, "ahead": None, "behind": None,
           "base_ref": None, "unpushed": None, "on_remote": None, "early_commits": None,
           "mr_url": None, "mr_state": None, "mr_merged_at": None, "error": None, "checked_at": now()}
    if found:
        newest = max(found, key=lambda f: f["last_commit_at"])
        row.update({k: v for k, v in newest.items() if k != "repo"})
        row["repos"] = "\n".join(str(f["repo"].relative_to(REPOS_ROOT)) for f in found)
        num = lambda k: sum(f[k] or 0 for f in found) if any(f[k] is not None for f in found) else None
        row.update(ahead=num("ahead"), unpushed=num("unpushed"), early_commits=num("early_commits"))
    elif not repos:
        errors.append("repos folder not mounted (set DEVTRACK_REPOS_HOST)" if not REPOS_HOST
                      else "no git repo at the project's repo_path")
    else:
        errors.append(f"branch not found in {', '.join(r.name for r in repos)}")
    mr = mr_status(it["pr_url"], it["branch"], [f["repo"] for f in found] or repos)
    if "error" in mr:
        errors.append(mr.pop("error"))
    row.update(mr)
    row["error"] = "; ".join(errors) or None
    _save(it["id"], row)

    changed = None
    if AUTO_STATUS and it["status"] not in s.CLOSED:
        rank, state = s.RANK[it["status"]], row["mr_state"]
        target = "merged" if state == "merged" and rank < s.RANK["merged"] else \
                 "submitted" if state in ("open", "draft") and rank < s.RANK["submitted"] and it["status"] != "blocked" else None
        fields = {}
        if not it["pr_url"] and row["mr_url"]:
            fields["pr_url"] = row["mr_url"]
        if target:
            fields["status"] = target
        if fields:
            when = (row["mr_merged_at"] or "")[:10]
            note = (f"Git sync: MR {state}{' on ' + when if when else ''}, status {it['status']} → {target}." if target
                    else f"Git sync: found the MR for {it['branch']}.") + (f" {row['mr_url']}" if row["mr_url"] else "")
            s.update_item(it["id"], note=note, author="git-sync", **fields)
            changed = target
    return {"item_id": it["id"], "changed": changed, "error": row["error"]}


def sync(project: str | None = None, item_id: int | None = None) -> dict:
    """Sync every open item with a branch (or one project / one item)."""
    started = datetime.now()
    if item_id:
        items = [s.get_item(item_id, with_notes=False)]
    else:
        items = s.list_items(project=project, limit=100_000)
    items = [i for i in items if i["branch"] and i["status"] not in (*s.CLOSED, "deployed")]
    cache, results = {}, []
    for it in items:
        try:
            results.append(sync_item(it, cache))
        except Exception as e:  # one bad repo must not stop the rest
            results.append({"item_id": it["id"], "changed": None, "error": str(e)})
    summary = {
        "started_at": started.isoformat(timespec="seconds"),
        "seconds": round((datetime.now() - started).total_seconds(), 1),
        "items": len(results),
        "changed": [r for r in results if r["changed"]],
        "errors": sum(1 for r in results if r["error"]),
    }
    if not item_id and not project:
        # drop results for items that left the sync (closed, deployed, branch cleared)
        keep = [i["id"] for i in items] or [0]
        with tx() as conn:
            conn.execute(f"DELETE FROM git_status WHERE item_id NOT IN ({', '.join('?' * len(keep))})", keep)
    if not item_id:
        last_run.clear()
        last_run.update(summary)
    return summary


def config() -> dict:
    return {
        "repos_host": REPOS_HOST or None,
        "mounted": REPOS_ROOT.is_dir() and any(REPOS_ROOT.iterdir()),
        "github_token": bool(GITHUB_TOKEN), "gitlab_token": bool(GITLAB_TOKEN), "gitlab_url": GITLAB_URL,
        "auto_status": AUTO_STATUS,
        "every_minutes": float(os.environ.get("DEVTRACK_GIT_SYNC_MINUTES", "15")),
        "last_run": last_run or None,
        "today": date.today().isoformat(),
    }
