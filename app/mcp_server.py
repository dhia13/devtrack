"""MCP tools exposed to coding agents at /mcp (streamable HTTP)."""

from typing import Literal

from mcp.server.fastmcp import FastMCP

from . import gitsync, service as s

INSTRUCTIONS = """\
DevTrack is the developer's single tracker for every repo they work on (frub, 3dzprinting,
immorio, print-cost-calculator, bistro, ...). Projects are identified by slug, usually the repo
folder name. Use it so the developer never loses track of what agents did and what is pending.

Workflow:
- Session start: call `agenda` (or `list_items` with project=<slug>) to see what is open,
  scheduled, parked or waiting on the developer.
- When you plan or start a unit of work, `create_item` (or `update_item` an existing one) with
  branch, estimate_hours, cost and the planned dates you agreed on: submit_on (when the PR /
  commits should appear), merge_on, deploy_on, due_on.
- Work built ahead of its date: set status='parked' and submit_on. On the submit day, call
  `redate_plan` and give the developer the script; it rebases the branch and re-dates commits.
- Anything the developer must do themselves (approve, set secrets, test on device, pay, deploy):
  record it as an item with assignee='me', never only in chat. If it can't be done yet because it
  waits on someone else (a client, ops, an account approval), set waiting_for (who) and
  snoozed_until (when to check back); held items leave the developer's list until that day.
- Branch, MR and status: git sync runs every 15 minutes and moves items to submitted/merged when
  their MR opens or merges. Call `git_sync` after pushing or opening an MR to refresh it now.
- Session end: ALWAYS call `handoff` with what was done, what is next, and the developer's to-dos.
Dates accept YYYY-MM-DD, today, tomorrow, +3d, friday, next friday.
"""

mcp = FastMCP("devtrack", instructions=INSTRUCTIONS, stateless_http=True, json_response=True)

Status = Literal["backlog", "todo", "in_progress", "blocked", "parked", "submitted", "merged", "deployed", "done", "cancelled"]
Kind = Literal["feature", "bug", "chore", "task", "followup", "deploy"]
Assignee = Literal["me", "agent"]
Priority = Literal["urgent", "high", "normal", "low"]
NoteKind = Literal["progress", "handoff", "decision", "blocker", "info"]


def _given(**kwargs) -> dict:
    return {k: v for k, v in kwargs.items() if v is not None}


@mcp.tool()
def list_projects(include_archived: bool = False) -> list[dict]:
    """List tracked projects with open item counts, items waiting on the developer, parked
    (built-early) items, open estimate hours and open cost."""
    return s.list_projects(include_archived)


@mcp.tool()
def upsert_project(
    slug: str,
    name: str | None = None,
    repo_path: str | None = None,
    repo_url: str | None = None,
    description: str | None = None,
    status: Literal["active", "paused", "archived"] | None = None,
) -> dict:
    """Create a project (slug = lowercase repo name) or update its details."""
    return s.upsert_project(slug, **_given(name=name, repo_path=repo_path, repo_url=repo_url,
                                           description=description, status=status))


