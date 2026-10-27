"""Invoice renderings: CSV for a spreadsheet, and a standalone page to print or save as PDF."""

import csv
import io
from html import escape
from urllib.parse import urlencode


def _money(n: float, cur: str) -> str:
    return f"{n:,.2f} {cur}"


def to_csv(inv: dict) -> str:
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["item", "title", "ticket", "done_on", "hours", "amount", "currency"])
    for line in inv["lines"]:
        w.writerow([f"#{line['id']}", line["title"], line["ticket_ref"] or "", line["done_on"],
                    f"{line['hours']:g}" if line["hours"] else "", f"{line['amount']:.2f}" if line["amount"] else "", line["currency"]])
    for cur, total in inv["totals"].items():
        w.writerow(["", "Total", "", "", f"{inv['total_hours']:g}", f"{total:.2f}", cur])
    return out.getvalue()


CSS = """
:root { color-scheme: light; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #15181d; }
body { margin: 0; background: #eef0f3; }
.sheet { max-width: 820px; margin: 24px auto; background: #fff; padding: 48px 56px; border-radius: 12px; box-shadow: 0 2px 20px #0001; }
header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 36px; }
h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -.02em; }
.muted { color: #69707d; }
.from, .to { white-space: pre-line; }
.meta { text-align: right; }
.meta b { display: block; font-size: 16px; }
.parties { display: flex; gap: 48px; margin-bottom: 28px; }
.parties h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #69707d; margin: 0 0 4px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #69707d; border-bottom: 1px solid #d9dce1; padding: 8px 6px; }
td { border-bottom: 1px solid #eceef1; padding: 9px 6px; vertical-align: top; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tfoot td { border: 0; font-weight: 650; padding-top: 14px; }
.note { margin-top: 28px; font-size: 13px; }
form { max-width: 820px; margin: 24px auto 0; display: flex; gap: 8px; flex-wrap: wrap; align-items: end; padding: 0 16px; }
form label { display: grid; gap: 2px; font-size: 12px; color: #69707d; }
input, button, .btn { font: inherit; color: inherit; text-decoration: none; padding: 6px 10px; border: 1px solid #c9cdd3; border-radius: 8px; background: #fff; }
button, .btn { cursor: pointer; }
button.primary { background: #2f6bff; border-color: #2f6bff; color: #fff; }
@media (max-width: 640px) { .sheet { padding: 24px 18px; margin: 12px; } header, .parties { flex-direction: column; gap: 12px; } .meta { text-align: left; } }
@media print { body { background: #fff; } form { display: none; } .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; } }
"""


def to_html(inv: dict) -> str:
    e = lambda v: escape(str(v)) if v is not None else ""
    def row(line):
        ref = f" · {e(line['ticket_ref'])}" if line["ticket_ref"] else ""
        hours = f"{line['hours']:g}h" if line["hours"] else "–"
        amount = _money(line["amount"], line["currency"]) if line["amount"] else "–"
        return (f"<tr><td>{e(line['title'])}<div class='muted'>#{line['id']}{ref}</div></td>"
                f"<td class='num'>{e(line['done_on'])}</td><td class='num'>{hours}</td><td class='num'>{amount}</td></tr>")

    rows = "".join(map(row, inv["lines"])) or "<tr><td colspan='4' class='muted'>No finished items in this period.</td></tr>"
    totals = "".join(f"<tr><td>Total</td><td></td><td class='num'>{inv['total_hours']:g}h</td><td class='num'>{_money(v, k)}</td></tr>"
                     for k, v in inv["totals"].items()) or f"<tr><td>Total</td><td></td><td class='num'>{inv['total_hours']:g}h</td><td class='num'>–</td></tr>"
    rate = f"Hours without a fixed cost are billed at {_money(inv['rate'], inv['currency'])} an hour. " if inv["rate"] else ""
    n = inv["unpriced"]
    unpriced = f"{n} item{'s' if n != 1 else ''} with no cost, and no hours at a rate, {'are' if n != 1 else 'is'} listed without an amount." if n else ""
    rate_value = f"{inv['rate']:g}" if inv["rate"] else ""
    back = urlencode({"project": inv["project"], "start": inv["start"], "end": inv["end"], "number": inv["number"], **({"rate": rate_value} if rate_value else {})})
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice {e(inv['number'])}</title><style>{CSS}</style></head><body>
<form method="get" action="/api/invoice.html">
  <input type="hidden" name="project" value="{e(inv['project'])}">
  <label>From<input type="date" name="start" value="{e(inv['start'])}"></label>
  <label>To<input type="date" name="end" value="{e(inv['end'])}"></label>
  <label>Rate per hour<input type="number" name="rate" min="0" step="any" value="{rate_value}" style="width:110px"></label>
  <label>Number<input name="number" value="{e(inv['number'])}" style="width:150px"></label>
  <button>Update</button>
  <button type="button" class="primary" onclick="print()">Print or save as PDF</button>
  <a class="btn" href="/api/invoice.csv?{e(back)}" download>CSV</a>
</form>
<main class="sheet">
  <header><div><h1>Invoice</h1><div class="muted">{e(inv['start'])} to {e(inv['end'])}</div></div>
    <div class="meta"><b>{e(inv['number'])}</b><span class="muted">Issued {e(inv['issued_on'])}</span></div></header>
  <div class="parties">
    {f"<div><h3>From</h3><div class='from'>{e(inv['from'])}</div></div>" if inv['from'] else ""}
    <div><h3>Bill to</h3><div class="to">{e(inv['client'])}</div></div>
  </div>
  <table><thead><tr><th>Work</th><th class="num">Done</th><th class="num">Hours</th><th class="num">Amount</th></tr></thead>
    <tbody>{rows}</tbody><tfoot>{totals}</tfoot></table>
  <p class="note muted">{rate}{unpriced}</p>
</main></body></html>"""
