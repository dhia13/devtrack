# DevTrack

One place to track every app you build: what each coding agent did, what's next, what's waiting on you, which branches
were built early and need re-dating, and when things get submitted, merged and deployed, with
estimates and cost.

It's one Docker container with three parts:

- **Dashboard** at http://localhost:8787: home, tasks board, agenda, calendar, projects, insights,
  activity, settings, and a focus timer.
- **MCP server** at http://localhost:8787/mcp (streamable HTTP), used by coding agents in any repo.
- **REST API** at http://localhost:8787/api (docs at `/api/docs`).

Data lives in SQLite on the `devtrack-data` Docker volume.

## Run

```bash
cp .env.example .env    # set TZ to your timezone
docker compose up -d --build
```

The first start creates the projects listed in `DEVTRACK_SEED_PROJECTS`.

## Connect an agent

Register the server once, at user level, so every repo can use it:

```json
{ "mcpServers": { "devtrack": { "type": "http", "url": "http://localhost:8787/mcp" } } }
```

Then paste [docs/agent-instructions.md](docs/agent-instructions.md) into each repo's agent
instructions file, with `<slug>` set to that project's slug.

## Concepts

| Field | Meaning |
|---|---|
| `status` | backlog, todo, in_progress, blocked, **parked** (built early, waiting for its date), submitted, merged, deployed, done, cancelled |
| `assignee` | `agent`, or `me` for things you have to do yourself |
| `built_on` | when the work was actually built (set automatically when parked) |
| `submit_on` | when it should be submitted: PR opened, commits dated |
| `commit_date` | exact timestamp to stamp commits with, if not the submit day |
| `merge_on`, `deploy_on`, `due_on` | planned milestones; they show on the agenda until reached |
| `estimate_hours`, `actual_hours`, `cost`, `currency` | effort and cost, summed per project |
| `waiting_for`, `snoozed_until` | on hold: who it waits on, and when to check back (see below) |

Dates accept `YYYY-MM-DD`, `today`, `tomorrow`, `+3d`, `friday`, `next friday`.

## MCP tools

| Tool | Use |
|---|---|
| `agenda` | Overdue and upcoming milestones, items waiting on you, parked, blocked |
| `list_projects`, `upsert_project` | Projects with open counts, estimates, costs |
| `list_items`, `get_item`, `create_item`, `update_item` | Work items (`update_item` can also log a note) |
| `add_note`, `list_notes` | Progress, decisions, blockers |
| `handoff` | End-of-session report; each `user_todos` entry becomes an item assigned to you |
| `cost_summary` | Estimate, actual hours and cost per project |
| `redate_plan` | Script that rebases a parked branch and spreads its commit dates over the submit day |
| `git_sync` | Refresh branch and MR state now instead of at the next 15-minute run |
| `time_report` | Focus hours per project, and estimate vs actual for items finished in a date range |

## Re-dating a branch built early

Set the item to `parked` with its `branch`, `base_branch` and `submit_on` (or `commit_date`).
On the day, run the script from `redate_plan`, or from **Re-date script** in the item dialog, in
Git Bash at the repo root. It fetches, rebases onto `origin/<base>`, and spreads author and
committer dates evenly between 09:00 and 17:00 on that day (in the container's `TZ`). Check the
printed log, then `git push --force-with-lease`.

## Command bar

Press **Ctrl K** anywhere (or the search button) to jump to a view, run a command (start focus,
sync git, back up, switch theme, filter a project), search items, or open one with `#123`.
Typing a line also offers to create it, reading the extras out of it:

```
Fix invoice PDF frub high due friday #bug
```

That creates "Fix invoice PDF" in `frub`, priority high, due Friday, kind bug. It understands a
project slug (or `@slug`), `urgent` / `high` / `low`, `submit|merge|deploy|due <date>` with the
same dates as the API (`tomorrow`, `+3d`, `friday`, `next friday`, `2026-11-02`), `#bug`-style
kinds and `for me`. **Shift Enter** creates it even when another result is selected.

## Focus and time

The focus timer (the island at the top) saves every finished block to DevTrack, linked to an item
when you start it from one. Ending a block also offers to add its minutes to the item's actual
hours. **Insights → Time by project** shows focus hours per project for the chosen range, and, for
items finished in it, estimate vs actual hours and cost, with a CSV download (`/api/time.csv`).

## On hold

A to-do that can't move until someone else acts (the shop, ops, an account approval) goes on hold:
set `waiting_for` and, optionally, `snoozed_until`. Use the clock button on a to-do, or the
**On hold** group in the item dialog. Held items leave "waiting on you", the bell and the Home rings.
On the check-back day they come back with a "back" tag. With no date they stay held until you take
them off hold. The Agenda lists everything on hold, grouped by who it waits on.

## Git sync

Every 15 minutes DevTrack reads each open item's branch from your repos. They are mounted read-only
from `DEVTRACK_REPOS_HOST` (default `D:/Work`); a project's `repo_path` must be inside it. Folders
that hold several repos, are searched one level down. Per item
it records:

- commits ahead of and behind its base (the first word of `base_branch`, else the default branch)
- whether the branch is on the remote, and how many commits aren't pushed (as of your last fetch;
  DevTrack never fetches or writes)
- how many commits are dated before `submit_on`, i.e. still to re-date
- its merge request (GitLab) or pull request (GitHub), from `pr_url` or found by branch name

With `GITLAB_TOKEN` (scope `read_api`) and/or `GITHUB_TOKEN` (fine-grained, Pull requests:
read-only) in `.env`, an item whose MR opens moves to `submitted` and one whose MR merges moves to
`merged`, with a note, and gets its `pr_url` filled in. It never moves an item backwards. Set
`DEVTRACK_GIT_AUTO_STATUS=0` to only show the state. Without tokens only the local branch state is
shown, because your repos are private.

## Backup

A snapshot of the whole database is taken on start and then every 24 hours into `backups/` next to
`docker-compose.yml` (`DEVTRACK_BACKUP_HOST_DIR`), outside Docker, so it survives losing the
volume. The newest 14 are kept (`DEVTRACK_BACKUP_KEEP`). **Settings → Backups** lists them, takes
one on demand, downloads one, or restores one. A restore first saves a `pre-restore` copy of the
current state.

A JSON export is still available:

```bash
curl -o devtrack-backup.json http://localhost:8787/api/export
```

## Development

```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q            # unit and API tests (add --cov for coverage)
ruff check app tests           # lint
python -m playwright install chromium && python -m pytest -m e2e   # dashboard in a real browser
```

Or inside the image:
`docker run --rm -u root -v "$PWD:/w" -w /w devtrack sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"`.

Layout: `app/config.py` reads every setting, `app/service.py` holds the logic shared by the REST
API (`app/main.py`) and the MCP tools (`app/mcp_server.py`), and the dashboard is
`app/static/index.html` with its `app.js` and `app.css`. Schema changes go at the end of
`MIGRATIONS` in `app/db.py`; the database's `PRAGMA user_version` records which have run.

GitHub Actions runs lint, the tests with coverage, the browser tests and a container health check
on every push.

## Security

There is no login. The port is bound to `127.0.0.1` only, and requests with a `Host` other than
`localhost` or `127.0.0.1` are rejected (`DEVTRACK_ALLOWED_HOSTS`), which blocks DNS rebinding from
web pages. Writes (POST, PATCH, DELETE) sent by another site's page are refused too, using the
browser's `Origin` and `Sec-Fetch-Site` headers; agents and `curl` don't send them and are unaffected.
Don't publish the port on a network interface without adding authentication.
