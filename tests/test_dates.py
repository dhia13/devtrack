from datetime import date

import pytest

from app import service as s

FRIDAY = date(2026, 10, 30)


@pytest.fixture
def on(monkeypatch):
    def set_today(day: date):
        class Fixed(date):
            @classmethod
            def today(cls):
                return day
        monkeypatch.setattr(s, "date", Fixed)
    return set_today


@pytest.mark.parametrize("text, expected", [
    ("friday", FRIDAY),                 # today counts as "friday"
    ("next friday", date(2026, 11, 6)),  # but "next" always moves on
    ("Monday", date(2026, 11, 2)),
    ("  TOMORROW ", date(2026, 10, 31)),
    ("+0d", FRIDAY),
    ("+45d", date(2026, 12, 14)),
    ("2026-02-28", date(2026, 2, 28)),
    ("2026-03-01T10:00:00", date(2026, 3, 1)),
])
def test_parse_date(on, text, expected):
    on(FRIDAY)
    assert s.parse_date(text) == expected


@pytest.mark.parametrize("text", ["2026-02-30", "-3d", "next", "fri", "", "next tomorrow"])
def test_parse_date_rejects(on, text):
    on(FRIDAY)
    with pytest.raises(s.Invalid):
        s.parse_date(text)


def test_parse_datetime(on):
    on(FRIDAY)
    assert s.parse_datetime("2026-11-02 14:30") == "2026-11-02T14:30:00"
    assert s.parse_datetime("2026-11-02T14:30:00+02:00") == "2026-11-02T14:30:00"  # zone dropped, local time kept
    assert s.parse_datetime("tomorrow") == "2026-10-31T09:00:00"
    with pytest.raises(s.Invalid):
        s.parse_datetime("2026-11-02T25:00")


def test_snooze_and_overdue_follow_today(on):
    on(FRIDAY)
    held = s.create_item("demo", "waits", snoozed_until="monday", waiting_for="shop")
    assert held["on_hold"] and not held["back_today"]
    late = s.create_item("demo", "late", due_on="2026-10-29")
    assert late["overdue"]
    on(date(2026, 11, 2))
    back = s.get_item(held["id"])
    assert back["back_today"] and not back["on_hold"]
