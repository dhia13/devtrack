"""Business logic shared by the REST API and the MCP server."""

import os
import re
from datetime import date, datetime, time, timedelta

from .db import now, tx

DEFAULT_CURRENCY = os.environ.get("DEVTRACK_CURRENCY", "USD")

STATUSES = (
    "backlog", "todo", "in_progress", "blocked", "parked",
    "submitted", "merged", "deployed", "done", "cancelled",
)
# How far along the delivery pipeline a status is. "parked" = built ahead of
# schedule, waiting for its submit date (commits will need re-dating).
RANK = {
    "backlog": 0, "todo": 1, "in_progress": 2, "blocked": 2, "parked": 3,
    "submitted": 4, "merged": 5, "deployed": 6, "done": 7, "cancelled": 8,
}
CLOSED = ("done", "cancelled")
KINDS = ("feature", "bug", "chore", "task", "followup", "deploy")
ASSIGNEES = ("me", "agent")
PRIORITIES = ("urgent", "high", "normal", "low")
NOTE_KINDS = ("progress", "handoff", "decision", "blocker", "info")
PROJECT_STATUSES = ("active", "paused", "archived")

# (event type, date field, rank at which the milestone counts as reached)
MILESTONES = (
    ("submit", "submit_on", RANK["submitted"]),
    ("merge", "merge_on", RANK["merged"]),
    ("deploy", "deploy_on", RANK["deployed"]),
    ("due", "due_on", RANK["done"]),
)

TEXT_FIELDS = ("title", "description", "ticket_ref", "branch", "base_branch", "pr_url", "currency", "waiting_for")
DATE_FIELDS = ("built_on", "submit_on", "merge_on", "deploy_on", "due_on", "snoozed_until")
DATETIME_FIELDS = ("commit_date",)
NUM_FIELDS = ("estimate_hours", "actual_hours", "cost")
ENUM_FIELDS = {"kind": KINDS, "status": STATUSES, "assignee": ASSIGNEES, "priority": PRIORITIES}
ITEM_FIELDS = TEXT_FIELDS + DATE_FIELDS + DATETIME_FIELDS + NUM_FIELDS + tuple(ENUM_FIELDS)
PROJECT_FIELDS = ("name", "repo_path", "repo_url", "description", "status")

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


class NotFound(LookupError):
    pass


class Invalid(ValueError):
    pass


# ---------------------------------------------------------------- parsing

def parse_date(value) -> date:
    """ISO date, or relative: today, tomorrow, +3d, friday, next friday."""
    s = str(value).strip().lower()
    today = date.today()
    if s == "today":
        return today
    if s == "tomorrow":
        return today + timedelta(days=1)
    if m := re.fullmatch(r"\+(\d+)d", s):
        return today + timedelta(days=int(m.group(1)))
    if m := re.fullmatch(r"(next )?(" + "|".join(WEEKDAYS) + ")", s):
        ahead = (WEEKDAYS.index(m.group(2)) - today.weekday()) % 7
        if m.group(1) and ahead == 0:
            ahead = 7
        return today + timedelta(days=ahead)
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        raise Invalid(f"bad date {value!r}: use YYYY-MM-DD, today, tomorrow, +Nd or a weekday") from None


def parse_datetime(value) -> str:
    s = str(value).strip().replace(" ", "T")
    if "T" not in s:
        return datetime.combine(parse_date(s), time(9, 0)).isoformat(timespec="seconds")
    try:
        return datetime.fromisoformat(s).replace(tzinfo=None).isoformat(timespec="seconds")
    except ValueError:
        raise Invalid(f"bad datetime {value!r}: use YYYY-MM-DDTHH:MM") from None


def _clean_item(fields: dict) -> dict:
    """Validate item fields. None or "" clears a field."""
    out = {}
    for key, value in fields.items():
        if key not in ITEM_FIELDS:
            raise Invalid(f"unknown item field {key!r}")
        if isinstance(value, str):
            value = value.strip()
        if value is None or value == "":
            if key in ("title",) + tuple(ENUM_FIELDS):
                raise Invalid(f"{key} cannot be empty")
            out[key] = None
            continue
        if key in ENUM_FIELDS and value not in ENUM_FIELDS[key]:
            raise Invalid(f"{key} must be one of {', '.join(ENUM_FIELDS[key])}")
        if key in DATE_FIELDS:
            value = parse_date(value).isoformat()
        elif key in DATETIME_FIELDS:
            value = parse_datetime(value)
        elif key in NUM_FIELDS:
            try:
                value = float(value)
            except (TypeError, ValueError):
                raise Invalid(f"{key} must be a number") from None
        out[key] = value
    return out


