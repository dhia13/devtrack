# DevTrack

One place to track every app you build (frub, 3dzprinting, immorio, print-cost-calculator,
bistro, ...): what each coding agent did, what's next, what's waiting on you, which branches
were built early and need re-dating, and when things get submitted, merged and deployed, with
estimates and cost.

It's one Docker container with three parts:

- **Dashboard** at http://localhost:8787: agenda, items, projects with costs, activity feed.
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

## Re-dating a branch built early

Set the item to `parked` with its `branch`, `base_branch` and `submit_on` (or `commit_date`).
On the day, run the script from `redate_plan`, or from **Re-date script** in the item dialog, in
Git Bash at the repo root. It fetches, rebases onto `origin/<base>`, and spreads author and
committer dates evenly between 09:00 and 17:00 on that day (in the container's `TZ`). Check the
printed log, then `git push --force-with-lease`.

## Backup

```bash
curl -o devtrack-backup.json http://localhost:8787/api/export
```

## Security

There is no login. The port is bound to `127.0.0.1` only, and requests with a `Host` other than
`localhost` or `127.0.0.1` are rejected (`DEVTRACK_ALLOWED_HOSTS`), which blocks DNS rebinding from
web pages. Don't publish the port on a network interface without adding authentication.
