"""Optional shared-token login, on when DEVTRACK_TOKEN is set.

Agents and scripts send `Authorization: Bearer <token>`. The dashboard signs in once at /login and
then carries an HttpOnly cookie. Calendar apps can't send either, so the .ics feed also takes
`?token=`. /api/health stays open for the container health check.
"""

import asyncio
import hashlib
import hmac
from html import escape
from urllib.parse import parse_qs

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse

from . import config

COOKIE = "devtrack_session"
# The app manifest and its icons are fetched without cookies, so they stay public (they hold nothing).
OPEN_PATHS = {"/api/health", "/login", "/logout", "/static/manifest.webmanifest", "/static/icon.svg",
              "/static/icon-192.png", "/static/icon-512.png", "/static/icon-maskable.png", "/static/apple-touch-icon.png"}
QUERY_TOKEN_PATHS = {"/api/calendar.ics"}


def enabled() -> bool:
    return bool(config.TOKEN)


def _session_value() -> str:
    # The cookie holds a value derived from the token, not the token itself.
    return hmac.new(config.TOKEN.encode(), b"devtrack-session", hashlib.sha256).hexdigest()


def _matches(given: str | None, expected: str) -> bool:
    return bool(given) and hmac.compare_digest(given.encode(), expected.encode())


def authorized(request: Request) -> bool:
    header = request.headers.get("authorization", "")
    if header[:7].lower() == "bearer " and _matches(header[7:].strip(), config.TOKEN):
        return True
    if _matches(request.cookies.get(COOKIE), _session_value()):
        return True
    return request.url.path in QUERY_TOKEN_PATHS and _matches(request.query_params.get("token"), config.TOKEN)


class RequireToken:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not enabled() or scope["path"] in OPEN_PATHS:
            return await self.app(scope, receive, send)
        request = Request(scope)
        if authorized(request):
            return await self.app(scope, receive, send)
        if scope["method"] == "GET" and "text/html" in request.headers.get("accept", ""):
            response = RedirectResponse("/login", status_code=303)
        else:
            response = JSONResponse({"error": "sign in: send Authorization: Bearer <DEVTRACK_TOKEN>"}, status_code=401,
                                    headers={"WWW-Authenticate": "Bearer"})
        await response(scope, receive, send)


LOGIN_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>DevTrack · Sign in</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; }
  form { display: grid; gap: .75rem; width: min(22rem, calc(100vw - 2rem)); }
  input, button { font: inherit; padding: .6rem .75rem; border-radius: .5rem; border: 1px solid GrayText; }
  button { cursor: pointer; }
  .err { color: #c0392b; margin: 0; }
</style></head><body>
<form method="post" action="/login">
  <h1>DevTrack</h1>
  {error}
  <label for="token">Access token</label>
  <input id="token" name="token" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">Sign in</button>
</form></body></html>"""


def _page(error: str = "", status: int = 200) -> HTMLResponse:
    return HTMLResponse(LOGIN_PAGE.replace("{error}", f'<p class="err">{escape(error)}</p>' if error else ""), status_code=status)


async def login_form(request: Request):
    if not enabled() or authorized(request):
        return RedirectResponse("/", status_code=303)
    return _page()


async def login(request: Request):
    if not enabled():
        return RedirectResponse("/", status_code=303)
    token = (parse_qs((await request.body()).decode("utf-8", "replace")).get("token") or [""])[0].strip()
    if not _matches(token, config.TOKEN):
        await asyncio.sleep(1)  # slows down guessing
        return _page("Wrong token, try again.", status=401)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(COOKIE, _session_value(), max_age=90 * 24 * 3600, httponly=True, samesite="strict",
                        secure=request.url.scheme == "https")
    return response


async def logout(_request: Request):
    response = RedirectResponse("/login" if enabled() else "/", status_code=303)
    response.delete_cookie(COOKIE)
    return response