# ---------------------------------------------------------------- shaping

def _project_dict(row) -> dict:
    return dict(row)


def _item_dict(row) -> dict:
    it = dict(row)
    today = date.today().isoformat()
    rank = RANK[it["status"]]
    pending = [
        (it[field], kind) for kind, field, reached in MILESTONES
        if it[field] and rank < reached and it["status"] != "cancelled"
    ]
    pending.sort()
    it["next_milestone"] = {"type": pending[0][1], "date": pending[0][0]} if pending else None
    it["overdue"] = bool(pending and pending[0][0] < today)
    # On hold: snoozed to a later day, or waiting on someone with no check-back date.
    # Held items drop out of "waiting on you" until the day comes.
    snooze = it.get("snoozed_until")
    it["on_hold"] = it["status"] not in CLOSED and bool((snooze and snooze > today) or (it.get("waiting_for") and not snooze))
    it["back_today"] = bool(snooze and snooze <= today and it["status"] not in CLOSED)
    git = {k[4:]: it.pop(k) for k in list(it) if k.startswith("git_")}
    it["git"] = git if git.get("checked_at") else None
    if it["git"]:
        it["git"]["repos"] = [r for r in (it["git"]["repos"] or "").splitlines() if r]
    it["needs_redate"] = bool(
        it["branch"] and rank < RANK["submitted"] and it["status"] != "cancelled" and (
            it["status"] == "parked"
            or (it["built_on"] and it["submit_on"] and it["built_on"] < it["submit_on"])
        )
    )
    return it


GIT_COLS = ("repos", "head_sha", "last_commit_at", "ahead", "behind", "base_ref", "unpushed", "on_remote",
            "early_commits", "mr_url", "mr_state", "mr_merged_at", "error", "checked_at")
ITEM_SELECT = f"""
SELECT i.*, p.slug AS project, p.name AS project_name, {", ".join(f"g.{c} AS git_{c}" for c in GIT_COLS)}
FROM items i JOIN projects p ON p.id = i.project_id
LEFT JOIN git_status g ON g.item_id = i.id
"""
# COALESCE: a NULL snooze date must count as "not held", not as NULL (NOT NULL is NULL in SQL).
HOLD_SQL = "(COALESCE(i.snoozed_until > date('now','localtime'), 0) OR (i.waiting_for IS NOT NULL AND i.snoozed_until IS NULL))"


def _sort_key(it: dict):
    closed = it["status"] in CLOSED
    nxt = it["next_milestone"]["date"] if it["next_milestone"] else "9999-12-31"
    return (closed, nxt, PRIORITIES.index(it["priority"]), -it["id"])


# ---------------------------------------------------------------- projects

def _get_project(conn, ref):
    ref = str(ref).strip()
    if ref.isdigit():
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (int(ref),)).fetchone()
    else:
        row = conn.execute("SELECT * FROM projects WHERE slug = ?", (ref.lower(),)).fetchone()
    if not row:
        raise NotFound(f"project {ref!r} not found")
    return row


def _ensure_project(conn, ref):
    try:
        return _get_project(conn, ref)
    except NotFound:
        slug = str(ref).strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", slug):
            raise Invalid(f"project slug {ref!r} must be lowercase letters, digits, . _ -") from None
        ts = now()
        conn.execute(
            "INSERT INTO projects (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (slug, slug, ts, ts),
        )
        return _get_project(conn, slug)