@mcp.tool()
def list_items(
    project: str | None = None,
    status: str | None = None,
    assignee: Assignee | None = None,
    kind: Kind | None = None,
    include_closed: bool = False,
    search: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """List work items, soonest milestone first. status may be comma-separated
    (e.g. "parked,submitted"). Closed items (done/cancelled) are hidden unless include_closed."""
    return s.list_items(project, status, assignee, kind, include_closed, search, limit)


@mcp.tool()
def get_item(item_id: int) -> dict:
    """Get one item with its full note history."""
    return s.get_item(item_id)


@mcp.tool()
def create_item(
    project: str,
    title: str,
    description: str | None = None,
    kind: Kind = "task",
    status: Status = "todo",
    assignee: Assignee = "agent",
    priority: Priority = "normal",
    ticket_ref: str | None = None,
    branch: str | None = None,
    base_branch: str | None = None,
    pr_url: str | None = None,
    built_on: str | None = None,
    submit_on: str | None = None,
    commit_date: str | None = None,
    merge_on: str | None = None,
    deploy_on: str | None = None,
    due_on: str | None = None,
    estimate_hours: float | None = None,
    actual_hours: float | None = None,
    cost: float | None = None,
    currency: str | None = None,
    waiting_for: str | None = None,
    snoozed_until: str | None = None,
    repeat_every: str | None = None,
    blocked_by: list[int] | None = None,
) -> dict:
    """Track a unit of work (ticket, feature, bug, follow-up, deploy). Unknown project slugs are
    created. assignee='me' means the developer has to do it.
    submit_on = date the work should be submitted (commits/PR dated then); commit_date = exact
    YYYY-MM-DDTHH:MM to stamp commits with; merge_on / deploy_on = planned merge and deploy;
    built_on = when it was actually built (status 'parked' fills it with today).
    waiting_for = who it waits on (e.g. "shop", "ops", "SATIM"); snoozed_until = check-back date.
    Either one puts the item on hold, out of the developer's to-do list until that date.
    repeat_every = "weekly", "monthly", "90d", "2w", ...: marking it done schedules the next copy
    with its dates moved on by that much (renewals, recurring deploys, monthly reviews).
    blocked_by = item ids this can't start before; it goes to 'blocked' and back to 'todo' by
    itself once they are all merged, deployed, done or cancelled."""
    return s.create_item(project, title, **_given(waiting_for=waiting_for, snoozed_until=snoozed_until, repeat_every=repeat_every,
        blocked_by=blocked_by,
        description=description, kind=kind, status=status, assignee=assignee, priority=priority,
        ticket_ref=ticket_ref, branch=branch, base_branch=base_branch, pr_url=pr_url,
        built_on=built_on, submit_on=submit_on, commit_date=commit_date, merge_on=merge_on,
        deploy_on=deploy_on, due_on=due_on, estimate_hours=estimate_hours,
        actual_hours=actual_hours, cost=cost, currency=currency,
    ))


@mcp.tool()
def update_item(
    item_id: int,
    note: str | None = None,
    author: str | None = None,
    project: str | None = None,
    title: str | None = None,
    description: str | None = None,
    kind: Kind | None = None,
    status: Status | None = None,
    assignee: Assignee | None = None,
    priority: Priority | None = None,
    ticket_ref: str | None = None,
    branch: str | None = None,
    base_branch: str | None = None,
    pr_url: str | None = None,
    built_on: str | None = None,
    submit_on: str | None = None,
    commit_date: str | None = None,
    merge_on: str | None = None,
    deploy_on: str | None = None,
    due_on: str | None = None,
    estimate_hours: float | None = None,
    actual_hours: float | None = None,
    cost: float | None = None,
    currency: str | None = None,
    waiting_for: str | None = None,
    snoozed_until: str | None = None,
    repeat_every: str | None = None,
    blocked_by: list[int] | None = None,
) -> dict:
    """Update an item. Omitted fields are unchanged; pass "" to clear a text/date field.
    `note` adds a progress note to the item's history in the same call.
    waiting_for / snoozed_until put it on hold (pass "" to both to take it off hold).
    repeat_every makes it recurring ("" stops it); finishing it returns next_occurrence.
    blocked_by replaces the item's blockers ([] clears them). Finishing an item returns `unblocked`,
    the ids of items that were only waiting on it."""
    return s.update_item(item_id, project=project, note=note, author=author, **_given(
        waiting_for=waiting_for, snoozed_until=snoozed_until, repeat_every=repeat_every, blocked_by=blocked_by,
        title=title, description=description, kind=kind, status=status, assignee=assignee,
        priority=priority, ticket_ref=ticket_ref, branch=branch, base_branch=base_branch,
        pr_url=pr_url, built_on=built_on, submit_on=submit_on, commit_date=commit_date,
        merge_on=merge_on, deploy_on=deploy_on, due_on=due_on, estimate_hours=estimate_hours,
        actual_hours=actual_hours, cost=cost, currency=currency,
    ))


@mcp.tool()
def list_templates() -> list[dict]:
    """Reusable item templates (name, title, checklist description, kind, priority, assignee,
    estimate). Use one with `create_from_template` instead of typing a familiar checklist again."""
    return s.list_templates()


@mcp.tool()
def create_from_template(
    template: str,
    project: str,
    title: str | None = None,
    due_on: str | None = None,
    submit_on: str | None = None,
    branch: str | None = None,
    assignee: Assignee | None = None,
) -> dict:
    """Create an item from a template (by name or id). It takes the template's title unless
    `title` is given, and its checklist, kind, priority, assignee and estimate."""
    return s.create_from_template(template, project, title,
                                  **_given(due_on=due_on, submit_on=submit_on, branch=branch, assignee=assignee))


@mcp.tool()
def add_note(
    body: str,
    project: str | None = None,
    item_id: int | None = None,
    kind: NoteKind = "progress",
    author: str | None = None,
) -> dict:
    """Log a progress update, decision, blocker or info note on a project or a specific item."""
    return s.add_note(project, body, kind, item_id, author)


@mcp.tool()
def list_notes(project: str | None = None, item_id: int | None = None,
               kind: NoteKind | None = None, limit: int = 20) -> list[dict]:
    """Recent notes and handoffs, newest first. Read the last handoff before resuming a project."""
    return s.list_notes(project, item_id, kind, limit)


@mcp.tool()
def handoff(
    project: str,
    summary: str,
    author: str | None = None,
    done: list[str] | None = None,
    next_steps: list[str] | None = None,
    user_todos: list[str] | None = None,
    user_todo_due: str | None = None,
    item_id: int | None = None,
    item_status: Status | None = None,
) -> dict:
    """Call at the end of every session. Records where things stand (summary, done, next_steps)
    and creates one tracked item (assignee='me') per entry in user_todos: the things the
    developer has to do later. Optionally moves item_id to item_status."""
    return s.handoff(project, summary, author, done, next_steps, user_todos, user_todo_due,
                     item_id, item_status)


@mcp.tool()
def agenda(days: int = 7, project: str | None = None) -> dict:
    """What is due: overdue milestones, upcoming submit/merge/deploy/due dates within `days`,
    items waiting on the developer, items on hold (waiting on others / snoozed), parked
    (built-early) and blocked items. Items carry a `git` summary when the branch was synced."""
    return s.agenda(days, project)


@mcp.tool()
def weekly_review(day: str | None = None, project: str | None = None) -> dict:
    """The week (Monday to Sunday) holding `day`, default this week: items finished, started and
    slipped, finished late, decisions and blockers noted, focus and actual vs estimate hours, and
    what is due the next week. `markdown` is a ready summary to show the developer."""
    return s.weekly_review(day, project)


@mcp.tool()
def cost_summary(project: str | None = None) -> dict:
    """Estimate hours, actual hours and costs (open vs done) per project."""
    return s.cost_summary(project)


@mcp.tool()
def redate_plan(item_id: int, day: str | None = None, start: str = "09:00",
                end: str = "17:00", remote: str = "origin") -> dict:
    """Bash script that rebases the item's branch onto its base and spreads its commit
    author/committer dates across `day` (default: commit_date, else submit_on) between start
    and end. Show it to the developer; do not force-push without their go-ahead."""
    return s.redate_plan(item_id, day, start, end, remote)


@mcp.tool()
def git_sync(project: str | None = None, item_id: int | None = None) -> dict:
    """Re-read branches (ahead/behind base, unpushed commits, commits dated before submit_on) and
    MR/PR state for open items with a branch, now instead of at the next 15-minute run. Items move
    to submitted/merged when their MR is open/merged, and get pr_url when an MR is found."""
    return gitsync.sync(project, item_id)


@mcp.tool()
def time_report(start: str | None = None, end: str | None = None) -> dict:
    """Per project for start..end (default last 30 days): focus-timer hours and sessions, and for
    items finished in the range their estimate vs actual hours and cost."""
    return s.time_report(start, end)
