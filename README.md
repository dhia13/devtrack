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

With a login token set (see [Security](#security)), add it as a header:

```json
{ "mcpServers": { "devtrack": { "type": "http", "url": "http://localhost:8787/mcp",
  "headers": { "Authorization": "Bearer <DEVTRACK_TOKEN>" } } } }
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
| `blocked_by` | item numbers it can't start before (`#12, #15`): see [Dependencies](#dependencies) |
| `repeat_every` | `daily`, `weekly`, `monthly`, `yearly`, or `90d`, `2w`, `3m`: see [Recurring items](#recurring-items) |

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
| `invoice` | A project's finished items in a date range with hours, amounts and totals, for billing |
| `weekly_review` | One week's finished, started and slipped work, decisions, hours, and next week, with a Markdown summary |
| `list_templates`, `create_from_template` | Reusable checklists: create a "Release" or "Store submission" item in one call |

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

## On your phone

The dashboard fits a phone: the views sit in a bar along the bottom, tiles go two a row, the task
board shows one lane at a time (swipe for the next), and the item editor fills the screen. It is
also an installable app: in Chrome or Edge use **Install app** (on Android, **Add to home screen**),
and in Safari on iOS **Share → Add to Home Screen**. The installed app opens without browser bars,
starts from the last copy when you're offline (changes need the connection), and has Agenda and
Tasks shortcuts on its icon.

Installing needs HTTPS, or `localhost` on the PC itself. To reach DevTrack from your phone, first
set it up as in [Reaching it from another machine](#reaching-it-from-another-machine), then put
HTTPS in front, for example with Tailscale: `tailscale serve --bg 8787` gives you
`https://my-pc.tailnet.ts.net`, and that host name goes in `DEVTRACK_ALLOWED_HOSTS`. Over plain
HTTP the page still works in the phone's browser, but it can't be installed and doesn't send
notifications.

## Reminders

Turn on **Settings → Reminders → Notifications** and DevTrack sends a morning summary (from the
hour you pick, or when you first open it after that): how many milestones are due today, overdue
and back from hold, with the first few titles. During the day it adds a note when something new
comes due, for example when a snooze ends. They are browser notifications, so they fire while
DevTrack is open in a tab or installed as an app; when notifications are blocked they show inside
DevTrack instead. **Test** sends today's summary now.

For reminders with DevTrack closed, subscribe to the calendar feed (Settings → Data): each open
milestone's event alerts at 09:00 on its day. Change the time with `DEVTRACK_ICS_ALERT`, or set it
empty for no alerts. `/api/reminders` returns the same summary for scripts.

## Invoices

Each project row in **Insights → Time by project** with finished items has an **Invoice** link,
and the command bar has **Invoice <project>** for this month so far. It opens a printable page:
the items finished in the range, with their ticket, done date, actual hours and amount, and
totals. An item's amount is its `cost`, or its actual hours times the hourly rate when it has no
cost. Change the dates, rate or invoice number at the top, then **Print or save as PDF**, or take
the **CSV**. Set `DEVTRACK_HOURLY_RATE` for a default rate and `DEVTRACK_INVOICE_FROM` for your
name and address (`\n` between lines) in `.env`. The bill-to line is the project's name. Agents
call `invoice`; the API is `/api/invoice`, `/api/invoice.csv` and `/api/invoice.html`.

## Weekly review

**Weekly review** (key `7`) shows one Monday-to-Sunday week: what was finished (and which of it
late), what was started, milestones that passed without being reached, decisions and blockers
noted, focus hours, actual vs estimate hours, and what is due the week after. Step back a week
with the arrows. **Copy summary** puts a Markdown version on the clipboard for a client update or
a stand-up, and **Download .md** saves it (`/api/review.md`). Agents call `weekly_review`, which
returns the same data with the Markdown in `markdown`.

## Dependencies

Set **Blocked by** in the item dialog (or `blocked_by` over the API and MCP) to the items this one
waits on. An open item with an unfinished blocker moves to `blocked`, with a note. Once every
blocker is merged, deployed, done or cancelled (or deleted), it moves back to `todo` by itself,
with a note naming the blocker, and the finishing call returns `unblocked` with its number. An
item you moved on by hand (say to `in_progress`) is left alone. Cycles are refused.

## Templates

A template is a starting point for an item you make often: its title, checklist, kind, priority,
assignee and estimate. Type its name in the command bar (**Ctrl K**, say `release`) and pick it
under **Templates** to open a new item with all of that filled in. **Save as template** in the item
dialog saves the open item under its title (replacing a template of that name), and
**Settings → Templates** lists, adds and deletes them. Three starters come with a new database:
Release, New project setup and Store submission. Agents use `list_templates` and
`create_from_template`, and the API is `/api/templates`.

## Recurring items

Give an item `repeat_every` (the **Repeat** field in the item dialog) and marking it done schedules
the next one: same title, description, kind, assignee, priority, estimate and cost, status `todo`,
with checklist boxes unticked. Its dates move on by whole periods until the earliest is in the
future, so a weekly release finished late still lands on the next week, and the gaps between
submit, deploy and due stay the same. An item with no dates comes back due one period from today.
Branch, PR and actual hours are not copied. Each copy links back with `repeat_of`, a note on the
finished item names the new one, and reopening and finishing it again doesn't make a second copy.
Clear the field to stop repeating.

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

By default there is no login: the port is bound to `127.0.0.1` only, and requests with a `Host`
other than `localhost` or `127.0.0.1` are rejected (`DEVTRACK_ALLOWED_HOSTS`), which blocks DNS
rebinding from web pages. Writes (POST, PATCH, DELETE) sent by another site's page are refused too,
using the browser's `Origin` and `Sec-Fetch-Site` headers; agents and `curl` don't send them and are
unaffected.

### Reaching it from another machine

Set a token, then open the port and allow the host name you'll use, in `.env`:

```bash
DEVTRACK_TOKEN=$(openssl rand -hex 24)   # at least 16 characters
DEVTRACK_BIND=0.0.0.0                    # or your Tailscale IP
DEVTRACK_ALLOWED_HOSTS=localhost,127.0.0.1,devtrack.localhost,my-pc.tailnet.ts.net
```

With a token, every request except `/api/health` (and the app manifest and its icons) needs it:

- **Dashboard:** sign in once at `/login`; it keeps an HttpOnly cookie for 90 days. `/logout` signs out.
- **Agents and scripts:** `Authorization: Bearer <token>` (see [Connect an agent](#connect-an-agent)).
- **Calendar apps:** they can't send headers, so subscribe to `/api/calendar.ics?token=<token>`.

The connection is plain HTTP, so only open it on a network you trust, such as Tailscale or WireGuard,
or put an HTTPS reverse proxy in front.