def list_projects(include_archived: bool = False) -> list[dict]:
    sql = """
    SELECT p.*,
      SUM(CASE WHEN i.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS open_items,
      SUM(CASE WHEN i.status NOT IN ('done','cancelled') AND i.assignee = 'me' AND NOT {hold} THEN 1 ELSE 0 END) AS my_items,
      SUM(CASE WHEN i.status NOT IN ('done','cancelled') AND {hold} THEN 1 ELSE 0 END) AS on_hold_items,
      SUM(CASE WHEN i.status = 'parked' THEN 1 ELSE 0 END) AS parked_items,
      SUM(CASE WHEN i.status NOT IN ('done','cancelled') THEN COALESCE(i.estimate_hours, 0) ELSE 0 END) AS open_estimate_hours,
      SUM(CASE WHEN i.status NOT IN ('done','cancelled') THEN COALESCE(i.cost, 0) ELSE 0 END) AS open_cost,
      (SELECT MAX(created_at) FROM notes n WHERE n.project_id = p.id) AS last_note_at
    FROM projects p LEFT JOIN items i ON i.project_id = p.id
    """
    sql = sql.replace("{hold}", HOLD_SQL)
    if not include_archived:
        sql += " WHERE p.status != 'archived'"
    sql += " GROUP BY p.id ORDER BY p.status = 'active' DESC, p.slug"
    with tx() as conn:
        return [_project_dict(r) for r in conn.execute(sql)]


def upsert_project(slug: str, **fields) -> dict:
    fields = {k: v for k, v in fields.items() if v is not None}
    bad = set(fields) - set(PROJECT_FIELDS)
    if bad:
        raise Invalid(f"unknown project fields: {', '.join(sorted(bad))}")
    if "status" in fields and fields["status"] not in PROJECT_STATUSES:
        raise Invalid(f"status must be one of {', '.join(PROJECT_STATUSES)}")
    with tx() as conn:
        p = _ensure_project(conn, slug)
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE projects SET {sets}, updated_at = ? WHERE id = ?",
                (*[(v.strip() or None) if isinstance(v, str) else v for v in fields.values()], now(), p["id"]),
            )
        return _project_dict(_get_project(conn, p["id"]))


def delete_project(ref) -> None:
    with tx() as conn:
        p = _get_project(conn, ref)
        conn.execute("DELETE FROM projects WHERE id = ?", (p["id"],))


# ---------------------------------------------------------------- items

def _fetch_item(conn, item_id: int) -> dict:
    row = conn.execute(ITEM_SELECT + " WHERE i.id = ?", (int(item_id),)).fetchone()
    if not row:
        raise NotFound(f"item #{item_id} not found")
    return _item_dict(row)


def _insert_item(conn, project_id: int, fields: dict) -> int:
    fields = _clean_item(fields)
    if not fields.get("title"):
        raise Invalid("title is required")
    fields.setdefault("currency", DEFAULT_CURRENCY)
    if fields.get("status") == "parked" and not fields.get("built_on"):
        fields["built_on"] = date.today().isoformat()
    ts = now()
    if fields.get("status") in CLOSED:
        fields["completed_at"] = ts
    cols = ["project_id", *fields, "created_at", "updated_at"]
    cur = conn.execute(
        f"INSERT INTO items ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
        (project_id, *fields.values(), ts, ts),
    )
    return cur.lastrowid


def list_items(project=None, status=None, assignee=None, kind=None,
               include_closed: bool = False, search=None, limit: int = 200) -> list[dict]:
    where, args = [], []
    if project:
        with tx() as conn:
            where.append("i.project_id = ?")
            args.append(_get_project(conn, project)["id"])
    if status:
        statuses = [s.strip() for s in str(status).split(",") if s.strip()]
        where.append(f"i.status IN ({', '.join('?' * len(statuses))})")
        args += statuses
    elif not include_closed:
        where.append("i.status NOT IN ('done','cancelled')")
    if assignee:
        where.append("i.assignee = ?")
        args.append(assignee)
    if kind:
        where.append("i.kind = ?")
        args.append(kind)
    if search:
        where.append("(i.title LIKE ? OR i.description LIKE ? OR i.branch LIKE ? OR i.ticket_ref LIKE ?)")
        args += [f"%{search}%"] * 4
    sql = ITEM_SELECT + (" WHERE " + " AND ".join(where) if where else "")
    with tx() as conn:
        items = [_item_dict(r) for r in conn.execute(sql, args)]
    items.sort(key=_sort_key)
    return items[: max(1, int(limit))]


def get_item(item_id: int, with_notes: bool = True) -> dict:
    with tx() as conn:
        it = _fetch_item(conn, item_id)
        if with_notes:
            it["notes"] = [dict(r) for r in conn.execute(
                "SELECT * FROM notes WHERE item_id = ? ORDER BY created_at DESC, id DESC", (it["id"],)
            )]
        return it


