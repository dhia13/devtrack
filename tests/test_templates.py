import pytest

from app import db, service as s


def test_starters_are_seeded_once():
    names = [t["name"] for t in s.list_templates()]
    assert names == ["New project setup", "Release", "Store submission"]
    s.delete_template("Release")
    db.init()  # a restart must not bring a deleted starter back
    assert "Release" not in [t["name"] for t in s.list_templates()]


def test_save_creates_then_updates_by_name():
    t = s.save_template("Hotfix", description="- [ ] Reproduce\n- [ ] Fix\n- [ ] Ship", kind="bug", priority="high")
    assert t["title"] == "Hotfix" and t["kind"] == "bug"
    again = s.save_template("hotfix", title="Hotfix: ", estimate_hours="1.5")
    assert again["id"] == t["id"] and again["title"] == "Hotfix:" and again["estimate_hours"] == 1.5
    assert again["kind"] == "bug"  # fields left out stay


def test_bad_templates_are_refused():
    with pytest.raises(s.Invalid):
        s.save_template("  ")
    with pytest.raises(s.Invalid):
        s.save_template("x", kind="nope")
    with pytest.raises(s.Invalid):
        s.save_template("x", branch="main")
    with pytest.raises(s.NotFound):
        s.delete_template("missing")


def test_create_from_template():
    it = s.create_from_template("Store submission", "app", due_on="2030-01-31")
    assert it["title"] == "Submit to the store" and it["assignee"] == "me" and it["project"] == "app"
    assert it["description"].count("- [ ]") == 5 and it["due_on"] == "2030-01-31"
    named = s.create_from_template(s.list_templates()[1]["id"], "app", title="Release 2.1", assignee="me")
    assert named["title"] == "Release 2.1" and named["kind"] == "deploy" and named["assignee"] == "me"


def test_templates_api(client):
    r = client.post("/api/templates", json={"name": "Spike", "kind": "chore", "estimate_hours": 2})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    assert "Spike" in [t["name"] for t in client.get("/api/templates").json()]
    assert client.post(f"/api/templates/{tid}/use", json={}).status_code == 400
    it = client.post(f"/api/templates/{tid}/use", json={"project": "demo", "title": "Try htmx"}).json()
    assert it["title"] == "Try htmx" and it["kind"] == "chore" and it["estimate_hours"] == 2
    assert client.delete(f"/api/templates/{tid}").json() == {"ok": True}
    assert client.delete(f"/api/templates/{tid}").status_code == 404
    assert "templates" in client.get("/api/export").json()
