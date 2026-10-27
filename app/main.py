import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Body, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import backup, config, db, gitsync, service as s
from .mcp_server import mcp

log = logging.getLogger("devtrack")

STATIC = Path(__file__).parent / "static"
ALLOWED_HOSTS = config.ALLOWED_HOSTS

mcp_app = mcp.streamable_http_app()


async def _every(seconds: float, job, first_delay: float = 5):
    """Run a blocking job in a thread forever; errors are logged, never fatal."""
    await asyncio.sleep(first_delay)
    while True:
        try:
            await asyncio.to_thread(job)
        except Exception:
            log.exception("background job %s failed", job.__name__)
        await asyncio.sleep(seconds)


def _backup_if_due():
    if backup.due():
        backup.create_backup()


def _git_sync():
    gitsync.sync()


@asynccontextmanager
async def lifespan(_app):
    db.init()
    jobs = [asyncio.create_task(_every(30 * 60, _backup_if_due))]
    minutes = config.GIT_SYNC_MINUTES
    if minutes > 0:
        jobs.append(asyncio.create_task(_every(minutes * 60, _git_sync, first_delay=20)))
    try:
        async with mcp.session_manager.run():
            yield
    finally:
        for j in jobs:
            j.cancel()


app = FastAPI(title="DevTrack", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
# Only answer to local host names, so a web page can't reach the API through DNS rebinding.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


@app.exception_handler(s.NotFound)
async def _not_found(_req: Request, exc: s.NotFound):
    return JSONResponse({"error": str(exc)}, status_code=404)


@app.exception_handler(backup.BackupError)
async def _backup_error(_req: Request, exc: backup.BackupError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(s.Invalid)
async def _invalid(_req: Request, exc: s.Invalid):
    return JSONResponse({"error": str(exc)}, status_code=400)


# no-cache = revalidate with the ETag on each load, so a rebuilt image's UI shows up at once.
NO_CACHE = {"Cache-Control": "no-cache"}


class _Static(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers.update(NO_CACHE)
        return response


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html", headers=NO_CACHE)


app.mount("/static", _Static(directory=STATIC), name="static")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    return {
        "statuses": s.STATUSES, "kinds": s.KINDS, "assignees": s.ASSIGNEES,
        "priorities": s.PRIORITIES, "note_kinds": s.NOTE_KINDS,
        "project_statuses": s.PROJECT_STATUSES, "currency": s.DEFAULT_CURRENCY,
    }


class SameOriginWrites:
    """Refuse writes sent by another site's page (CSRF). The Host check alone doesn't stop a page
    open in your browser from POSTing to localhost; browsers mark those with Origin / Sec-Fetch-Site.
    Agents and curl send neither header, so they are unaffected."""

    SAFE = {"GET", "HEAD", "OPTIONS"}

    def __init__(self, app, allowed_hosts):
        self.app, self.allowed = app, {h.lower() for h in allowed_hosts}

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] not in self.SAFE and not self._same_origin(scope):
            await JSONResponse({"error": "cross-site request refused"}, status_code=403)(scope, receive, send)
            return
        await self.app(scope, receive, send)

    def _same_origin(self, scope) -> bool:
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        if headers.get("sec-fetch-site", "same-origin") not in ("same-origin", "none"):
            return False
        origin = headers.get("origin")
        if origin is None:
            return True
        return "*" in self.allowed or (urlsplit(origin).hostname or "").lower() in self.allowed


app.add_middleware(SameOriginWrites, allowed_hosts=ALLOWED_HOSTS)


# ---- projects

@app.get("/api/projects")
def projects(include_archived: bool = False):
    return s.list_projects(include_archived)


@app.post("/api/projects")
def create_project(body: dict = Body(...)):
    slug = body.pop("slug", None)
    if not slug:
        raise s.Invalid("slug is required")
    return s.upsert_project(slug, **body)


@app.patch("/api/projects/{ref}")
def patch_project(ref: str, body: dict = Body(...)):
    body.pop("slug", None)
    return s.upsert_project(ref, **body)


@app.delete("/api/projects/{ref}")
def remove_project(ref: str):
    s.delete_project(ref)
    return {"ok": True}


# ---- items

@app.get("/api/items")
def items(project: str | None = None, status: str | None = None, assignee: str | None = None,
          kind: str | None = None, include_closed: bool = False, search: str | None = None,
          limit: int = 500):
    return s.list_items(project, status, assignee, kind, include_closed, search, limit)


@app.post("/api/items")
def create_item(body: dict = Body(...)):
    project, title = body.pop("project", None), body.pop("title", None)
    if not project:
        raise s.Invalid("project is required")
    return s.create_item(project, title, **body)


@app.get("/api/items/{item_id}")
def item(item_id: int):
    return s.get_item(item_id)


@app.patch("/api/items/{item_id}")
def patch_item(item_id: int, body: dict = Body(...)):
    project, note, author = body.pop("project", None), body.pop("note", None), body.pop("author", None)
    return s.update_item(item_id, project=project, note=note, author=author, **body)


@app.delete("/api/items/{item_id}")
def remove_item(item_id: int):
    s.delete_item(item_id)
    return {"ok": True}


@app.get("/api/items/{item_id}/redate")
def redate(item_id: int, day: str | None = None, start: str = "09:00", end: str = "17:00", remote: str = "origin"):
    return s.redate_plan(item_id, day, start, end, remote)


# ---- notes, planning

@app.get("/api/notes")
def notes(project: str | None = None, item_id: int | None = None, kind: str | None = None, limit: int = 100):
    return s.list_notes(project, item_id, kind, limit)


@app.post("/api/notes")
def create_note(body: dict = Body(...)):
    return s.add_note(body.get("project"), body.get("body", ""), body.get("kind", "progress"),
                      body.get("item_id"), body.get("author") or "me")


@app.get("/api/agenda")
def agenda(days: int = 14, project: str | None = None):
    return s.agenda(days, project)


@app.get("/api/costs")
def costs(project: str | None = None):
    return s.cost_summary(project)


@app.get("/api/calendar.ics")
def calendar(project: str | None = None, include_closed: bool = False):
    return Response(s.calendar_ics(project, include_closed), media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'inline; filename="devtrack.ics"'})


@app.get("/api/export")
def export():
    return JSONResponse(s.export_all(), headers={"Content-Disposition": 'attachment; filename="devtrack-export.json"'})


# ---- focus & time

@app.post("/api/focus")
def focus_log(body: dict = Body(...)):
    return s.log_focus(body.get("minutes"), body.get("item_id"), body.get("started_at"), body.get("day"))


@app.post("/api/focus/import")
def focus_import(body: dict = Body(...)):
    return s.import_focus(body.get("log") or {})


@app.get("/api/focus/daily")
def focus_daily(days: int = 120, project: str | None = None):
    return s.focus_daily(days, project)


@app.delete("/api/focus")
def focus_clear():
    return s.clear_focus()


@app.get("/api/time")
def time_report(start: str | None = None, end: str | None = None):
    return s.time_report(start, end)


@app.get("/api/time.csv")
def time_csv(start: str | None = None, end: str | None = None):
    r = s.time_report(start, end)
    lines = ["project,focus_hours,sessions,finished_items,estimate_hours,actual_hours,cost"]
    for p in r["projects"]:
        cost = " ".join(f"{v:g} {k}" for k, v in p["cost"].items())
        lines.append(f'{p["project"]},{p["focus_minutes"] / 60:.2f},{p["sessions"]},{p["finished"]},'
                     f'{p["estimate_hours"]:g},{p["actual_hours"]:g},{cost}')
    return Response("\n".join(lines) + "\n", media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="devtrack-time-{r["start"]}-{r["end"]}.csv"'})


# ---- backups

@app.get("/api/backups")
def backups():
    return backup.list_backups()


@app.post("/api/backups")
def backup_now():
    return backup.create_backup("manual")


@app.get("/api/backups/{name}")
def backup_file(name: str):
    return FileResponse(backup.path_of(name), media_type="application/vnd.sqlite3", filename=name)


@app.post("/api/backups/{name}/restore")
def backup_restore(name: str):
    out = backup.restore(name)
    db.init()  # bring an older snapshot's schema up to date
    return out


# ---- git / MR sync

@app.get("/api/git")
def git_config():
    return gitsync.config()


@app.post("/api/git/sync")
def git_sync(project: str | None = None, item_id: int | None = None):
    return gitsync.sync(project, item_id)


# MCP streamable HTTP endpoint at /mcp. Mounted last so the routes above win.
app.mount("/", mcp_app)
