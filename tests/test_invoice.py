import pytest

from app import db, service as s


def _done(project, title, on, **fields):
    it = s.create_item(project, title, status="done", **fields)
    with db.tx() as conn:
        conn.execute("UPDATE items SET completed_at = ? WHERE id = ?", (on + "T15:00:00", it["id"]))
    return it


def test_invoice_lines_and_totals():
    fixed = _done("acme", "Checkout page", "2026-10-05", cost=400, actual_hours=6, ticket_ref="AC-12")
    hourly = _done("acme", "Fix <script> bug", "2026-10-09", actual_hours=2.5)
    _done("acme", "Kick-off call", "2026-10-10")
    _done("acme", "Last month", "2026-09-28", cost=99)
    _done("other", "Not this client", "2026-10-06", cost=50)
    s.create_item("acme", "Still open", cost=10)

    inv = s.invoice("acme", "2026-10-01", "2026-10-31", rate=80)
    assert [line["id"] for line in inv["lines"]][:2] == [fixed["id"], hourly["id"]] and len(inv["lines"]) == 3
    assert [line["amount"] for line in inv["lines"]] == [400, 200, None]
    assert [line["basis"] for line in inv["lines"]] == ["cost", "rate", None]
    assert inv["totals"] == {"USD": 600} and inv["total_hours"] == 8.5 and inv["unpriced"] == 1
    assert inv["number"] == "ACME-202610" and inv["client"] == "acme"
    assert s.invoice("acme", "2026-10-01", "2026-10-31")["totals"] == {"USD": 400}  # no rate: hours alone bill nothing


def test_invoice_refuses_bad_input():
    s.upsert_project("acme")
    with pytest.raises(s.Invalid):
        s.invoice("acme", "2026-10-31", "2026-10-01")
    with pytest.raises(s.Invalid):
        s.invoice("acme", rate="lots")
    with pytest.raises(s.Invalid):
        s.invoice("acme", rate=-1)
    with pytest.raises(s.NotFound):
        s.invoice("nobody")


def test_invoice_endpoints(client):
    _done("acme", "Fix <script> bug", "2026-10-09", actual_hours=2, ticket_ref="AC-9")
    q = "project=acme&start=2026-10-01&end=2026-10-31&rate=50"
    assert client.get("/api/invoice?" + q).json()["totals"] == {"USD": 100}
    csv = client.get("/api/invoice.csv?" + q)
    assert "invoice-ACME-202610.csv" in csv.headers["content-disposition"]
    assert csv.text.splitlines()[1].endswith(",Fix <script> bug,AC-9,2026-10-09,2,100.00,USD")
    page = client.get("/api/invoice.html?" + q + "&number=INV-7")
    assert page.headers["content-type"].startswith("text/html")
    assert "Fix &lt;script&gt; bug" in page.text and "<script>" not in page.text and "INV-7" in page.text
    assert "100.00 USD" in page.text and "50.00 USD an hour" in page.text
    assert client.get("/api/invoice.html?project=acme&start=2026-01-01&end=2026-01-31").status_code == 200