def create_item(project, title: str, **fields) -> dict:
    with tx() as conn:
        p = _ensure_project(conn, project)
        item_id = _insert_item(conn, p["id"], {"title": title, **fields})
        return _fetch_item(conn, item_id)


def update_item(item_id: int, project=None, note: str | None = None, author: str | None = None, **fields) -> dict:
    with tx() as conn:
        current = _fetch_item(conn, item_id)
        changes = _clean_item(fields)
        if project:
            changes["project_id"] = _ensure_project(conn, project)["id"]
        status = changes.get("status")
        if status and status != current["status"]:
            if status in CLOSED:
                changes["completed_at"] = now()
            elif current["status"] in CLOSED:
                changes["completed_at"] = None
            if status == "parked" and not current["built_on"] and "built_on" not in changes:
                changes["built_on"] = date.today().isoformat()
        if changes:
            sets = ", ".join(f"{k} = ?" for k in changes)
            conn.execute(
                f"UPDATE items SET {sets}, updated_at = ? WHERE id = ?",
                (*changes.values(), now(), current["id"]),
            )
        if note:
            _insert_note(conn, current["project_id"], note, "progress", current["id"], author)
        return _fetch_item(conn, current["id"])


def delete_item(item_id: int) -> None:
    with tx() as conn:
        _fetch_item(conn, item_id)
        conn.execute("DELETE FROM items WHERE id = ?", (int(item_id),))


# ---------------------------------------------------------------- notes

def _insert_note(conn, project_id, body, kind="progress", item_id=None, author=None) -> int:
    if not body or not str(body).strip():
        raise Invalid("note body is required")
    if kind not in NOTE_KINDS:
        raise Invalid(f"kind must be one of {', '.join(NOTE_KINDS)}")
    cur = conn.execute(
        "INSERT INTO notes (project_id, item_id, kind, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (project_id, item_id, kind, (author or "").strip() or None, str(body).strip(), now()),
    )
    return cur.lastrowid


def add_note(project, body: str, kind: str = "progress", item_id=None, author=None) -> dict:
    with tx() as conn:
        if item_id:
            project_id = _fetch_item(conn, item_id)["project_id"]
        else:
            if not project:
                raise Invalid("project or item_id is required")
            project_id = _ensure_project(conn, project)["id"]
        note_id = _insert_note(conn, project_id, body, kind, item_id, author)
        return dict(conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone())


def list_notes(project=None, item_id=None, kind=None, limit: int = 50) -> list[dict]:
    where, args = [], []
    with tx() as conn:
        if project:
            where.append("n.project_id = ?")
            args.append(_get_project(conn, project)["id"])
        if item_id:
            where.append("n.item_id = ?")
            args.append(int(item_id))
        if kind:
            where.append("n.kind = ?")
            args.append(kind)
        sql = """SELECT n.*, p.slug AS project, i.title AS item_title
                 FROM notes n JOIN projects p ON p.id = n.project_id
                 LEFT JOIN items i ON i.id = n.item_id"""
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY n.created_at DESC, n.id DESC LIMIT ?"
        return [dict(r) for r in conn.execute(sql, (*args, max(1, int(limit))))]


def handoff(project, summary: str, author=None, done=None, next_steps=None,
            user_todos=None, user_todo_due=None, item_id=None, item_status=None) -> dict:
    """End-of-session report: one note plus a tracked item for every user to-do."""
    done, next_steps, user_todos = list(done or []), list(next_steps or []), list(user_todos or [])
    parts = [summary.strip()]
    for heading, lines in (("Done", done), ("Next (agent)", next_steps), ("You need to", user_todos)):
        if lines:
            parts.append(f"**{heading}**\n" + "\n".join(f"- {line}" for line in lines))
    with tx() as conn:
        p = _ensure_project(conn, project)
        if item_id:
            item = _fetch_item(conn, item_id)
            if item["project_id"] != p["id"]:
                raise Invalid(f"item #{item_id} belongs to {item['project']}, not {p['slug']}")
        note_id = _insert_note(conn, p["id"], "\n\n".join(parts), "handoff", item_id, author)
        created = []
        for todo in user_todos:
            new_id = _insert_item(conn, p["id"], {
                "title": todo, "kind": "followup", "assignee": "me", "status": "todo",
                "due_on": user_todo_due, "description": f"From handoff note #{note_id}"
                + (f" by {author}" if author else "") + (f" (item #{item_id})" if item_id else ""),
            })
            created.append(_fetch_item(conn, new_id))
    if item_id and item_status:
        update_item(item_id, status=item_status)
    return {"note_id": note_id, "project": p["slug"], "created_items": created}


