"""Drive the dashboard in a real browser: every view renders without a JS error, and the command
bar can create an item. Skipped unless the playwright package is installed (CI installs it).

    pip install playwright && python -m playwright install chromium
    python -m pytest -m e2e
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api")
pytestmark = pytest.mark.e2e

ROOT = Path(__file__).resolve().parents[2]
VIEWS = ("home", "tasks", "agenda", "calendar", "projects", "insights", "activity", "settings")


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    """A real uvicorn on its own database, like the container runs it."""
    data, port = tmp_path_factory.mktemp("e2e"), _free_port()
    env = {**os.environ, "DEVTRACK_DB": str(data / "devtrack.db"), "DEVTRACK_BACKUP_DIR": str(data / "backups"),
           "DEVTRACK_GIT_SYNC_MINUTES": "0", "DEVTRACK_SEED_PROJECTS": "demo"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f"http://localhost:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("server did not start:\n" + proc.stdout.read().decode())
    yield base
    proc.terminate()
    proc.wait(10)


def _api(base, path, body=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


@pytest.fixture
def page(server):
    with sync_api.sync_playwright() as pw:
        # Use a pre-installed browser when one is given (e.g. CHROMIUM_PATH=/opt/pw-browsers/...).
        browser = pw.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
        pg = browser.new_page()
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)))
        pg.on("response", lambda r: r.status >= 400 and pg.errors.append(f"{r.status} {r.url}"))
        pg.goto(server)
        yield pg
        browser.close()


def test_every_view_renders(server, page):
    _api(server, "/api/items", {"project": "demo", "title": "Seeded item", "due_on": "tomorrow", "assignee": "me"})
    page.reload()
    for view in VIEWS:
        page.click(f'#nav button[data-view="{view}"]')
        page.wait_for_function("document.querySelector('#view').children.length > 0")
        page.wait_for_load_state("networkidle")
    page.click('#nav button[data-view="tasks"]')
    page.get_by_text("Seeded item").first.wait_for()
    assert page.errors == []


def test_command_bar_creates_an_item(server, page):
    page.keyboard.press("Control+K")
    page.fill("#ckq", "Smoke test from the command bar demo high")
    page.keyboard.press("Shift+Enter")
    for _ in range(50):
        titles = {i["title"]: i for i in _api(server, "/api/items?project=demo")}
        if "Smoke test from the command bar" in titles:
            break
        time.sleep(0.1)
    assert titles["Smoke test from the command bar"]["priority"] == "high"
    assert page.errors == []


def test_repeating_item_shows_its_period(server, page):
    _api(server, "/api/items", {"project": "demo", "title": "Weekly invoice run", "repeat_every": "weekly"})
    page.reload()
    page.click('#nav button[data-view="tasks"]')
    page.get_by_text("↻ 1w").first.wait_for()
    assert page.errors == []


def test_bell_lists_what_waits_on_you(server, page):
    _api(server, "/api/items", {"project": "demo", "title": "Approve the store listing", "assignee": "me", "due_on": "today"})
    page.reload()
    page.click("#tBell")
    menu = page.locator("#bellMenu")
    menu.get_by_text("Approve the store listing").wait_for()
    assert page.get_attribute("#tBell", "aria-expanded") == "true"
    page.keyboard.press("Escape")
    menu.wait_for(state="hidden")
    page.click("#tBell")
    menu.get_by_text("Approve the store listing").click()  # opens the item
    page.locator("#itemDlg[open]").wait_for()
    assert page.input_value("#itemForm [name=title]") == "Approve the store listing"
    assert page.errors == []


def test_blocked_by_field_round_trips(server, page):
    first = _api(server, "/api/items", {"project": "demo", "title": "Write the API"})
    second = _api(server, "/api/items", {"project": "demo", "title": "Build the screen", "blocked_by": [first["id"]]})
    page.reload()
    page.click('#nav button[data-view="tasks"]')
    page.get_by_text(f"blocked by #{first['id']}").first.wait_for()
    page.evaluate(f"openItem({second['id']})")
    page.locator("#itemDlg[open]").wait_for()
    assert page.input_value("#itemForm [name=blocked_by]") == f"#{first['id']}"
    assert page.errors == []
