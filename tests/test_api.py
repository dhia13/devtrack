def test_health_and_meta(client):
    assert client.get("/api/health").json() == {"ok": True}
    assert "parked" in client.get("/api/meta").json()["statuses"]


def test_dashboard_and_assets_served(client):
    page = client.get("/")
    assert page.status_code == 200 and page.headers["cache-control"] == "no-cache"
    for asset in ("/static/app.js", "/static/app.css"):
        assert asset in page.text
        r = client.get(asset)
        assert r.status_code == 200 and r.headers["cache-control"] == "no-cache" and r.headers.get("etag")
    assert client.get("/static/../main.py").status_code == 404


def test_foreign_host_rejected(client):
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400


def test_cross_site_writes_refused(client):
    evil = {"Origin": "https://evil.example"}
    assert client.post("/api/backups", headers=evil).status_code == 403
    assert client.post("/api/items", json={"project": "demo", "title": "x"},
                       headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.post("/api/items", json={"project": "demo", "title": "x"}, headers={"Origin": "null"}).status_code == 403
    # reads, the dashboard itself, and clients that send no Origin (agents, curl) still work
    assert client.get("/api/health", headers=evil).status_code == 200
    ok = {"Origin": "http://localhost:8787", "Sec-Fetch-Site": "same-origin"}
    assert client.post("/api/items", json={"project": "demo", "title": "x"}, headers=ok).status_code == 200
    assert client.post("/api/items", json={"project": "demo", "title": "y"}).status_code == 200


def test_item_crud_and_errors(client):
    it = client.post("/api/items", json={"project": "demo", "title": "Write tests", "due_on": "tomorrow"}).json()
    assert it["project"] == "demo" and it["next_milestone"]["type"] == "due"
    patched = client.patch(f"/api/items/{it['id']}", json={"waiting_for": "ops"}).json()
    assert patched["on_hold"]
    assert client.post("/api/items", json={"project": "demo"}).status_code == 400
    assert client.get("/api/items/99999").status_code == 404
    assert client.delete(f"/api/items/{it['id']}").json() == {"ok": True}


def test_focus_and_time_csv(client):
    it = client.post("/api/items", json={"project": "demo", "title": "t"}).json()
    client.post("/api/focus", json={"minutes": 25, "item_id": it["id"]})
    daily = client.get("/api/focus/daily?days=1").json()
    assert sum(daily.values()) == 25
    csv = client.get("/api/time.csv").text.splitlines()
    assert csv[0].startswith("project,focus_hours") and csv[1].startswith("demo,0.42,1,")
    assert client.post("/api/focus", json={"minutes": -5}).status_code == 400


def test_backup_endpoints(client):
    b = client.post("/api/backups").json()
    assert any(x["name"] == b["name"] for x in client.get("/api/backups").json()["backups"])
    assert client.get(f"/api/backups/{b['name']}").status_code == 200
    assert client.get("/api/backups/..%2F..%2Fetc%2Fpasswd").status_code in (400, 404)


def test_calendar_and_export(client):
    client.post("/api/items", json={"project": "demo", "title": "ship", "deploy_on": "friday"})
    assert client.get("/api/calendar.ics").text.startswith("BEGIN:VCALENDAR")
    data = client.get("/api/export").json()
    assert {"projects", "items", "notes", "focus_sessions"} <= set(data)


def test_git_settings(client):
    r = client.get("/api/git")
    assert r.status_code == 200 and r.json()["every_minutes"] == 0


def test_mcp_endpoint_mounted(client):
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                    headers={"Accept": "application/json, text/event-stream", "Host": "localhost:8787"})
    assert r.status_code == 200
    names = {t["name"] for t in r.json()["result"]["tools"]}
    assert {"agenda", "handoff", "git_sync", "time_report"} <= names
