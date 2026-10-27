import pytest

from app import service as s


def test_blocked_item_waits_then_unblocks_itself():
    api = s.create_item("demo", "API endpoint")
    ui = s.create_item("demo", "UI for it", blocked_by=f"#{api['id']}")
    assert ui["status"] == "blocked" and ui["blocked_by"] == [api["id"]] and ui["blocked_by_open"] == [api["id"]]
    assert s.get_item(ui["id"])["notes"][0]["body"] == f"Blocked by #{api['id']}."
    s.update_item(api["id"], status="in_progress")
    assert s.get_item(ui["id"])["status"] == "blocked"
    out = s.update_item(api["id"], status="merged")  # merged is enough: the code exists
    assert out["unblocked"] == [ui["id"]]
    freed = s.get_item(ui["id"])
    assert freed["status"] == "todo" and freed["blocked_by_open"] == [] and freed["blocked_by"] == [api["id"]]
    assert "Unblocked" in freed["notes"][0]["body"]


def test_waits_for_every_blocker():
    a, b = s.create_item("demo", "a"), s.create_item("demo", "b")
    c = s.update_item(s.create_item("demo", "c")["id"], blocked_by=[a["id"], b["id"]])
    assert c["status"] == "blocked"
    assert "unblocked" not in s.update_item(a["id"], status="done")
    assert s.get_item(c["id"])["status"] == "blocked"
    s.update_item(b["id"], status="cancelled")
    assert s.get_item(c["id"])["status"] == "todo"


def test_manual_status_is_left_alone():
    a = s.create_item("demo", "a")
    c = s.create_item("demo", "c", blocked_by=[a["id"]])
    s.update_item(c["id"], status="in_progress")  # the developer started anyway
    s.update_item(c["id"], status="in_progress", blocked_by=f"#{a['id']}")  # the dialog re-sends the same list
    assert s.get_item(c["id"])["status"] == "in_progress"
    s.update_item(a["id"], status="done")
    assert s.get_item(c["id"])["status"] == "in_progress"


def test_clear_and_finished_blockers_do_not_block():
    a = s.create_item("demo", "a", status="done")
    c = s.create_item("demo", "c", blocked_by=str(a["id"]))
    assert c["status"] == "todo" and c["blocked_by_open"] == []
    assert s.update_item(c["id"], blocked_by="")["blocked_by"] == []


@pytest.mark.parametrize("bad", ["abc", "#x1"])
def test_bad_numbers(bad):
    with pytest.raises(s.Invalid):
        s.create_item("demo", "c", blocked_by=bad)


def test_self_missing_and_cycles_refused():
    a = s.create_item("demo", "a")
    b = s.create_item("demo", "b", blocked_by=[a["id"]])
    c = s.create_item("demo", "c", blocked_by=[b["id"]])
    with pytest.raises(s.Invalid, match="itself"):
        s.update_item(a["id"], blocked_by=[a["id"]])
    with pytest.raises(s.NotFound):
        s.update_item(a["id"], blocked_by=[9999])
    with pytest.raises(s.Invalid, match="already waits"):
        s.update_item(a["id"], blocked_by=[c["id"]])  # a -> b -> c -> a
    assert s.get_item(a["id"])["blocked_by"] == []


def test_deleting_a_blocker_drops_the_link():
    a = s.create_item("demo", "a")
    c = s.create_item("demo", "c", blocked_by=[a["id"]])
    s.delete_item(a["id"])
    after = s.get_item(c["id"])
    assert after["blocked_by"] == [] and after["status"] == "todo"
