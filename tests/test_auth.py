import pytest

from app import config

TOKEN = "s3cret-token-for-tests-0123"
FORM = {"Content-Type": "application/x-www-form-urlencoded"}


@pytest.fixture
def locked(monkeypatch, client):
    monkeypatch.setattr(config, "TOKEN", TOKEN)
    client.cookies.clear()
    yield client
    client.cookies.clear()


def test_open_when_no_token(client):
    assert config.TOKEN == ""
    assert client.get("/api/items").status_code == 200


def test_api_and_mcp_need_the_token(locked):
    r = locked.get("/api/items")
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"
    assert locked.get("/api/items", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert locked.get("/api/items", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200
    mcp = {"Accept": "application/json, text/event-stream", "Host": "localhost:8787"}
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    assert locked.post("/mcp", json=body, headers=mcp).status_code == 401
    assert locked.post("/mcp", json=body, headers={**mcp, "Authorization": f"Bearer {TOKEN}"}).status_code == 200
    assert locked.get("/api/health").status_code == 200  # container health check stays open


def test_dashboard_login_sets_a_cookie(locked):
    r = locked.get("/", headers={"Accept": "text/html"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login"
    assert "Access token" in locked.get("/login").text
    bad = locked.post("/login", content="token=nope", headers=FORM)
    assert bad.status_code == 401 and "Wrong token" in bad.text
    ok = locked.post("/login", content=f"token={TOKEN}", headers=FORM, follow_redirects=False)
    assert ok.status_code == 303
    cookie = ok.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and TOKEN not in cookie
    assert locked.get("/api/items").status_code == 200  # the client kept the cookie
    assert locked.get("/static/app.js").status_code == 200
    locked.get("/logout")
    assert locked.get("/api/items").status_code == 401


def test_calendar_feed_takes_a_query_token(locked):
    assert locked.get("/api/calendar.ics").status_code == 401
    assert locked.get(f"/api/calendar.ics?token={TOKEN}").status_code == 200
    assert locked.get(f"/api/items?token={TOKEN}").status_code == 401  # only the feed


def test_short_token_refused(monkeypatch):
    import importlib

    monkeypatch.setenv("DEVTRACK_TOKEN", "short")
    with pytest.raises(RuntimeError, match="at least 16"):
        importlib.reload(config)
    monkeypatch.undo()
    importlib.reload(config)