# ---------------------------------------------------------------- planning

def _compact(it: dict) -> dict:
    keys = ("id", "project", "title", "status", "assignee", "priority", "kind", "branch",
            "submit_on", "merge_on", "deploy_on", "due_on", "needs_redate", "pr_url",
            "waiting_for", "snoozed_until", "on_hold", "back_today")
    out = {k: it[k] for k in keys}
    g = it.get("git")
    if g:
        out["git"] = {k: g[k] for k in ("ahead", "base_ref", "on_remote", "unpushed", "early_commits", "mr_state", "mr_url", "error")}
    return out


def agenda(days: int = 7, project=None) -> dict:
    today = date.today()
    horizon = (today + timedelta(days=int(days))).isoformat()
    items = list_items(project=project, limit=10_000)
    overdue, upcoming = [], []
    for it in items:
        rank = RANK[it["status"]]
        for kind, field, reached in MILESTONES:
            d = it[field]
            if not d or rank >= reached:
                continue
            event = {"date": d, "type": kind, "item": _compact(it)}
            if d < today.isoformat():
                overdue.append(event)
            elif d <= horizon:
                upcoming.append(event)
    overdue.sort(key=lambda e: e["date"])
    upcoming.sort(key=lambda e: (e["date"], e["type"]))
    return {
        "today": today.isoformat(),
        "weekday": WEEKDAYS[today.weekday()],
        "horizon": horizon,
        "overdue": overdue,
        "upcoming": upcoming,
        "waiting_on_me": [_compact(i) for i in items if i["assignee"] == "me" and not i["on_hold"]],
        "on_hold": sorted((_compact(i) for i in items if i["on_hold"]),
                          key=lambda i: (i["snoozed_until"] or "9999-12-31", i["waiting_for"] or "")),
        "parked": [_compact(i) for i in items if i["status"] == "parked"],
        "blocked": [_compact(i) for i in items if i["status"] == "blocked"],
    }


def cost_summary(project=None) -> dict:
    items = list_items(project=project, include_closed=True, limit=100_000)
    by_project: dict[str, dict] = {}
    totals: dict[str, float] = {}
    for it in items:
        if it["status"] == "cancelled":
            continue
        row = by_project.setdefault(it["project"], {
            "project": it["project"], "items": 0, "open_estimate_hours": 0.0,
            "actual_hours": 0.0, "cost_open": {}, "cost_done": {},
        })
        row["items"] += 1
        closed = it["status"] == "done"
        if not closed:
            row["open_estimate_hours"] += it["estimate_hours"] or 0
        row["actual_hours"] += it["actual_hours"] or 0
        if it["cost"]:
            cur = it["currency"] or DEFAULT_CURRENCY
            bucket = row["cost_done" if closed else "cost_open"]
            bucket[cur] = bucket.get(cur, 0) + it["cost"]
            totals[cur] = totals.get(cur, 0) + it["cost"]
    return {"projects": sorted(by_project.values(), key=lambda r: r["project"]), "total_cost": totals}


