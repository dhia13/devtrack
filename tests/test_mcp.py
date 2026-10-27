"""The MCP tools agents call, over the real streamable HTTP endpoint."""

import json

import pytest

HEADERS = {"Accept": "application/json, text/event-stream", "Host": "localhost:8787"}


@pytest.fixture
def call(client):
    def call(tool, **arguments):
        r = client.post("/mcp", headers=HEADERS, json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": arguments}})
        assert r.status_code == 200
        result = r.json()["result"]
        if result.get("isError"):
            raise AssertionError(result["content"][0]["text"])
        if "structuredContent" in result:
            out = result["structuredContent"]
            return out.get("result", out)
        return json.loads(result["content"][0]["text"])
    return call


def test_create_update_and_list(call):
    it = call("create_item", project="demo", title="Ship it", branch="feat/ship", submit_on="tomorrow")
    assert it["project"] == "demo" and it["next_milestone"]["type"] == "submit"
    up = call("update_item", item_id=it["id"], status="parked", note="built early")
    assert up["status"] == "parked" and up["needs_redate"]
    assert [i["id"] for i in call("list_items", project="demo", status="parked")] == [it["id"]]
    assert call("get_item", item_id=it["id"])["notes"][0]["body"] == "built early"


def test_handoff_creates_user_todos(call):
    out = call("handoff", project="demo", summary="Done for today", author="agent-1",
               done=["API"], next_steps=["UI"], user_todos=["Set the prod secret"], user_todo_due="friday")
    todo = out["created_items"][0]
    assert todo["assignee"] == "me" and todo["kind"] == "followup" and todo["due_on"]
    assert any(i["id"] == todo["id"] for i in call("agenda", days=7)["waiting_on_me"])
    note = call("list_notes", project="demo", kind="handoff")[0]
    assert "**You need to**" in note["body"] and note["author"] == "agent-1"


def test_redate_plan_tool(call):
    it = call("create_item", project="demo", title="early", branch="feat/early", status="parked", submit_on="+2d")
    plan = call("redate_plan", item_id=it["id"])
    assert "git rebase --force-rebase" in plan["script"]


def test_invalid_input_is_a_tool_error(call):
    with pytest.raises(AssertionError, match="bad date"):
        call("create_item", project="demo", title="x", due_on="someday")


def test_cost_and_time_tools(call):
    call("create_item", project="demo", title="paid", cost=40, estimate_hours=2)
    costs = call("cost_summary", project="demo")
    assert costs["projects"][0]["open_estimate_hours"] == 2
    assert "projects" in call("time_report")
