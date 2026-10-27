from datetime import date

import pytest

from app import service as s


@pytest.fixture
def today(monkeypatch):
    def set_today(day: date):
        class Fixed(date):
            @classmethod
            def today(cls):
                return day
        monkeypatch.setattr(s, "date", Fixed)
    return set_today


@pytest.mark.parametrize("text, canon", [("weekly", "1w"), ("every 90 days", "90d"), ("2w", "2w"), ("Monthly", "1m"),
                                         ("quarterly", "3m"), ("1 year", "1y"), ("d", "1d")])
def test_parse_repeat(text, canon):
    assert s.parse_repeat(text) == canon


@pytest.mark.parametrize("text", ["0d", "sometimes", "3 fortnights", "-1w", "5000d"])
def test_parse_repeat_rejects(text):
    with pytest.raises(s.Invalid):
        s.parse_repeat(text)


def test_shift_date_clamps_month_ends():
    assert s.shift_date(date(2026, 1, 31), "1m") == date(2026, 2, 28)
    assert s.shift_date(date(2026, 1, 31), "1m", times=2) == date(2026, 3, 31)  # from the original day, not Feb 28
    assert s.shift_date(date(2028, 2, 29), "1y") == date(2029, 2, 28)
    assert s.shift_date(date(2026, 12, 15), "1m") == date(2027, 1, 15)
    assert s.shift_date(date(2026, 1, 1), "2w") == date(2026, 1, 15)


def test_finishing_a_repeating_item_schedules_the_next(today):
    today(date(2026, 10, 27))
    it = s.create_item("ops", "Renew TLS cert", repeat_every="90d", due_on="2026-10-27", assignee="me",
                       priority="high", estimate_hours=1, description="- [x] renew\n- [x] reload nginx",
                       branch="chore/cert", actual_hours=2)
    done = s.update_item(it["id"], status="done")
    nxt = s.get_item(done["next_occurrence"]["id"])
    assert nxt["title"] == "Renew TLS cert" and nxt["status"] == "todo" and nxt["repeat_every"] == "90d"
    assert nxt["due_on"] == "2027-01-25" and nxt["repeat_of"] == it["id"]
    assert nxt["description"] == "- [ ] renew\n- [ ] reload nginx"
    assert (nxt["assignee"], nxt["priority"], nxt["estimate_hours"]) == ("me", "high", 1)
    assert nxt["branch"] is None and nxt["actual_hours"] is None
    assert "next is #" in s.get_item(it["id"])["notes"][0]["body"]
    # reopening and finishing again doesn't make a second copy
    s.update_item(it["id"], status="todo")
    assert "next_occurrence" not in s.update_item(it["id"], status="done")
    assert len(s.list_items("ops")) == 1


def test_late_finish_skips_to_the_next_future_period_and_keeps_gaps(today):
    today(date(2026, 10, 27))
    it = s.create_item("demo", "Weekly release", repeat_every="weekly", submit_on="2026-10-05", deploy_on="2026-10-07")
    nxt = s.update_item(it["id"], status="done")["next_occurrence"]
    assert (nxt["submit_on"], nxt["deploy_on"]) == ("2026-11-02", "2026-11-04")


def test_undated_repeat_is_due_one_period_from_today(today):
    today(date(2026, 10, 27))
    it = s.create_item("demo", "Review costs", repeat_every="monthly")
    assert s.update_item(it["id"], status="done")["next_occurrence"]["due_on"] == "2026-11-27"


def test_cancelled_does_not_repeat():
    it = s.create_item("demo", "x", repeat_every="1d")
    assert "next_occurrence" not in s.update_item(it["id"], status="cancelled")
    assert s.list_items("demo") == []
