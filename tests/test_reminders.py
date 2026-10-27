from datetime import date, timedelta

from app import config, service as s

TODAY = date.today()
iso = lambda n: (TODAY + timedelta(days=n)).isoformat()


def test_reminders_for_today():
    assert s.reminders() == {"today": TODAY.isoformat(), "due_today": [], "overdue": [], "back_today": [],
                             "waiting_on_me": 0, "summary": "Nothing due today."}
    due = s.create_item("app", "Ship it", deploy_on=iso(0))
    s.create_item("app", "Late", due_on=iso(-2), assignee="me")
    back = s.create_item("app", "Ask the client", waiting_for="client", snoozed_until=iso(0))
    s.create_item("app", "Later", due_on=iso(3))
    r = s.reminders()
    assert [(e["type"], e["item"]["id"]) for e in r["due_today"]] == [("deploy", due["id"])]
    assert [e["item"]["title"] for e in r["overdue"]] == ["Late"]
    assert [i["id"] for i in r["back_today"]] == [back["id"]]
    assert r["summary"] == "1 due today, 1 overdue, 1 back from hold."
    s.upsert_project("quiet")
    assert s.reminders(project="quiet")["summary"] == "Nothing due today."


def test_calendar_alerts_open_milestones_only(monkeypatch):
    s.create_item("demo", "open", due_on=iso(1))
    s.create_item("demo", "finished", due_on=iso(1), status="done")
    ics = s.calendar_ics("demo", include_closed=True)
    assert ics.count("BEGIN:VALARM") == 1 and "TRIGGER;RELATED=START:PT9H0M" in ics
    assert "DESCRIPTION:Due today: open" in ics
    monkeypatch.setattr(config, "ICS_ALERT", "")
    assert "VALARM" not in s.calendar_ics("demo")


def test_reminders_api(client):
    assert client.get("/api/reminders").json()["summary"] == "Nothing due today."
