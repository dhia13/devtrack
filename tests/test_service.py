from datetime import date, timedelta

import pytest

from app import service as s

TODAY = date.today()


def iso(days=0):
    return (TODAY + timedelta(days=days)).isoformat()


def test_relative_dates():
    assert s.parse_date("today") == TODAY
    assert s.parse_date("tomorrow") == TODAY + timedelta(days=1)
    assert s.parse_date("+3d") == TODAY + timedelta(days=3)
    friday = s.parse_date("friday")
    assert friday.weekday() == 4 and 0 <= (friday - TODAY).days < 7
    assert (s.parse_date("next friday") - TODAY).days >= 1
    with pytest.raises(s.Invalid):
        s.parse_date("someday")


def test_item_created_closed_gets_completed_at():
    done = s.create_item("demo", "Already done", status="done")
    assert done["completed_at"]
    open_ = s.create_item("demo", "Still open")
    assert open_["completed_at"] is None
    assert s.update_item(open_["id"], status="done")["completed_at"]
    assert s.update_item(open_["id"], status="todo")["completed_at"] is None


def test_unknown_field_and_bad_enum_rejected():
    with pytest.raises(s.Invalid):
        s.create_item("demo", "x", colour="red")
    with pytest.raises(s.Invalid):
        s.create_item("demo", "x", status="finished")


def test_hold_rules_and_counts():
    it = s.create_item("demo", "Ask the shop for prices", assignee="me")

    def waiting_ids():
        return [i["id"] for i in s.agenda(7, "demo")["waiting_on_me"]]

    def my_items():
        return next(p for p in s.list_projects() if p["slug"] == "demo")

    assert waiting_ids() == [it["id"]] and my_items()["my_items"] == 1

    held = s.update_item(it["id"], waiting_for="shop", snoozed_until="+3d")
    assert held["on_hold"] and not held["back_today"]
    assert waiting_ids() == []
    assert [i["id"] for i in s.agenda(7, "demo")["on_hold"]] == [it["id"]]
    assert my_items()["my_items"] == 0 and my_items()["on_hold_items"] == 1

    back = s.update_item(it["id"], snoozed_until="today")
    assert not back["on_hold"] and back["back_today"]
    assert waiting_ids() == [it["id"]]

    # waiting on someone with no check-back date stays held
    still = s.update_item(it["id"], snoozed_until=None)
    assert still["on_hold"] and my_items()["my_items"] == 0

    cleared = s.update_item(it["id"], waiting_for=None)
    assert not cleared["on_hold"] and my_items()["my_items"] == 1


def test_closed_item_is_never_on_hold():
    it = s.create_item("demo", "x", waiting_for="ops", status="done")
    assert not it["on_hold"]


def test_agenda_overdue_and_upcoming():
    late = s.create_item("demo", "late", due_on=iso(-2))
    soon = s.create_item("demo", "soon", submit_on=iso(1))
    a = s.agenda(7, "demo")
    assert [e["item"]["id"] for e in a["overdue"]] == [late["id"]]
    assert [(e["item"]["id"], e["type"]) for e in a["upcoming"]] == [(soon["id"], "submit")]
    s.update_item(soon["id"], status="submitted")  # milestone reached
    assert s.agenda(7, "demo")["upcoming"] == []


def test_parked_sets_built_on_and_needs_redate():
    it = s.create_item("demo", "early", branch="feat/x", submit_on=iso(5), status="parked")
    assert it["built_on"] == TODAY.isoformat() and it["needs_redate"]
    plan = s.redate_plan(it["id"])
    assert "git rebase" in plan["script"] and plan["date"] == iso(5)


def test_ics_escapes_text():
    s.create_item("demo", "a, b; c", due_on=iso(1), branch="feat/x")
    ics = s.calendar_ics("demo")
    assert "a\\, b\\; c" in ics
    assert "\\nAssignee" in ics  # newline in DESCRIPTION is escaped, not raw
    assert all(len(line.encode()) <= 75 for line in ics.split("\r\n"))


def test_focus_log_and_time_report():
    it = s.create_item("demo", "focus target", estimate_hours=2)
    s.log_focus(25, item_id=it["id"])
    s.log_focus(30)  # no item
    s.update_item(it["id"], status="done", actual_hours=3)
    daily = s.focus_daily(7)
    assert daily[TODAY.isoformat()] == 55
    r = s.time_report()
    demo = next(p for p in r["projects"] if p["project"] == "demo")
    assert demo["focus_minutes"] == 25 and demo["finished"] == 1
    assert demo["estimate_hours"] == 2 and demo["actual_hours"] == 3
    assert demo["paired"] == 1 and demo["paired_actual"] / demo["paired_estimate"] == 1.5
    assert any(p["project"] == "(no item)" and p["focus_minutes"] == 30 for p in r["projects"])
    with pytest.raises(s.Invalid):
        s.log_focus(0)
    assert s.import_focus({"2026-01-05": 40, "2026-01-06": 0}) == {"imported_days": 1}
    assert s.clear_focus()["deleted"] == 3
