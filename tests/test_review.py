from app import db, service as s


def _at(item_id, **cols):
    with db.tx() as conn:
        conn.execute(f"UPDATE items SET {', '.join(f'{k} = ?' for k in cols)} WHERE id = ?", (*cols.values(), item_id))


def test_week_review_counts_what_happened():
    shipped = s.create_item("app", "Ship login", estimate_hours=3, actual_hours=4, due_on="2026-10-14")
    s.update_item(shipped["id"], status="done")
    _at(shipped["id"], completed_at="2026-10-15T16:00:00", created_at="2026-10-12T09:00:00")
    slipped = s.create_item("app", "Store screenshots", submit_on="2026-10-13", deploy_on="2026-10-20")
    _at(slipped["id"], created_at="2026-10-01T09:00:00")
    other = s.create_item("web", "Old thing")
    _at(other["id"], created_at="2026-09-01T09:00:00")
    s.add_note("app", "Use passkeys, not SMS", kind="decision")
    with db.tx() as conn:
        conn.execute("UPDATE notes SET created_at = '2026-10-14T10:00:00'")
    s.log_focus(50, item_id=shipped["id"], day="2026-10-13")
    s.log_focus(25, day="2026-10-20")  # the next week

    r = s.weekly_review("2026-10-15")
    assert (r["week"], r["start"], r["end"]) == ("2026-W42", "2026-10-12", "2026-10-18")
    assert [i["id"] for i in r["finished"]] == [shipped["id"]] == [i["id"] for i in r["finished_late"]]
    assert [i["id"] for i in r["created"]] == [shipped["id"]]
    assert [(e["type"], e["item"]["id"]) for e in r["slipped"]] == [("submit", slipped["id"])]
    assert [(e["type"], e["date"]) for e in r["next_week"]] == [("deploy", "2026-10-20")]
    assert r["focus_minutes"] == 50 and (r["estimate_hours"], r["actual_hours"]) == (3, 4)
    assert [n["body"] for n in r["decisions"]] == ["Use passkeys, not SMS"]
    assert r["by_project"] == [{"project": "app", "finished": 1, "created": 1}]
    md = r["markdown"]
    assert md.startswith("# Week 2026-W42") and "1 finished, 1 started, 1 slipped" in md
    assert "## Slipped" in md and "## Decisions and blockers" in md and "## Next week" in md

    assert s.weekly_review("2026-10-15", project="web")["finished"] == []


def test_review_api(client):
    r = client.get("/api/review").json()
    assert r["markdown"].startswith("# Week ") and r["finished"] == []
    md = client.get("/api/review.md?day=2026-10-15")
    assert md.headers["content-type"].startswith("text/markdown") and "2026-W42" in md.headers["content-disposition"]