def redate_plan(item_id: int, day=None, start: str = "09:00", end: str = "17:00",
                remote: str = "origin") -> dict:
    """Bash script that rebases the item's branch and spreads its commit dates over one day."""
    it = get_item(item_id, with_notes=False)
    if not it["branch"]:
        raise Invalid(f"item #{item_id} has no branch set")
    base = it["base_branch"] or "main"
    if day:
        target = parse_date(day)
    elif it["commit_date"]:
        cd = datetime.fromisoformat(it["commit_date"])
        target, start = cd.date(), cd.strftime("%H:%M")
    elif it["submit_on"]:
        target = date.fromisoformat(it["submit_on"])
    else:
        raise Invalid(f"item #{item_id} has no submit_on or commit_date; pass day")
    try:
        t0 = datetime.combine(target, time.fromisoformat(start)).astimezone()
        t1 = datetime.combine(target, time.fromisoformat(end)).astimezone()
    except ValueError:
        raise Invalid("start/end must be HH:MM") from None
    if t1 < t0:
        t1 = t0
    offset = t0.strftime("%z")
    s0, s1 = int(t0.timestamp()), int(t1.timestamp())
    upstream = f"{remote}/{base}"
    exec_cmd = (
        'i=$(cat "$REDATE_F"); d="$(( ' + str(s0) + ' + i * REDATE_STEP )) ' + offset + '"; '
        'GIT_COMMITTER_DATE="$d" git commit --amend --no-edit --allow-empty --date="$d" >/dev/null; '
        'echo $((i + 1)) > "$REDATE_F"'
    )
    script = "\n".join([
        f"# Item #{it['id']} {it['title']}",
        f"# Rebase {it['branch']} onto {upstream} and date its commits {target:%a %d %b %Y} "
        f"{t0:%H:%M}-{t1:%H:%M} ({offset}). Run in Git Bash from the repo root.",
        "set -euo pipefail",
        f"git fetch {remote}",
        f"git switch {it['branch']}",
        f'n=$(git rev-list --count "{upstream}..HEAD")',
        'REDATE_F=$(mktemp); echo 0 > "$REDATE_F"',
        f"REDATE_STEP=$(( n > 1 ? ({s1} - {s0}) / (n - 1) : 0 ))",
        "export REDATE_F REDATE_STEP",
        f"git rebase --force-rebase --exec '{exec_cmd}' \"{upstream}\"",
        'rm -f "$REDATE_F"',
        f'git log --format="%h  %ad  %cd  %s" --date=iso "{upstream}..HEAD"',
        f'echo "Check the dates above, then: git push --force-with-lease {remote} {it["branch"]}"',
    ])
    return {
        "item_id": it["id"], "branch": it["branch"], "base": upstream,
        "date": target.isoformat(), "window": f"{t0:%H:%M}-{t1:%H:%M} {offset}",
        "script": script,
        "after": f"Once pushed, set item #{it['id']} status to 'submitted' (and pr_url).",
    }


def export_all() -> dict:
    with tx() as conn:
        return {
            "exported_at": now(),
            "projects": [dict(r) for r in conn.execute("SELECT * FROM projects ORDER BY id")],
            "items": [dict(r) for r in conn.execute("SELECT * FROM items ORDER BY id")],
            "notes": [dict(r) for r in conn.execute("SELECT * FROM notes ORDER BY id")],
        }


def _ics_text(value: str) -> str:
    return (str(value).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\n").replace("\n", "\\n"))


def _ics_fold(line: str) -> str:
    # RFC 5545: lines longer than 75 octets continue on the next line after a space.
    out, buf = [], b""
    for ch in line:
        enc = ch.encode()
        if len(buf) + len(enc) > (75 if not out else 74):
            out.append(buf.decode())
            buf = b""
        buf += enc
    out.append(buf.decode())
    return "\r\n ".join(out)


def calendar_ics(project=None, include_closed: bool = False) -> str:
    """All-day events for every scheduled milestone, for calendar apps."""
    stamp = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DevTrack//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", "X-WR-CALNAME:DevTrack" + (f" ({project})" if project else "")]
    for it in list_items(project=project, include_closed=include_closed, limit=100_000):
        rank = RANK[it["status"]]
        for kind, field, reached in MILESTONES:
            if not it[field]:
                continue
            day = date.fromisoformat(it[field])
            done = rank >= reached and it["status"] != "cancelled"
            desc = [f"Status: {it['status']}", f"Assignee: {it['assignee']}"]
            if it["branch"]:
                desc.append(f"Branch: {it['branch']}")
            if it["pr_url"]:
                desc.append(f"PR: {it['pr_url']}")
            lines += [
                "BEGIN:VEVENT",
                f"UID:devtrack-{it['id']}-{kind}@localhost",
                f"DTSTAMP:{stamp}",
                f"DTSTART;VALUE=DATE:{day:%Y%m%d}",
                f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}",
                "SUMMARY:" + _ics_text(f"{'✓ ' if done else ''}{kind.upper()} · {it['title']} [{it['project']}]"),
                "DESCRIPTION:" + _ics_text("\n".join(desc)),
                f"CATEGORIES:{kind},{_ics_text(it['project'])}",
                "TRANSP:TRANSPARENT",
                "END:VEVENT",
            ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_ics_fold(line) for line in lines) + "\r\n"
