const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VIEWS = ["home", "tasks", "agenda", "calendar", "projects", "insights", "review", "activity", "settings"];
const state = { view: "home", meta: null, projects: [], templates: [], selected: new Set(), expanded: {}, meProject: "",
  tl: { project: "", status: "", type: "" },
  cal: { mode: "month", anchor: null, types: { submit: true, merge: true, deploy: true, due: true }, done: true },
  tasks: { mode: "board", mine: false, priority: "" }, ins: { range: 30 }, review: { day: "" },
  filters: { status: "", assignee: "", search: "", closed: false } };
try { const s = JSON.parse(localStorage.getItem("devtrack-ui") || "{}"); state.view = VIEWS.includes(s.view) ? s.view : s.view === "items" ? "tasks" : "home"; Object.assign(state.filters, s.filters || {}); state.project = s.project; state.meProject = s.meProject || ""; Object.assign(state.tl, s.tl || {}); Object.assign(state.tasks, s.tasks || {}); Object.assign(state.ins, s.ins || {}); if (s.cal) { state.cal.mode = s.cal.mode || "month"; Object.assign(state.cal.types, s.cal.types || {}); state.cal.done = s.cal.done ?? true; } } catch {}
const persist = () => { try { localStorage.setItem("devtrack-ui", JSON.stringify({ view: state.view, filters: state.filters, project: projectFilter.value, meProject: state.meProject, tl: state.tl, tasks: state.tasks, ins: state.ins, cal: { mode: state.cal.mode, types: state.cal.types, done: state.cal.done } })); } catch {} };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- appearance (per browser)
const LOOK_DEFAULT = { theme: "auto", wall: "ash", accent: "blue", glass: "tinted", solid: false, focusMin: 25, breakMin: 5, goalMin: 120, sound: true };
const look = { ...LOOK_DEFAULT, ...store.get("devtrack-look", {}) };
const WALLS = ["ash", "sand", "sage", "aurora", "smoke", "tide", "bloom", "ember", "grove", "dusk"];
const ACCENTS = { blue: "#2f6fde", purple: "#7c5ce0", pink: "#d63f7f", orange: "#d4621f", green: "#1f9254", graphite: "#5d6673" };
function applyLook() {
  const r = document.documentElement;
  if (look.theme === "auto") delete r.dataset.theme; else r.dataset.theme = look.theme;
  r.dataset.wall = look.wall; r.dataset.accent = look.accent; r.dataset.glass = look.glass;
  if (look.solid) r.dataset.solid = ""; else delete r.dataset.solid;
  store.set("devtrack-look", look);
}
const isDark = () => look.theme === "dark" || (look.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);

// ---------- project colours: fixed categorical slot per project (by id), never by rank
function pcolor(slug) {
  const i = [...state.projects].sort((a, b) => a.id - b.id).findIndex(p => p.slug === slug);
  return i >= 0 && i < 8 ? `var(--p${i + 1})` : "var(--faint)";
}
const pchip = (slug, box = false) => `<span class="pchip${box ? " box" : ""}" style="--pc:${pcolor(slug)}">${esc(slug)}</span>`;
const FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>';
const flag = p => ["urgent", "high"].includes(p) ? `<span class="flag ${p}">${FLAG}${p === "urgent" ? "Urgent" : "High"}</span>` : "";

// ---------- hold (waiting for someone / snoozed)
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const BRANCH_I = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 5-8 3-12 7"/></svg>';
function holdDate(k) {
  const t = parseISO(todayISO());
  if (k === "mon") return toISO(addDays(t, ((8 - t.getDay()) % 7) || 7));
  return toISO(addDays(t, +k));
}
const holdTag = it => it.on_hold
  ? `<span class="tag hold" title="On hold${it.snoozed_until ? " until " + fmtDate(it.snoozed_until) : ""}">${it.waiting_for ? "waiting: " + esc(it.waiting_for) : "snoozed"}${it.snoozed_until ? " · " + fmtDate(it.snoozed_until, { day: "numeric", month: "short" }) : ""}</span>`
  : it.back_today ? `<span class="tag back" title="Its check-back day has come">back${it.waiting_for ? " from " + esc(it.waiting_for) : ""}</span>` : "";
const depTag = it => it.blocked_by_open?.length ? `<span class="tag dep" title="Waiting on ${it.blocked_by_open.map(i => "#" + i).join(", ")}">blocked by ${it.blocked_by_open.map(i => "#" + i).join(" ")}</span>` : "";
const repeatTag = it => it.repeat_every ? `<span class="tag" title="Repeats every ${esc(it.repeat_every)}: finishing it schedules the next one">↻ ${esc(it.repeat_every)}</span>` : "";
const nextNote = saved => (saved.next_occurrence ? ` · next #${saved.next_occurrence.id}${saved.next_occurrence.due_on ? " due " + fmtDate(saved.next_occurrence.due_on) : ""}` : "")
  + (saved.unblocked?.length ? ` · unblocked ${saved.unblocked.map(i => "#" + i).join(" ")}` : "");
const holdBtn = it => `<button type="button" class="ibtn" data-hold="${it.id}" title="${it.on_hold ? "Change hold" : "Put on hold"}" aria-label="Put ${esc(it.title)} on hold">${CLOCK}</button>`;
state.waitingVals = new Set();
const noteWaiting = list => list.forEach(i => i.waiting_for && state.waitingVals.add(i.waiting_for));
function fillWaitingList() { $("#waitingList").innerHTML = [...state.waitingVals].sort().map(v => `<option value="${esc(v)}">`).join(""); }

// ---------- git badges (from the last sync)
function gitBadges(it, { full = false } = {}) {
  const g = it.git; if (!g) return "";
  const out = [];
  if (g.mr_state) out.push(`<a class="gb mr-${g.mr_state}" href="${esc(g.mr_url || it.pr_url || "#")}" target="_blank" rel="noopener noreferrer" title="Merge request ${g.mr_state}">MR ${g.mr_state}</a>`);
  if (g.ahead) out.push(`<span class="gb" title="${g.ahead} commit${g.ahead === 1 ? "" : "s"} ahead of ${esc(g.base_ref || "base")}">${BRANCH_I}${g.ahead}↑</span>`);
  if (g.on_remote === 0 && (g.ahead || full)) out.push(`<span class="gb warn" title="This branch isn't on the remote yet">not pushed</span>`);
  else if (g.unpushed) out.push(`<span class="gb warn" title="${g.unpushed} local commit(s) not pushed">${g.unpushed} unpushed</span>`);
  if (g.early_commits && it.status === "parked") out.push(`<span class="gb warn" title="${g.early_commits} commit(s) dated before submit day: run the re-date script">${g.early_commits} to re-date</span>`);
  return out.join("");
}
function gitLine(it) {
  const g = it.git; if (!g) return it.branch ? `<span>Not synced yet.</span>` : "";
  const bits = [];
  if (g.repos?.length) bits.push(`<span class="mono">${esc(g.repos.join(", "))}</span>`);
  if (g.ahead != null) bits.push(`<span>${g.ahead} ahead, ${g.behind || 0} behind <span class="mono">${esc(g.base_ref)}</span></span>`);
  if (g.last_commit_at) bits.push(`<span>last commit ${ago(g.last_commit_at)}</span>`);
  bits.push(gitBadges(it, { full: true }));
  if (g.error) bits.push(`<span class="err">${esc(g.error)}</span>`);
  return bits.join("") + `<span style="flex-basis:100%;color:var(--faint);font-size:11.5px">Synced ${ago(g.checked_at)}</span>`;
}

const holdDlg = $("#holdDlg"), holdForm = $("#holdForm");
let holding = null;
async function openHold(id) {
  holding = await api(`/api/items/${id}`);
  holdForm.reset(); fillWaitingList();
  $("#holdItem").textContent = `#${holding.id} ${holding.title}`;
  holdForm.waiting_for.value = holding.waiting_for || ""; holdForm.snoozed_until.value = holding.snoozed_until || "";
  $("#unhold").hidden = !(holding.waiting_for || holding.snoozed_until);
  holdDlg.showModal(); holdForm.waiting_for.focus();
}
async function saveHold(fields) {
  const prev = { waiting_for: holding.waiting_for || null, snoozed_until: holding.snoozed_until || null }, id = holding.id;
  try {
    const it = await api(`/api/items/${id}`, { method: "PATCH", body: fields });
    holdDlg.close();
    const msg = it.on_hold ? `#${id} on hold${it.snoozed_until ? " until " + fmtDate(it.snoozed_until) : ""}` : `#${id} back on your list`;
    toast(msg, { label: "Undo", run: async () => { await api(`/api/items/${id}`, { method: "PATCH", body: prev }); toast("Undone"); await loadProjects(); render(); } });
    await loadProjects(); render();
  } catch (err) { toast(err.message); }
}
holdForm.addEventListener("submit", e => {
  e.preventDefault();
  const w = holdForm.waiting_for.value.trim(), d = holdForm.snoozed_until.value;
  if (!w && !d) return holdForm.waiting_for.focus();
  saveHold({ waiting_for: w || null, snoozed_until: d || null });
});
$("#unhold").onclick = () => saveHold({ waiting_for: null, snoozed_until: null });
document.addEventListener("click", e => {
  const q = e.target.closest("[data-hold-in]"); if (!q) return;
  const form = q.closest("form"), inp = form.snoozed_until;
  inp.value = q.dataset.holdIn === "clear" ? "" : holdDate(q.dataset.holdIn);
  if (q.dataset.holdIn === "clear") form.waiting_for.value = "";
  inp.dispatchEvent(new Event("change", { bubbles: true }));
});

// ---------- focus sessions (the island keeps the time)
// Focus history lives on the server (focus_sessions); this is a {day: minutes} cache of it.
const focusLog = {};
async function loadFocus() {
  try {
    const old = store.get("devtrack-focuslog", null); // history kept in the browser before v3
    if (old && Object.keys(old).length) { await api("/api/focus/import", { method: "POST", body: { log: old } }); localStorage.removeItem("devtrack-focuslog"); }
    const d = await api("/api/focus/daily?days=400");
    Object.keys(focusLog).forEach(k => delete focusLog[k]); Object.assign(focusLog, d);
  } catch {}
}
let focusS = store.get("devtrack-focus", null);
const focusLeft = () => !focusS ? 0 : focusS.endsAt ? Math.max(0, Math.round((focusS.endsAt - Date.now()) / 1000)) : focusS.left;
const mmss = s => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const saveFocus = () => store.set("devtrack-focus", focusS);
function logFocus(min, itemId, startedAt) {
  if (min < 1) return; const d = todayISO();
  focusLog[d] = Math.round((focusLog[d] || 0) + min);
  api("/api/focus", { method: "POST", body: { minutes: min, item_id: itemId || null, started_at: startedAt } })
    .catch(e => toast(`Focus not saved: ${e.message}`));
}
function startFocus(min = look.focusMin, item = null, mode = "focus") {
  focusS = { mode, total: min * 60, startedAt: Date.now(), endsAt: Date.now() + min * 6e4, left: null, itemId: item?.id || null, title: item?.title || (mode === "focus" ? `${min}-minute block` : "Break") };
  saveFocus(); paintFocus(); island.classList.add("pulse"); setTimeout(() => island.classList.remove("pulse"), 500);
}
function focusAction(a) {
  if (!focusS) return;
  if (a === "pause") {
    if (focusS.endsAt) { focusS.left = focusLeft(); focusS.endsAt = null; } else { focusS.endsAt = Date.now() + focusS.left * 1000; focusS.left = null; }
  } else if (a === "plus5") {
    focusS.total += 300; if (focusS.endsAt) focusS.endsAt += 3e5; else focusS.left += 300;
  } else if (a === "end") return finishFocus(false);
  saveFocus(); paintFocus();
}
function beep() {
  if (!look.sound) return;
  try { const c = new AudioContext(); [0, .18].forEach(t => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(.0001, c.currentTime + t); g.gain.exponentialRampToValueAtTime(.2, c.currentTime + t + .02); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + t + .15); o.start(c.currentTime + t); o.stop(c.currentTime + t + .16); }); } catch {}
}
async function logToItem(id, min) {
  const it = await api(`/api/items/${id}`);
  const actual = Math.round(((it.actual_hours || 0) + min / 60) * 100) / 100;
  await api(`/api/items/${id}`, { method: "PATCH", body: { actual_hours: actual } });
  toast(`Logged ${min}m on #${id} · ${actual}h total`); render();
}
function finishFocus(completed) {
  const s = focusS; if (!s) return;
  const min = Math.round((s.total - focusLeft()) / 60);
  focusS = null; saveFocus();
  if (s.mode === "focus") {
    logFocus(min, s.itemId, new Date(s.startedAt || Date.now() - min * 6e4).toISOString().slice(0, 19));
    if (completed) { beep(); startFocus(look.breakMin, null, "break"); }
    else paintFocus();
    const act = s.itemId && min >= 1 ? { label: `Log ${min}m to #${s.itemId}`, run: () => logToItem(s.itemId, min) } : null;
    toast(completed ? `Focus done: ${min} min${act ? "" : ". Break started"}` : `Session ended · ${min} min focused`, act);
  } else { paintFocus(); if (completed) { beep(); toast("Break over. Ready for the next block?", { label: "Start", run: () => startFocus() }); } }
  if (state.view === "home") render();
}
function paintFocus() {
  const on = !!focusS, left = focusLeft();
  island.classList.toggle("idle", !on && !island.classList.contains("toasting"));
  if (!on) island.classList.remove("open");
  island.classList.toggle("break", focusS?.mode === "break");
  island.classList.toggle("paused", !!focusS && !focusS.endsAt);
  if (on) {
    $("#isTime").textContent = mmss(left);
    $("#isMode").textContent = focusS.mode === "break" ? "Break" : focusS.endsAt ? "Focus session" : "Paused";
    $("#isTitle").textContent = focusS.itemId ? `#${focusS.itemId} ${focusS.title}` : focusS.title;
    $(".ring .fg", island).style.strokeDashoffset = 56.55 * (1 - left / focusS.total);
  }
  const dial = $("#dial");
  if (dial) {
    const total = focusS?.total || look.focusMin * 60, l = on ? left : total;
    $(".fg", dial).style.strokeDashoffset = 364.4 * (1 - l / total);
    $(".t b", dial).textContent = mmss(l);
    $(".t small", dial).textContent = !on ? "Ready" : focusS.mode === "break" ? "Break" : focusS.endsAt ? "Focusing" : "Paused";
    dial.classList.toggle("break", focusS?.mode === "break");
    $$("[data-fstate]").forEach(b => b.hidden = (b.dataset.fstate === "idle") === on);
    const pb = $('[data-focus="pause"] span', $("#view")); if (pb) pb.textContent = focusS && !focusS.endsAt ? "Resume" : "Pause";
  }
}
setInterval(() => { if (focusS && focusS.endsAt && focusLeft() <= 0) finishFocus(true); else if (focusS) paintFocus(); }, 1000);

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts, body: opts.body && JSON.stringify(opts.body) });
  if (res.status === 401) { location.href = "/login"; throw new Error("signed out"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail?.[0]?.msg || res.statusText);
  return data;
}

// ---------- toast & confirm
let toastTimer;
const island = $("#island");
function toast(msg, action) {
  const b = $("#isAct");
  $("#isMsg").textContent = msg;
  b.hidden = !action; if (action) { b.textContent = action.label; b.onclick = e => { e.stopPropagation(); endToast(); action.run(); }; }
  island.classList.remove("idle", "open"); island.classList.add("toasting");
  clearTimeout(toastTimer); toastTimer = setTimeout(endToast, action ? 7000 : 2600);
}
function endToast() { clearTimeout(toastTimer); island.classList.remove("toasting"); paintFocus(); }
function ask(title, text, { ok = "OK", danger = false } = {}) {
  const d = $("#confirmDlg");
  $("#confirmTitle").textContent = title; $("#confirmText").textContent = text;
  const yes = $("#confirmYes"); yes.textContent = ok; yes.className = "btn " + (danger ? "primary danger-fill" : "primary");
  yes.style.background = danger ? "var(--danger)" : ""; yes.style.borderColor = danger ? "var(--danger)" : "";
  d.showModal(); yes.focus();
  return new Promise(resolve => {
    const done = v => { d.close(); yes.onclick = $("#confirmNo").onclick = d.oncancel = null; resolve(v); };
    yes.onclick = () => done(true); $("#confirmNo").onclick = () => done(false); d.oncancel = e => { e.preventDefault(); done(false); };
  });
}

// ---------- dates & formatting
const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
function fmtDate(d, opts = { weekday: "short", day: "numeric", month: "short" }) {
  return d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, opts) : "";
}
const pad = n => String(n).padStart(2, "0");
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function relDays(d) { return Math.round((new Date(d.slice(0, 10) + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 864e5); }
function rel(d) {
  const n = relDays(d);
  if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday";
  return n < 0 ? `${-n}d overdue` : `in ${n}d`;
}
function ago(ts) {
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
const money = (n, cur) => n ? `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cur || state.meta.currency}` : "";
const hours = n => n ? `${+Number(n).toFixed(2)}h` : "";
const label = s => s.replace("_", " ");
const statusChip = s => `<span class="status s-${s}">${label(s)}</span>`;
const RANK = { backlog: 0, todo: 1, in_progress: 2, blocked: 2, parked: 3, submitted: 4, merged: 5, deployed: 6, done: 7, cancelled: 8 };
const MILESTONE_STATUS = { submit: "submitted", merge: "merged", deploy: "deployed", due: "done" };
function tags(it) {
  return (it.assignee === "me" ? `<span class="tag me">you</span>` : "")
    + (it.needs_redate ? `<span class="tag redate">re-date</span>` : "")
    + (["urgent", "high"].includes(it.priority) ? `<span class="tag ${it.priority}">${it.priority}</span>` : "");
}

// ---------- markdown (escape first, then a small safe subset)
const TASK_RE = /^(\s*[-*+]\s+)\[([ xX])\](\s+.*)?$/;
function checklist(src) {
  let total = 0, done = 0;
  String(src || "").split("\n").forEach(l => { const m = l.match(TASK_RE); if (m) { total++; if (m[2] !== " ") done++; } });
  return { total, done };
}
function progressHTML(src) {
  const { total, done } = checklist(src);
  if (!total) return "";
  return `<span class="progress" title="${done} of ${total} checklist items done"><span class="track"><span class="fill" style="width:${Math.round(done / total * 100)}%"></span></span>${done}/${total}</span>`;
}
function inline(s) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
       .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
       .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
       .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
       .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>")
       .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}
function md(src, { interactive = false } = {}) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const out = []; let list = null, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const open = t => { flush(); if (list !== t) { close(); out.push(`<${t}>`); list = t; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; let m;
    if (/^\s*```/.test(line)) {
      flush(); close(); const buf = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i]);
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    } else if ((m = line.match(/^(#{1,6})\s+(.*)/))) {
      flush(); close(); const h = Math.min(m[1].length + 2, 5); out.push(`<h${h}>${inline(m[2])}</h${h}>`);
    } else if ((m = line.match(TASK_RE))) {
      open("ul"); const on = m[2] !== " ";
      out.push(`<li class="task${on ? " checked" : ""}"><input type="checkbox" data-line="${i}" ${on ? "checked" : ""} ${interactive ? "" : "disabled"} aria-label="Toggle checklist item"><span>${inline((m[3] || "").trim())}</span></li>`);
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)/))) { open("ul"); out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { open("ol"); out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { flush(); close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); close(); out.push("<hr>"); }
    else if (!line.trim()) { flush(); close(); }
    else { close(); para.push(line); }
  }
  flush(); close();
  return out.join("");
}

// ---------- markdown editor
const I = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const TOOLS = [
  ["bold", "Bold (Ctrl+B)", I('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>')],
  ["italic", "Italic (Ctrl+I)", I('<path d="M14 5h-4M14 19h-4M14 5l-4 14"/>')],
  ["heading", "Heading", I('<path d="M6 5v14M18 5v14M6 12h12"/>')],
  ["list", "Bullet list", I('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>')],
  ["ol", "Numbered list", I('<path d="M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2M4 15h2l-2 3h2"/>')],
  ["task", "Checklist", I('<rect x="3" y="4" width="6" height="6" rx="1.5"/><path d="m4.5 7 1 1 2-2M13 7h8M3 15h6v6H3zM13 18h8"/>')],
  ["code", "Code (Ctrl+E)", I('<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>')],
  ["link", "Link (Ctrl+K)", I('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>')],
  ["quote", "Quote", I('<path d="M6 7h4v4H7a1 1 0 0 0-1 1v3M14 7h4v4h-3a1 1 0 0 0-1 1v3"/>')],
];
function mountEditors(root = document) {
  $$("[data-editor-slot]", root).forEach(slot => {
    const name = slot.dataset.editorSlot;
    slot.outerHTML = `<div class="editor" data-default-mode="${slot.dataset.mode || "auto"}">
      <div class="ed-bar">
        <div class="ed-tabs"><button type="button" data-tab="write" class="on">Write</button><button type="button" data-tab="preview">Preview</button></div>
        <div class="ed-tools">${TOOLS.map(([k, t, svg]) => `<button type="button" data-md="${k}" title="${t}" aria-label="${t}">${svg}</button>`).join("")}</div>
      </div>
      <textarea name="${name}" rows="${slot.dataset.rows || 5}" placeholder="${esc(slot.dataset.placeholder || "")}"></textarea>
      <div class="md md-preview" hidden></div>
      <div class="ed-foot"><span>Markdown: **bold**, - [ ] checklist, \`code\`</span><span></span></div>
    </div>`;
  });
}
function setMode(ed, mode) {
  const ta = $("textarea", ed), pv = $(".md-preview", ed);
  if (mode === "auto") mode = ed.dataset.defaultMode === "write" || !ta.value.trim() ? "write" : "preview";
  ed.classList.toggle("preview", mode === "preview");
  $$("[data-tab]", ed).forEach(b => b.classList.toggle("on", b.dataset.tab === mode));
  ta.hidden = mode === "preview"; pv.hidden = mode !== "preview";
  if (mode === "preview") pv.innerHTML = md(ta.value, { interactive: true }) || `<p class="placeholder">Nothing written yet. Click Write to add some.</p>`;
}
function setEditor(ta, value) { ta.value = value ?? ""; setMode(ta.closest(".editor"), "auto"); }
function replaceRange(ta, start, end, text) {
  ta.focus(); ta.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, text)) { ta.setRangeText(text, start, end, "end"); ta.dispatchEvent(new Event("input", { bubbles: true })); }
}
function applyMd(ta, kind) {
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e);
  const wrap = (l, r = l, ph = "text") => { const t = sel || ph; replaceRange(ta, s, e, l + t + r); ta.setSelectionRange(s + l.length, s + l.length + t.length); };
  const prefix = fn => {
    const ls = v.lastIndexOf("\n", s - 1) + 1, le = v.indexOf("\n", e), end = le < 0 ? v.length : le;
    replaceRange(ta, ls, end, v.slice(ls, end).split("\n").map(fn).join("\n"));
  };
  const toggle = p => l => l.startsWith(p) ? l.slice(p.length) : p + l.replace(/^(#+ |[-*] (\[[ xX]\] )?|\d+[.)] |> )/, "");
  switch (kind) {
    case "bold": return wrap("**");
    case "italic": return wrap("_");
    case "code": return sel.includes("\n") ? wrap("```\n", "\n```", "code") : wrap("`", "`", "code");
    case "heading": return prefix(toggle("## "));
    case "list": return prefix(toggle("- "));
    case "task": return prefix(toggle("- [ ] "));
    case "quote": return prefix(toggle("> "));
    case "ol": return prefix((l, i) => /^\d+[.)] /.test(l) ? l.replace(/^\d+[.)] /, "") : `${i + 1}. ${l}`);
    case "link": { const t = sel || "link text"; replaceRange(ta, s, e, `[${t}](https://)`); const p = s + t.length + 3; ta.setSelectionRange(p, p + 8); }
  }
}
document.addEventListener("click", e => {
  const tab = e.target.closest(".ed-tabs [data-tab]");
  if (tab) { const ed = tab.closest(".editor"); setMode(ed, tab.dataset.tab); if (tab.dataset.tab === "write") $("textarea", ed).focus(); return; }
  const tool = e.target.closest("[data-md]");
  if (tool) applyMd($("textarea", tool.closest(".editor")), tool.dataset.md);
});
document.addEventListener("dblclick", e => {
  const pv = e.target.closest(".md-preview");
  if (pv && !e.target.closest("a, input")) { const ed = pv.closest(".editor"); setMode(ed, "write"); $("textarea", ed).focus(); }
});
document.addEventListener("change", e => {
  const cb = e.target.closest(".md-preview input[type=checkbox][data-line]");
  if (!cb) return;
  const ed = cb.closest(".editor"), ta = $("textarea", ed), lines = ta.value.split("\n"), i = +cb.dataset.line;
  lines[i] = lines[i].replace(/\[([ xX])\]/, cb.checked ? "[x]" : "[ ]");
  ta.value = lines.join("\n"); ta.dispatchEvent(new Event("input", { bubbles: true })); setMode(ed, "preview");
});
document.addEventListener("keydown", e => {
  const ta = e.target.closest?.(".editor textarea"); if (!ta) return;
  const mod = e.ctrlKey || e.metaKey;
  const keys = { b: "bold", i: "italic", k: "link", e: "code" };
  if (mod && keys[e.key.toLowerCase()]) { e.preventDefault(); return applyMd(ta, keys[e.key.toLowerCase()]); }
  if (e.key === "Enter" && !e.shiftKey && !mod && ta.selectionStart === ta.selectionEnd) {
    const v = ta.value, s = ta.selectionStart, ls = v.lastIndexOf("\n", s - 1) + 1, line = v.slice(ls, s);
    const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) )/); if (!m) return;
    e.preventDefault();
    if (!line.slice(m[0].length).trim()) return replaceRange(ta, ls, s, "");
    const next = m[3] ? `${+m[3] + 1}${m[4]} ` : m[2].replace(/\[[xX]\]/, "[ ]");
    replaceRange(ta, s, s, "\n" + m[1] + next);
  }
  if (e.key === "Tab" && !mod) {
    const v = ta.value, s = ta.selectionStart, ls = v.lastIndexOf("\n", s - 1) + 1;
    if (/^\s*([-*+]|\d+[.)]) /.test(v.slice(ls))) { e.preventDefault(); e.shiftKey ? (v.startsWith("  ", ls) && replaceRange(ta, ls, ls + 2, "")) : replaceRange(ta, ls, ls, "  "); }
  }
});
document.addEventListener("input", e => {
  const ta = e.target.closest?.(".editor textarea"); if (!ta) return;
  const foot = $(".ed-foot span:last-child", ta.closest(".editor")); const { total, done } = checklist(ta.value);
  foot.textContent = total ? `${done}/${total} checked` : "";
});

// ---------- shared data & small charts
const pq = (sep = "&") => projectFilter.value ? `${sep}project=${encodeURIComponent(projectFilter.value)}` : "";
const allItems = () => api(`/api/items?include_closed=true&limit=5000${pq()}`);
const doneDay = it => it.status === "done" && it.completed_at ? it.completed_at.slice(0, 10) : null;
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 864e5;
const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const delta = (d, unit = "%", invert = false) => d === null || isNaN(d) ? "" : `<span class="d ${(d >= 0) !== invert ? "up" : "down"}">${d >= 0 ? "+" : ""}${d}${unit}</span>`;
const tile = (l, n, extra = "", cls = "") => `<div class="glass tile ${cls}"><span class="l">${l}</span><span class="n">${n}${extra}</span></div>`;
function pageH(title, sub, acts = "") {
  return `<div class="page-h"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${acts ? `<div class="acts">${acts}</div>` : ""}</div>`;
}
// Bars with a hover tooltip per bar. data: [{label, value, tip, dim}]
// Charts are drawn at their real pixel width (1 SVG unit = 1px) so text never scales.
function chartW(frac) {
  const v = $("#view").clientWidth || 1000, f = innerWidth < 1100 ? 1 : frac;
  return Math.max(260, Math.round((v + 18) * f - 18 - 36));
}
function barChart(data, { h = 150, cls = "", unit = "", frac = 1 } = {}) {
  const W = chartW(frac), pad = { l: 28, b: 22, t: 8 }, max = Math.max(1, ...data.map(d => d.value));
  const step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step || 1;
  const bw = (W - pad.l) / data.length, gap = Math.min(10, bw * .28), ih = h - pad.b - pad.t;
  const ticks = [0, top / 2, top].map(v => `<line x1="${pad.l}" x2="${W}" y1="${pad.t + ih - v / top * ih}" y2="${pad.t + ih - v / top * ih}"/><text class="axis" x="${pad.l - 6}" y="${pad.t + ih - v / top * ih + 4}" text-anchor="end">${+v.toFixed(1)}</text>`).join("");
  const every = Math.ceil(data.length / Math.max(2, Math.floor(W / 70)));
  const bars = data.map((d, i) => {
    const x = pad.l + i * bw + gap / 2, w = bw - gap, bh = Math.max(d.value ? 3 : 0, d.value / top * ih), y = pad.t + ih - bh, r = Math.min(4, w / 2, bh);
    const path = bh ? `M${x},${pad.t + ih} V${y + r} q0,-${r} ${r},-${r} H${x + w - r} q${r},0 ${r},${r} V${pad.t + ih} Z` : "";
    return `<g><path class="bar ${cls}${d.dim ? " dim" : ""}" d="${path}"/>${i % every === 0 ? `<text class="axis" x="${x + w / 2}" y="${h - 6}" text-anchor="middle">${esc(d.label)}</text>` : ""}
      <rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}" data-tip="${esc(d.tip ?? `${d.label}: ${d.value}${unit}`)}"/></g>`;
  }).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${h}" role="img"><g class="grid">${ticks}</g>${bars}</svg></div>`;
}
// Two-period line chart with crosshair tooltip. cur/prev: arrays of numbers, labels: date labels for cur
function lineChart(cur, prev, labels, { h = 220, frac = 1 } = {}) {
  const W = chartW(frac), pad = { l: 28, b: 22, t: 10 }, ih = h - pad.b - pad.t, n = cur.length;
  const max = Math.max(1, ...cur, ...prev), step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
  const X = i => pad.l + (n > 1 ? i / (n - 1) : .5) * (W - pad.l - 6), Y = v => pad.t + ih - v / top * ih;
  const path = arr => arr.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const ticks = [0, top / 2, top].map(v => `<line x1="${pad.l}" x2="${W}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`).join("");
  const every = Math.ceil(n / Math.max(2, Math.floor(W / 90)));
  const xl = labels.map((l, i) => i % every === 0 ? `<text class="axis" x="${X(i)}" y="${h - 6}" text-anchor="middle">${esc(l)}</text>` : "").join("");
  const hits = cur.map((v, i) => `<rect class="hit" x="${X(i) - (W - pad.l) / n / 2}" y="${pad.t}" width="${(W - pad.l) / n}" height="${ih}" data-x="${X(i)}" data-y="${Y(v)}" data-tip="${esc(labels[i])} · <b>${v}</b> finished · previous <b>${prev[i] ?? 0}</b>"/>`).join("");
  return `<div class="chart line-chart"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Tasks finished per day">
    <g class="grid">${ticks}</g>${xl}
    <path class="area" d="${path(cur)} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)} Z"/>
    <path class="line prev" d="${path(prev)}"/><path class="line" d="${path(cur)}"/>
    <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" hidden/><circle class="dot" r="5" hidden/>${hits}</svg></div>`;
}
function donut(parts, total, label) {
  const R = 80, r = 54, C = 85; let a = -Math.PI / 2;
  const arcs = parts.map(p => {
    const sweep = total ? p.value / total * Math.PI * 2 : 0, a2 = a + sweep, large = sweep > Math.PI ? 1 : 0;
    const pt = (rad, ang) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;
    const d = sweep >= Math.PI * 2 - 1e-6
      ? `M${pt(R, a)} A${R},${R} 0 1 1 ${pt(R, a + Math.PI)} A${R},${R} 0 1 1 ${pt(R, a)} M${pt(r, a)} A${r},${r} 0 1 0 ${pt(r, a + Math.PI)} A${r},${r} 0 1 0 ${pt(r, a)} Z`
      : `M${pt(R, a)} A${R},${R} 0 ${large} 1 ${pt(R, a2)} L${pt(r, a2)} A${r},${r} 0 ${large} 0 ${pt(r, a)} Z`;
    a = a2; return sweep ? `<path d="${d}" fill="${p.color}" data-slice="${esc(p.key)}" data-tip="${esc(p.key)} · <b>${p.value}</b> (${Math.round(p.value / total * 100)}%)"/>` : "";
  }).join("");
  return `<svg viewBox="0 0 170 170" role="img" aria-label="${esc(label)}">${arcs}
    <text x="85" y="84" text-anchor="middle" style="font-size:28px;font-weight:800;fill:var(--text)">${total}</text>
    <text x="85" y="104" text-anchor="middle" style="font-size:12px;font-weight:600;fill:var(--muted)">${esc(label)}</text></svg>`;
}
function ringsSVG(rings) {
  const sz = 168, c = sz / 2, sw = 13;
  return `<svg viewBox="0 0 ${sz} ${sz}" role="img" aria-label="Today's progress">${rings.map((g, i) => {
    const r = c - sw / 2 - 2 - i * (sw + 4), L = 2 * Math.PI * r, f = Math.min(1, g.value / (g.max || 1));
    return `<circle cx="${c}" cy="${c}" r="${r}" stroke="${g.color}" stroke-width="${sw}" opacity=".18"/>
      <circle cx="${c}" cy="${c}" r="${r}" stroke="${g.color}" stroke-width="${sw}" stroke-dasharray="${L}" stroke-dashoffset="${L * (1 - f)}" transform="rotate(-90 ${c} ${c})"><title>${esc(g.label)}: ${g.value}/${g.max}</title></circle>`;
  }).join("")}</svg>`;
}
const LANES = [
  ["todo", "To do", ["backlog", "todo"], "--c-todo"], ["in_progress", "In progress", ["in_progress"], "--c-in_progress"],
  ["blocked", "Blocked", ["blocked"], "--c-blocked"], ["parked", "Parked", ["parked"], "--c-parked"],
  ["submitted", "In review", ["submitted"], "--c-submitted"], ["merged", "Shipped", ["merged", "deployed"], "--c-merged"],
  ["done", "Done", ["done"], "--c-done"],
];
const CAL_I = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const PLUS_I = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

// ---------- views
const views = {
  async home() {
    const [a, items] = await Promise.all([api(`/api/agenda?days=14${pq()}`), allItems()]);
    const today = a.today, now = new Date(), hr = now.getHours();
    const greet = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
    const doneToday = items.filter(i => doneDay(i) === today);
    // milestones dated today, reached or not
    const MS = [["submit", "submit_on"], ["merge", "merge_on"], ["deploy", "deploy_on"], ["due", "due_on"]];
    let msTotal = 0, msDone = 0;
    items.forEach(i => { if (i.status === "cancelled") return; MS.forEach(([t, f]) => { if (i[f] === today) { msTotal++; if (RANK[i.status] >= RANK[MILESTONE_STATUS[t]]) msDone++; } }); });
    const mineDone = doneToday.filter(i => i.assignee === "me").length;
    const mineDue = a.waiting_on_me.filter(i => i.due_on && i.due_on <= today).length;
    const focusMin = focusLog[today] || 0;
    const nextEv = a.overdue[0] || a.upcoming[0];
    const summary = `${fmtDate(today, { weekday: "long", day: "numeric", month: "long" })} · ${msTotal - msDone} milestone${msTotal - msDone === 1 ? "" : "s"} and ${mineDue} to-do${mineDue === 1 ? "" : "s"} left today`;
    const acts = `<button class="btn" data-new>${PLUS_I} New item</button>`
      + (nextEv ? `<button class="btn primary" data-item="${nextEv.item.id}">${CAL_I} Next: ${esc(nextEv.type)} ${rel(nextEv.date)}</button>` : "");
    // up next
    const evs = [...a.overdue, ...a.upcoming], first = evs[0];
    const upNext = first ? `<div class="next-card" data-item="${first.item.id}">
        <small class="${first.date < today ? "late" : ""}">${first.date < today ? rel(first.date) : rel(first.date).replace(/^./, c => c.toUpperCase())} · ${esc(first.type)}</small>
        <h4>${esc(first.item.title)}</h4>
        <div class="meta">${pchip(first.item.project, true)}${first.item.branch ? `<span class="mono">${esc(first.item.branch)}</span>` : ""}${statusChip(first.item.status)}<span class="btn sm primary">Open</span></div></div>
      ${evs.slice(1, 6).map(e => `<div class="upn" data-item="${e.item.id}" style="--c:var(--c-${e.type})"><b>${esc(e.item.title)}</b><span>${esc(e.type)} · ${e.date < today ? `<span class="late">${rel(e.date)}</span>` : fmtDate(e.date, { weekday: "short", day: "numeric" })}</span></div>`).join("")}`
      : `<div class="empty">Nothing scheduled in the next 14 days.</div>`;
    // my tasks
    const mine = [...a.waiting_on_me].sort((x, y) => (x.due_on || "9999") < (y.due_on || "9999") ? -1 : (x.due_on || "9999") > (y.due_on || "9999") ? 1 : PRIO(x) - PRIO(y));
    const showN = state.expanded.homeMine ? mine.length : 7;
    const myTasks = mine.slice(0, showN).map(it => `<div class="task" data-item="${it.id}">
        <input type="checkbox" class="round" data-done="${it.id}" title="Mark done" aria-label="Mark ${esc(it.title)} done">
        <span class="t"><span class="title">${esc(it.title)}</span>
          <span class="sub">${pchip(it.project)}${it.due_on ? `<span class="${it.due_on < today ? "late" : ""}">${it.due_on === today ? "Today" : rel(it.due_on)}</span>` : ""}${holdTag(it)}${repeatTag(it)}${depTag(it)}</span></span>
        ${flag(it.priority)}${holdBtn(it)}</div>`).join("") || `<div class="empty">Nothing waiting on you.</div>`;
    noteWaiting(a.on_hold);
    // focus card
    const focusable = items.filter(i => !["done", "cancelled"].includes(i.status) && (i.status === "in_progress" || i.assignee === "me")).slice(0, 60);
    // this week
    const mon = addDays(parseISO(today), -((parseISO(today).getDay() + 6) % 7));
    const wk = Array.from({ length: 7 }, (_, i) => toISO(addDays(mon, i)));
    const lastWk = wk.map(d => toISO(addDays(parseISO(d), -7)));
    const cnt = d => items.filter(i => doneDay(i) === d).length;
    const wkVals = wk.map(cnt), soFar = wkVals.filter((_, i) => wk[i] <= today).reduce((s, v) => s + v, 0);
    const lastSoFar = lastWk.filter((_, i) => wk[i] <= today).map(cnt).reduce((s, v) => s + v, 0);
    const wd = pct(soFar, lastSoFar);
    const weekBars = barChart(wk.map((d, i) => ({ label: fmtDate(d, { weekday: "short" }), value: wkVals[i], dim: d > today,
      tip: `${fmtDate(d, { weekday: "long", day: "numeric", month: "short" })} · ${wkVals[i]} finished · last week ${cnt(lastWk[i])}` })), { h: 130 });
    return pageH(`${greet}`, summary, acts) + `
      <div class="tiles">
        ${tile("Done today", doneToday.length)}${tile("Focus today", (focusMin / 60).toFixed(1), "<small>h</small>")}
        ${tile("Overdue", a.overdue.length, "", a.overdue.length ? "alert" : "")}${tile("Waiting on you", a.waiting_on_me.length)}${tile("On hold", a.on_hold.length)}${tile("Parked", a.parked.length)}
      </div>
      <div class="home">
        <section class="panel span-5"><div class="panel-h"><div><h3>Today</h3><span class="sub">Close your rings</span></div></div>
          <div class="rings">${ringsSVG([
            { label: "Milestones", value: msDone, max: msTotal, color: "var(--ring-1)" },
            { label: "Focus", value: focusMin, max: look.goalMin, color: "var(--ring-2)" },
            { label: "Your to-dos", value: mineDone, max: mineDone + mineDue, color: "var(--ring-3)" }])}
            <div class="legend">
              <div style="--c:var(--ring-1)"><small>Milestones</small><b>${msDone}<span> / ${msTotal}</span></b></div>
              <div style="--c:var(--ring-2)"><small>Focus</small><b>${(focusMin / 60).toFixed(1)}h<span> / ${+(look.goalMin / 60).toFixed(1)}h</span></b></div>
              <div style="--c:var(--ring-3)"><small>Your to-dos</small><b>${mineDone}<span> / ${mineDone + mineDue}</span></b></div>
            </div></div></section>
        <section class="panel span-7"><div class="panel-h"><div><h3>Up next</h3><span class="sub">Milestones, soonest first</span></div><span class="spacer"></span><button class="link" data-goto="calendar">Calendar</button></div>${upNext}<div style="height:10px"></div></section>
        <section class="panel span-5"><div class="panel-h"><div><h3>Focus</h3><span class="sub">The island keeps the time</span></div></div>
          <div class="focus-card">
            <div class="dial" id="dial"><svg viewBox="0 0 132 132"><circle class="bg" cx="66" cy="66" r="58"/><circle class="fg" cx="66" cy="66" r="58" stroke-dasharray="364.4" stroke-dashoffset="0"/></svg>
              <div class="t"><b>${mmss(look.focusMin * 60)}</b><small>Ready</small></div></div>
            <div class="focus-ctl">
              <div data-fstate="idle"><div class="pills" role="group" aria-label="Session length">${[15, 25, 50].map(m => `<button type="button" data-fmin="${m}" class="${m === (state.fmin || look.focusMin) ? "on" : ""}">${m} min</button>`).join("")}</div></div>
              <select id="focusItem" data-fstate="idle" aria-label="What are you working on?"><option value="">No item, just focus</option>${focusable.map(i => `<option value="${i.id}">#${i.id} ${esc(i.title.slice(0, 70))}</option>`).join("")}</select>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn primary" data-fstate="idle" data-fstart>Start focus</button>
                <button class="btn" data-fstate="run" data-focus="pause" hidden><span>Pause</span></button>
                <button class="btn" data-fstate="run" data-focus="end" hidden>End</button>
              </div>
            </div></div></section>
        <section class="panel span-7"><div class="panel-h"><div><h3>My tasks</h3><span class="sub">Waiting on you, due first${a.on_hold.length ? ` · ${a.on_hold.length} on hold` : ""}</span></div><span class="spacer"></span>${a.on_hold.length ? `<button class="link" data-goto="agenda">On hold</button>` : ""}<button class="link" data-goto="tasks" data-mine>All tasks</button></div>
          ${myTasks}${mine.length > 7 ? `<button class="more" data-expand="homeMine">${state.expanded.homeMine ? "Show less" : `Show all ${mine.length}`}</button>` : ""}</section>
        <section class="panel span-12"><div class="panel-h"><div><h3>This week</h3><span class="sub">Items finished each day</span></div><span class="spacer"></span><button class="link" data-goto="insights">Insights</button></div>
          <div class="hero"><b>${soFar}</b><span>finished so far</span>${wd === null ? "" : `<span class="${wd >= 0 ? "up" : "down"}">${wd >= 0 ? "+" : ""}${wd}% vs last week</span>`}</div>
          ${weekBars}</section>
      </div>`;
  },

  async tasks() {
    const t = state.tasks;
    const toggle = `<div class="pills" role="group" aria-label="Layout">
        <button type="button" data-tmode="board" class="${t.mode === "board" ? "on" : ""}">Board</button>
        <button type="button" data-tmode="list" class="${t.mode === "list" ? "on" : ""}">List</button></div>
      <button class="btn primary" data-new>${PLUS_I} New task</button>`;
    if (t.mode === "list") return pageH("Tasks", "Every open item, sorted by the next milestone", toggle) + await views.items();
    const f = state.filters, q = new URLSearchParams({ include_closed: true, limit: 5000 });
    if (projectFilter.value) q.set("project", projectFilter.value); if (f.search) q.set("search", f.search);
    const today = todayISO(), wkEnd = toISO(addDays(parseISO(today), 7));
    const mon = toISO(addDays(parseISO(today), -((parseISO(today).getDay() + 6) % 7))), cut = toISO(addDays(parseISO(today), -14));
    let items = await api("/api/items?" + q);
    noteWaiting(items);
    if (t.mine) items = items.filter(i => i.assignee === "me");
    if (t.priority) items = items.filter(i => i.priority === t.priority);
    const open = items.filter(i => !["done", "cancelled"].includes(i.status));
    const dueWk = open.filter(i => i.next_milestone && i.next_milestone.date <= wkEnd).length;
    const doneWk = items.filter(i => (doneDay(i) || "") >= mon).length;
    const card = it => {
      const { total, done } = checklist(it.description), nm = it.next_milestone, closed = it.status === "done";
      const d = closed ? (it.completed_at ? `Done ${fmtDate(it.completed_at, { day: "numeric", month: "short" })}` : "Done") : nm ? `${nm.type} ${nm.date === today ? "today" : fmtDate(nm.date, { day: "numeric", month: "short" })}` : "";
      const gb = gitBadges(it), hold = holdTag(it) + repeatTag(it) + depTag(it);
      return `<div class="kcard${closed ? " closed" : ""}${it.on_hold ? " held" : ""}" draggable="true" data-item="${it.id}" data-status="${it.status}">
        <div class="top">${pchip(it.project, true)}${flag(it.priority)}</div>
        <div class="title">${esc(it.title)}</div>
        ${total ? `<div class="bar2"><span class="meter"><i style="width:${Math.round(done / total * 100)}%;background:${pcolor(it.project)}"></i></span>${done}/${total}</div>` : ""}
        ${gb || hold ? `<div class="gits">${hold}${gb}</div>` : ""}
        <div class="foot">${d ? `<span class="d ${!closed && it.overdue ? "late" : ""}">${CAL_I}${esc(d)}</span>` : ""}${it.ticket_ref ? `<span>${esc(it.ticket_ref)}</span>` : `<span class="proj">#${it.id}</span>`}${it.needs_redate && !it.git?.early_commits ? `<span class="tag redate">re-date</span>` : ""}
          <span class="who ${it.assignee}" title="${it.assignee === "me" ? "You" : "Agent"}">${it.assignee === "me" ? "ME" : "AI"}</span></div></div>`;
    };
    const lanes = LANES.map(([key, name, sts, c]) => {
      let list = items.filter(i => sts.includes(i.status));
      if (key === "done") list = list.filter(i => (doneDay(i) || "") >= cut).sort((x, y) => (y.completed_at || "").localeCompare(x.completed_at || ""));
      const lim = state.expanded["lane-" + key] ? list.length : 25;
      return `<section class="lane glass" data-lane="${key}" aria-label="${name}">
        <div class="lane-h" style="--c:var(${c})">${name}<span class="count">${list.length}</span>${key !== "done" ? `<button type="button" data-lane-new="${sts.at(-1)}" aria-label="New item in ${name}">${PLUS_I}</button>` : ""}</div>
        ${list.slice(0, lim).map(card).join("") || `<div class="empty" style="padding:14px">Drop items here</div>`}
        ${list.length > lim ? `<button class="more-lane" data-expand="lane-${key}">Show ${list.length - lim} more</button>` : ""}</section>`;
    }).join("");
    return pageH("Tasks", `${open.length} open across ${new Set(open.map(i => i.project)).size} project${new Set(open.map(i => i.project)).size === 1 ? "" : "s"} · drag a card to change its status`, toggle) + `
      <div class="tiles">${tile("Open", open.length)}${tile("Due this week", dueWk)}${tile("Overdue", open.filter(i => i.overdue).length, "", open.some(i => i.overdue) ? "alert" : "")}${tile("Done this week", doneWk)}</div>
      <div class="filterbar glass">
        <button type="button" class="tg ${t.mine ? "on" : ""}" data-tmine aria-pressed="${t.mine}">Mine only</button>
        <select data-tprio aria-label="Priority"><option value="">Any priority</option>${state.meta.priorities.map(p => `<option value="${p}" ${t.priority === p ? "selected" : ""}>${label(p)}</option>`).join("")}</select>
        <span class="sep"></span>
        <input id="fSearch" type="search" placeholder="Filter by title, branch or ticket  ( / )" value="${esc(f.search)}" aria-label="Filter tasks">
      </div>
      <div class="board">${lanes}</div>`;
  },

  async insights() {
    const R = state.ins.range, today = todayISO();
    const start = toISO(addDays(parseISO(today), -(R - 1))), pstart = toISO(addDays(parseISO(start), -R));
    const [items, tr] = await Promise.all([allItems(), api(`/api/time?start=${start}&end=${today}`)]);
    const pf = projectFilter.value, trRows = tr.projects.filter(r => !pf || r.project === pf);
    const acc = r => r.paired ? Math.round(r.paired_actual / r.paired_estimate * 100) : null;
    const timeTable = trRows.length ? `<div class="tablewrap"><table>
        <thead><tr><th>Project</th><th class="num">Focus</th><th class="num">Sessions</th><th class="num">Finished</th><th class="num">Estimate</th><th class="num">Actual</th><th class="num" title="For finished items that have both an estimate and actual hours: actual as a share of the estimate">Actual vs estimate</th><th class="num">Cost</th></tr></thead>
        <tbody>${trRows.map(r => `<tr ${r.project !== "(no item)" ? `data-filter-project="${esc(r.project)}"` : ""}>
          <td>${r.project === "(no item)" ? `<span class="muted">Focus with no item</span>` : pchip(r.project)}</td>
          <td class="num">${r.focus_minutes ? (r.focus_minutes / 60).toFixed(1) + "h" : "–"}</td><td class="num">${r.sessions || "–"}</td>
          <td class="num">${r.finished || "–"}</td><td class="num">${hours(r.estimate_hours) || "–"}</td><td class="num">${hours(r.actual_hours) || "–"}</td>
          <td class="num" title="${r.paired ? `${r.paired} item${r.paired === 1 ? "" : "s"} with both numbers` : "No finished item has both an estimate and actual hours"}">${acc(r) === null ? "–" : `<span class="${acc(r) > 120 ? "late" : ""}">${acc(r)}%</span> <span class="muted" style="font-size:12px">of ${r.paired}</span>`}</td>
          <td class="num">${Object.entries(r.cost).map(([k, v]) => money(v, k)).join(" · ") || "–"}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">No focus sessions or finished items in this range.</div>`;
    const inP = (d, a, b) => d && d >= a && d <= b, pend = toISO(addDays(parseISO(start), -1));
    const cur = items.filter(i => inP(doneDay(i), start, today)), prev = items.filter(i => inP(doneDay(i), pstart, pend));
    const onTime = arr => { const w = arr.filter(i => i.due_on); return { n: w.length, ok: w.filter(i => doneDay(i) <= i.due_on).length }; };
    const ot = onTime(cur), otp = onTime(prev);
    const rate = ot.n ? Math.round(ot.ok / ot.n * 100) : null, ratep = otp.n ? Math.round(otp.ok / otp.n * 100) : null;
    const cyc = arr => arr.length ? arr.reduce((s, i) => s + daysBetween(i.created_at, i.completed_at), 0) / arr.length : null;
    const cy = cyc(cur), cyp = cyc(prev);
    const days = Array.from({ length: R }, (_, i) => toISO(addDays(parseISO(start), i)));
    const pdays = days.map(d => toISO(addDays(parseISO(d), -R)));
    const per = (arr, ds) => ds.map(d => arr.filter(i => doneDay(i) === d).length);
    const fmin = ds => ds.reduce((s, d) => s + (focusLog[d] || 0), 0);
    const fh = fmin(days) / 60, fhp = fmin(pdays) / 60;
    // by project, colour fixed per project
    const byP = {}; cur.forEach(i => byP[i.project] = (byP[i.project] || 0) + 1);
    const parts = Object.entries(byP).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ key: k, value: v, color: pcolor(k) }));
    const open = items.filter(i => !["done", "cancelled"].includes(i.status));
    const slow = [...open].sort((x, y) => x.created_at.localeCompare(y.created_at)).slice(0, 5);
    const work = {}; open.forEach(i => { const w = work[i.project] ||= { h: 0, n: 0, me: 0 }; w.h += i.estimate_hours || 0; w.n++; if (i.assignee === "me") w.me++; });
    const wl = Object.entries(work).sort((x, y) => y[1].h - x[1].h || y[1].n - x[1].n), wmax = Math.max(1, ...wl.map(([, w]) => w.h));
    const lbl = d => fmtDate(d, { day: "numeric", month: "short" });
    const range = `<div class="pills" role="group" aria-label="Range">${[7, 30, 90].map(r => `<button type="button" data-range="${r}" class="${r === R ? "on" : ""}">${r}D</button>`).join("")}</div>
      <button class="btn" data-csv>Export CSV</button>`;
    state.csv = cur;
    const focusDays = R > 30 ? days.slice(-30) : days;
    return pageH("Insights", `How the work went over the last ${R} days`, range) + `
      <div class="tiles">
        ${tile("Completed", cur.length, delta(pct(cur.length, prev.length)))}
        ${tile("On-time rate", rate === null ? "–" : rate + "<small>%</small>", rate !== null && ratep !== null ? delta(rate - ratep, " pts") : "")}
        ${tile("Focus hours", fh.toFixed(1) + "<small>h</small>", delta(pct(fh, fhp)))}
        ${tile("Avg cycle time", cy === null ? "–" : cy.toFixed(1) + "<small>d</small>", cy !== null && cyp !== null ? delta(+(cy - cyp).toFixed(1), "d", true) : "")}
      </div>
      <div class="ins">
        <section class="panel span-12"><div class="panel-h"><div><h3>Throughput</h3><span class="sub">Items finished each day</span></div><span class="spacer"></span>
            <span class="legend-row"><span><i></i>Last ${R} days</span><span><i class="prev"></i>Previous ${R} days</span></span></div>
          <div class="hero"><b>${cur.length}</b><span>finished</span>${pct(cur.length, prev.length) === null ? "" : `<span class="${cur.length >= prev.length ? "up" : "down"}">${pct(cur.length, prev.length) >= 0 ? "+" : ""}${pct(cur.length, prev.length)}% vs previous ${R} days</span>`}</div>
          ${lineChart(per(cur, days), per(prev, pdays), days.map(lbl))}</section>
        <section class="panel span-6"><div class="panel-h"><div><h3>By project</h3><span class="sub">Where the finished work went</span></div></div>
          ${parts.length ? `<div class="donut-wrap">${donut(parts, cur.length, "finished")}
            <div class="plist">${parts.map(p => `<div data-slice-row="${esc(p.key)}" data-filter-project="${esc(p.key)}">${pchip(p.key)}<b>${p.value}</b><span>${Math.round(p.value / cur.length * 100)}%</span></div>`).join("")}</div></div>`
            : `<div class="empty">Nothing finished in this range.</div>`}</section>
        <section class="panel span-6"><div class="panel-h"><div><h3>On time</h3><span class="sub">Finished items that had a due date</span></div></div>
          <div class="hero"><b>${rate === null ? "–" : rate + "%"}</b><span>finished on or before the due day</span></div>
          <div style="padding:4px 18px 8px"><div class="meter">${ot.n ? `<i style="width:${ot.ok / ot.n * 100}%;background:var(--ok)"></i><i style="flex:1;background:var(--danger)"></i>` : ""}</div>
            <div class="legend-row" style="margin-top:8px"><span>✓ <b style="color:var(--text)">${ot.ok}</b> on time</span><span>! <b style="color:var(--text)">${ot.n - ot.ok}</b> late</span><span>${cur.length - ot.n} had no due date</span></div></div>
          <div class="panel-h" style="padding-top:8px"><h3 style="font-size:14px">Oldest open items</h3></div>
          ${slow.map(i => `<div class="upn" data-item="${i.id}" style="--c:var(--c-${i.status})"><b>${esc(i.title)}</b><span>${pchip(i.project)} · ${Math.floor(daysBetween(i.created_at, new Date()))}d old</span></div>`).join("") || `<div class="empty">No open items.</div>`}
          <div style="height:10px"></div></section>
        <section class="panel span-7"><div class="panel-h"><div><h3>Focus</h3><span class="sub">Minutes focused each day, from the focus timer</span></div></div>
          <div class="hero"><b>${fh.toFixed(1)}h</b><span>about ${(fh / R).toFixed(1)}h a day</span></div>
          ${barChart(focusDays.map(d => ({ label: lbl(d), value: focusLog[d] || 0, tip: `${fmtDate(d, { weekday: "short", day: "numeric", month: "short" })} · ${focusLog[d] || 0} min` })), { cls: "focus", h: 150, frac: 7 / 12 })}</section>
        <section class="panel span-12"><div class="panel-h"><div><h3>Time by project</h3><span class="sub">Focus-timer hours in the range, and estimate vs actual for items finished in it</span></div><span class="spacer"></span>
            <a class="btn sm" href="/api/time.csv?start=${start}&end=${today}" download>Download CSV</a></div>${timeTable}</section>
        <section class="panel span-5"><div class="panel-h"><div><h3>Workload</h3><span class="sub">Open estimate hours per project</span></div></div>
          <div class="hbars">${wl.map(([p, w]) => `<div class="hbar" data-filter-project="${esc(p)}" title="${w.n} open, ${w.me} on you">${pchip(p)}<span class="track"><i style="width:${w.h / wmax * 100}%;--pc:${pcolor(p)}"></i></span><span>${w.h ? +w.h.toFixed(1) + "h" : "–"} · ${w.n}</span></div>`).join("") || `<div class="empty">No open items.</div>`}</div></section>
      </div>`;
  },

  async settings() {
    const [bk, gc] = await Promise.all([api("/api/backups").catch(e => ({ error: e.message, backups: [] })), api("/api/git").catch(() => null)]);
    const radio = (name, val, cur, text) => `<label><input type="radio" name="${name}" value="${val}" ${val === cur ? "checked" : ""}><span>${text}</span></label>`;
    const ico = (c, p) => `<span class="ico" style="--c:${c}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg></span>`;
    const IC = { look: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.6-.8 1.6-1.7 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.6 1.7-1.6H16a6 6 0 0 0 6-6c0-4.9-4.5-8.3-10-8.3z"/>',
      focus: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>', data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>', keys: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 15h10"/>',
      git: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 5-8 3-12 7"/>',
      tpl: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>' };
    await loadTemplates();
    const tpls = state.templates;
    const kb = n => n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB";
    const last = bk.backups.find(b => b.reason !== "pre-restore");
    const okLine = (ok, yes, no) => `<span class="${ok ? "okdot" : "nodot"}"></span>${ok ? yes : no}`;
    const lr = gc?.last_run;
    const stepper = (k, unit, step, min, max) => `<span class="stepper"><button type="button" data-step="${k}" data-d="-${step}" data-min="${min}" aria-label="Less">−</button><b>${look[k]} ${unit}</b><button type="button" data-step="${k}" data-d="${step}" data-max="${max}" aria-label="More">+</button></span>`;
    const days = Object.keys(focusLog).length;
    return pageH("Settings", "How DevTrack looks and behaves in this browser") + `
      <div class="settings">
        <nav class="panel set-nav" aria-label="Settings sections">
          <button data-sect="appearance">${ico("#a259ff", IC.look)}Appearance</button>
          <button data-sect="focus">${ico("#f08c2e", IC.focus)}Focus</button>
          <button data-sect="backups">${ico("#e5484d", IC.data)}Backups</button>
          <button data-sect="git">${ico("#6b5ae0", IC.git)}Git sync</button>
          <button data-sect="data">${ico("#22b37a", IC.data)}Data</button>
          <button data-sect="templates">${ico("#0fa5a5", IC.tpl)}Templates</button>
          <button data-sect="keys">${ico("#4c7dff", IC.keys)}Shortcuts</button>
        </nav>
        <div class="stack">
          <section class="panel" id="sect-appearance"><div class="panel-h"><div><h3>Appearance</h3><span class="sub">The whole app re-tints through its glass</span></div></div>
            <div class="set-row"><span class="t"><b>Theme</b><small>Auto follows your system</small></span>
              <span class="seg" role="radiogroup" aria-label="Theme">${radio("theme", "light", look.theme, "Light")}${radio("theme", "dark", look.theme, "Dark")}${radio("theme", "auto", look.theme, "Auto")}</span></div>
            <div class="set-row"><span class="t"><b>Wallpaper</b><small>${label(look.wall).replace(/^./, c => c.toUpperCase())}</small></span></div>
            <div class="walls" role="radiogroup" aria-label="Wallpaper">${WALLS.map(w => `<label data-wall="${w}"><input type="radio" name="wall" value="${w}" ${w === look.wall ? "checked" : ""}><span class="sw" data-wallsw="${w}"></span><span>${w[0].toUpperCase() + w.slice(1)}</span></label>`).join("")}</div>
            <div class="set-row"><span class="t"><b>Accent</b><small>${look.accent[0].toUpperCase() + look.accent.slice(1)}</small></span>
              <span class="swatches" role="radiogroup" aria-label="Accent colour">${Object.entries(ACCENTS).map(([k, c]) => `<label title="${k}"><input type="radio" name="accent" value="${k}" ${k === look.accent ? "checked" : ""} aria-label="${k}"><span style="--sc:${c}"></span></label>`).join("")}</span></div>
            <div class="set-row"><span class="t"><b>Glass</b><small>Clear shows more of the wallpaper</small></span>
              <span class="seg" role="radiogroup" aria-label="Glass">${radio("glass", "clear", look.glass, "Clear")}${radio("glass", "tinted", look.glass, "Tinted")}</span></div>
            <div class="set-row"><span class="t"><b>Reduce transparency</b><small>Solid surfaces, no frost</small></span>
              <input type="checkbox" class="switch" data-look="solid" ${look.solid ? "checked" : ""} aria-label="Reduce transparency"></div>
          </section>
          <section class="panel" id="sect-focus"><div class="panel-h"><div><h3>Focus</h3><span class="sub">The timer the island keeps</span></div></div>
            <div class="set-row"><span class="t"><b>Session</b><small>Default length of a focus block</small></span>${stepper("focusMin", "min", 5, 5, 120)}</div>
            <div class="set-row"><span class="t"><b>Break</b><small>Starts on its own when a block ends</small></span>${stepper("breakMin", "min", 1, 1, 30)}</div>
            <div class="set-row"><span class="t"><b>Daily goal</b><small>Fills the green ring on Home</small></span>${stepper("goalMin", "min", 15, 15, 600)}</div>
            <div class="set-row"><span class="t"><b>Chime</b><small>A short sound when a block or break ends</small></span>
              <input type="checkbox" class="switch" data-look="sound" ${look.sound ? "checked" : ""} aria-label="Chime"></div>
            <div class="set-row"><span class="t"><b>${focusS ? `In focus · ${mmss(focusLeft())} left` : "Start a session now"}</b><small>${focusS ? esc(focusS.title) : `${look.focusMin} minutes, no item`}</small></span>
              ${focusS ? `<button class="btn" data-focus="end">End session</button>` : `<button class="btn primary" data-fstart>Start</button>`}</div>
          </section>
          <section class="panel" id="sect-backups"><div class="panel-h"><div><h3>Backups</h3><span class="sub">A snapshot of the whole database every ${bk.every_hours || 24}h, the newest ${bk.keep || 14} kept</span></div><span class="spacer"></span><button class="btn sm primary" data-backup-now ${bk.writable === false ? "disabled" : ""}>Back up now</button></div>
            <div class="set-row"><span class="t"><b>${okLine(last && (Date.now() - new Date(last.taken_at)) < 36 * 36e5, `Last backup ${last ? ago(last.taken_at) : ""}`, last ? `Last backup ${ago(last.taken_at)}` : "No backup yet")}</b>
              <small>Saved on this computer in <span class="mono">${esc(!bk.host_dir || bk.host_dir === "./backups" ? "backups\\ next to docker-compose.yml" : bk.host_dir)}</span>, outside Docker, so they survive losing the container's volume.${bk.writable === false ? ` <span class="late">The folder isn't writable.</span>` : ""}</small></span></div>
            ${bk.backups.map(b => `<div class="bk"><span><b>${fmtDate(b.taken_at, { weekday: "short", day: "numeric", month: "short" })} ${b.taken_at.slice(11, 16)}</b> <span class="tag">${b.reason}</span>
                <small>${b.counts ? `${b.counts.items} items · ${b.counts.notes} notes · ${b.counts.projects} projects · ` : ""}${kb(b.size)}</small></span>
              <span class="acts"><a class="btn sm ghost" href="/api/backups/${encodeURIComponent(b.name)}" download>Download</a><button class="btn sm" data-restore="${esc(b.name)}" data-when="${esc(b.taken_at)}">Restore</button></span></div>`).join("") || `<div class="empty">${esc(bk.error || "No backups yet.")}</div>`}
          </section>
          <section class="panel" id="sect-git"><div class="panel-h"><div><h3>Git sync</h3><span class="sub">Branches and MRs, read every ${gc?.every_minutes ?? 15} minutes. Your repos are mounted read-only.</span></div><span class="spacer"></span><button class="btn sm primary" data-git-sync ${gc?.mounted ? "" : "disabled"}>Sync now</button></div>
            ${gc ? `<div class="set-row"><span class="t"><b>${okLine(gc.mounted, `Repos folder ${esc(gc.repos_host)}`, "Repos folder not mounted")}</b><small>Projects are matched by their repo path; frub-style folders with several repos inside are searched one level down.</small></span></div>
            <div class="set-row"><span class="t"><b>${okLine(gc.gitlab_token, "GitLab token set", "No GitLab token")}</b><small>${gc.gitlab_token ? `MR state from ${esc(gc.gitlab_url)}` : "Add GITLAB_TOKEN (scope read_api) to .env, then restart, to follow frub's merge requests."}</small></span></div>
            <div class="set-row"><span class="t"><b>${okLine(gc.github_token, "GitHub token set", "No GitHub token")}</b><small>${gc.github_token ? "PR state from github.com" : "Add GITHUB_TOKEN (fine-grained, Pull requests: read) to .env, then restart, to follow PRs."}</small></span></div>
            <div class="set-row"><span class="t"><b>${gc.auto_status ? "Moves items forward on its own" : "Status changes are off"}</b><small>An open MR moves an item to submitted, a merged one to merged, with a note. It never moves anything back. Set DEVTRACK_GIT_AUTO_STATUS=0 to turn it off.</small></span></div>
            <div class="set-row"><span class="t"><b>${lr ? `Last sync ${ago(lr.started_at)}` : "Not synced since the last restart"}</b><small>${lr ? `${lr.items} branches in ${lr.seconds}s · ${lr.changed.length} moved · ${lr.errors} with a warning (open an item to see it)` : "The first sync runs about 20 seconds after start."}</small></span></div>`
            : `<div class="empty">Git sync isn't available.</div>`}
          </section>
          <section class="panel" id="sect-data"><div class="panel-h"><div><h3>Data</h3><span class="sub">Everything lives in the DevTrack container</span></div></div>
            <div class="set-row"><span class="t"><b>Export everything</b><small>Projects, items and notes as JSON</small></span><a class="btn" href="/api/export" download>Export JSON</a></div>
            <div class="set-row"><span class="t"><b>Calendar feed</b><small>Subscribe in Outlook or Apple Calendar: <span class="mono">${esc(location.origin)}/api/calendar.ics</span></small></span><a class="btn" href="/api/calendar.ics" download="devtrack.ics">Download .ics</a></div>
            <div class="set-row"><span class="t"><b>API</b><small>REST docs; agents use the MCP endpoint at <span class="mono">/mcp</span></small></span><a class="btn" href="/api/docs" target="_blank" rel="noopener">Open docs</a></div>
            <div class="set-row"><span class="t"><b>Focus history</b><small>${days ? `${days} day${days === 1 ? "" : "s"} of focus sessions, saved in DevTrack` : "No focus sessions logged yet"}</small></span>
              <button class="btn danger" data-clear-focus ${days ? "" : "disabled"}>Clear</button></div>
          </section>
          <section class="panel" id="sect-templates"><div class="panel-h"><div><h3>Templates</h3><span class="sub">Start an item with its checklist filled in. Pick one from the command bar (Ctrl K), or use Save as template in an item.</span></div></div>
            ${tpls.map(x => `<div class="bk"><span><b>${esc(x.name)}</b> <span class="tag">${esc(x.kind)}</span>${x.assignee === "me" ? ` <span class="tag">for you</span>` : ""}
                <small>${esc(x.title)}${tplSteps(x.description) ? ` · ${tplSteps(x.description)} steps` : ""}${x.estimate_hours ? ` · ${x.estimate_hours}h` : ""}</small></span>
              <span class="acts"><button class="btn sm" data-tpl-use="${x.id}">Use</button><button class="btn sm ghost danger" data-tpl-del="${x.id}" data-name="${esc(x.name)}">Delete</button></span></div>`).join("") || `<div class="empty">No templates yet.</div>`}
            <form id="tplForm" class="tpl-form" autocomplete="off">
              <input name="name" placeholder="Template name, e.g. Hotfix" aria-label="Template name" required maxlength="80">
              <select name="kind" aria-label="Kind">${state.meta.kinds.map(k => `<option ${k === "task" ? "selected" : ""}>${k}</option>`).join("")}</select>
              <textarea name="steps" rows="3" placeholder="One step per line" aria-label="Steps"></textarea>
              <button type="submit" class="btn primary sm">Add template</button>
            </form>
          </section>
          <section class="panel" id="sect-keys"><div class="panel-h"><h3>Shortcuts</h3></div>
            <div class="keys">${[["Command bar", "Ctrl K"], ["New item", "N"], ["Filter tasks", "/"], ["Switch view", "1 – 9"], ["Start or pause focus", "F"], ["Calendar: move", "← →"], ["Calendar: today", "T"], ["Save item", "Ctrl Enter"], ["Close dialog", "Esc"]]
              .map(([a, k]) => `<div><span>${a}</span><span>${k.split(" ").map(x => `<kbd>${x}</kbd>`).join(" ")}</span></div>`).join("")}</div></section>
        </div>
      </div>`;
  },

  async agenda() {
    const p = projectFilter.value;
    const a = await api(`/api/agenda?days=14${p ? "&project=" + encodeURIComponent(p) : ""}`);
    const allOverdue = a.overdue.length;
    const evRow = e => `<div class="row" data-item="${e.item.id}">
        <input type="checkbox" class="round" data-milestone="${e.type}" data-id="${e.item.id}" title="Mark ${e.type} done → ${MILESTONE_STATUS[e.type]}" aria-label="Mark ${e.type} of ${esc(e.item.title)} done">
        <span class="ev ${e.type}">${e.type}</span>
        <span class="t"><span class="title">${esc(e.item.title)}</span>
          <span class="sub"><span class="proj">${esc(e.item.project)}</span>${e.item.branch ? `<span class="mono">${esc(e.item.branch)}</span>` : ""}${tags(e.item)}</span></span>
        <span class="right">${statusChip(e.item.status)}</span></div>`;
    const itemRow = (it, check) => `<div class="row" data-item="${it.id}">
        ${check ? `<input type="checkbox" class="round" data-done="${it.id}" title="Mark done" aria-label="Mark ${esc(it.title)} done">` : ""}
        <span class="t"><span class="title">${esc(it.title)}</span>
          <span class="sub"><span class="proj">${esc(it.project)}</span>${it.branch ? `<span class="mono">${esc(it.branch)}</span>` : ""}${it.submit_on ? `<span>submit ${fmtDate(it.submit_on)}</span>` : ""}${it.due_on ? `<span class="${it.due_on < a.today ? "late" : ""}">due ${fmtDate(it.due_on)}</span>` : ""}${holdTag(it)}${repeatTag(it)}${depTag(it)}${gitBadges(it)}</span></span>
        <span class="right">${it.assignee === "me" ? holdBtn(it) : ""}${statusChip(it.status)}</span></div>`;
    noteWaiting(a.on_hold);
    const byWait = {};
    a.on_hold.forEach(i => (byWait[i.waiting_for || "Snoozed"] ||= []).push(i));
    const holdPanel = Object.entries(byWait).sort((x, y) => y[1].length - x[1].length)
      .map(([w, list]) => `<div class="hgroup">${esc(w)} <span class="count">${list.length}</span></div>` + list.map(it => itemRow(it, false)).join("")).join("");
    const counts = {};
    a.waiting_on_me.forEach(i => counts[i.project] = (counts[i.project] || 0) + 1);
    const meProj = counts[state.meProject] ? state.meProject : "";
    const mine = meProj ? a.waiting_on_me.filter(i => i.project === meProj) : a.waiting_on_me;
    const chips = Object.keys(counts).length > 1 ? `<div class="chips" role="group" aria-label="Filter waiting items by project">
        <button class="chip ${meProj ? "" : "on"}" data-me-proj="" aria-pressed="${!meProj}">All <b>${a.waiting_on_me.length}</b></button>
        ${Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([pr, n]) => `<button class="chip ${pr === meProj ? "on" : ""}" data-me-proj="${esc(pr)}" aria-pressed="${pr === meProj}">${esc(pr)} <b>${n}</b></button>`).join("")}
      </div>` : "";
    // timeline filters (project / status / milestone type), options limited to what is on the timeline
    const allEv = [...a.overdue, ...a.upcoming], tl = state.tl;
    const tally = key => allEv.reduce((m, e) => (m[key(e)] = (m[key(e)] || 0) + 1, m), {});
    const tlProjects = tally(e => e.item.project), tlStatuses = tally(e => e.item.status), tlTypes = tally(e => e.type);
    const keep = e => (!tl.project || e.item.project === tl.project) && (!tl.status || e.item.status === tl.status) && (!tl.type || e.type === tl.type);
    const tlSel = (key, all, counts, fmt = v => v) => `<select data-tl="${key}" aria-label="Timeline ${key}"><option value="">${all}</option>${Object.keys(counts).sort().map(v => `<option value="${esc(v)}" ${tl[key] === v ? "selected" : ""}>${esc(fmt(v))} (${counts[v]})</option>`).join("")}</select>`;
    const tlActive = tl.project || tl.status || tl.type;
    const tlFilters = allEv.length ? `<div class="panel-filters">
        ${tlSel("project", "All projects", tlProjects)}${tlSel("status", "Any status", tlStatuses, label)}${tlSel("type", "All milestones", tlTypes)}
        ${tlActive ? `<button class="btn sm ghost reset" data-tl-reset>Clear filters</button>` : ""}</div>` : "";
    a.overdue = a.overdue.filter(keep); a.upcoming = a.upcoming.filter(keep);
    const tlCount = a.overdue.length + a.upcoming.length;
    const list = (key, arr, check, empty) => {
      if (!arr.length) return `<div class="empty">${empty}</div>`;
      const open = state.expanded[key], shown = open ? arr : arr.slice(0, 6);
      return shown.map(it => itemRow(it, check)).join("") + (arr.length > 6 ? `<button class="more" data-expand="${key}">${open ? "Show less" : `Show all ${arr.length}`}</button>` : "");
    };
    const groups = {};
    a.upcoming.forEach(e => (groups[e.date] ||= []).push(e));
    const timeline = (a.overdue.length ? `<div class="day overdue">Overdue</div>` + a.overdue.map(e => evRow(e).replace('<span class="title">', `<span class="title"><span class="late">${rel(e.date)}</span> · `)).join("") : "")
      + Object.entries(groups).map(([d, evs]) => `<div class="day">${fmtDate(d, { weekday: "long", day: "numeric", month: "short" })} <span class="rel">${rel(d)}</span></div>` + evs.map(evRow).join("")).join("");
    return `
      <div class="tiles">
        <div class="panel tile ${allOverdue ? "alert" : ""}"><span class="n">${allOverdue}</span><span class="l">Overdue milestones</span></div>
        <div class="panel tile"><span class="n">${allEv.length - allOverdue}</span><span class="l">Milestones in the next 14 days</span></div>
        <div class="panel tile"><span class="n">${a.waiting_on_me.length}</span><span class="l">Waiting on you</span></div>
        <div class="panel tile"><span class="n">${a.on_hold.length}</span><span class="l">On hold, waiting on others</span></div>
        <div class="panel tile"><span class="n">${a.parked.length}</span><span class="l">Parked, built early</span></div>
      </div>
      <div class="cols">
        <div class="stack">
          <div class="panel"><div class="panel-h"><h3>Waiting on you</h3><span class="count">${a.waiting_on_me.length}</span><span class="spacer"></span><span class="muted" style="font-size:13px">Tick to mark done</span></div>${chips}${list("me", mine, true, "Nothing waiting on you.")}</div>
          <div class="panel"><div class="panel-h"><h3>Timeline</h3><span class="count">${tlActive ? `${tlCount} of ${allEv.length}` : allEv.length}</span><span class="spacer"></span><span class="muted" style="font-size:13px">${fmtDate(a.today, { weekday: "long", day: "numeric", month: "long" })}</span></div>
            ${tlFilters}${timeline || `<div class="empty">${tlActive ? "No milestones match these filters." : "Nothing scheduled in the next 14 days."}</div>`}</div>
        </div>
        <div class="stack">
          <div class="panel"><div class="panel-h"><h3>Parked, needs re-date</h3><span class="count">${a.parked.length}</span></div>${list("parked", a.parked, false, "No early builds waiting.")}</div>
          <div class="panel"><div class="panel-h"><div><h3>On hold</h3><span class="sub">Waiting on someone else, or snoozed. They come back on their check-back day.</span></div><span class="count">${a.on_hold.length}</span></div>${holdPanel || `<div class="empty">Nothing on hold. Use the clock on a to-do to park it.</div>`}</div>
          <div class="panel"><div class="panel-h"><h3>Blocked</h3><span class="count">${a.blocked.length}</span></div>${list("blocked", a.blocked, false, "Nothing blocked.")}</div>
        </div>
      </div>`;
  },

  async items() {
    const f = state.filters, p = projectFilter.value;
    const q = new URLSearchParams({ include_closed: f.closed });
    if (p) q.set("project", p); if (f.status) q.set("status", f.status);
    if (f.assignee) q.set("assignee", f.assignee); if (f.search) q.set("search", f.search);
    const items = await api("/api/items?" + q);
    state.visible = items.map(i => i.id);
    for (const id of [...state.selected]) if (!state.visible.includes(id)) state.selected.delete(id);
    const today = todayISO(), n = state.selected.size;
    const opt = (arr, sel, all) => `<option value="">${all}</option>` + arr.map(v => `<option value="${v}" ${v === sel ? "selected" : ""}>${label(v)}</option>`).join("");
    const next = it => it.next_milestone
      ? `<span class="ms"><span class="ev ${it.next_milestone.type}">${it.next_milestone.type}</span><span class="${it.next_milestone.date < today ? "late" : ""}">${fmtDate(it.next_milestone.date)}</span><span class="muted" style="font-size:12.5px">${rel(it.next_milestone.date)}</span></span>` : `<span class="muted">—</span>`;
    return `
      <div class="toolbar">
        <input id="fSearch" type="search" placeholder="Search title, branch, ticket  ( / )" value="${esc(f.search)}" aria-label="Search items">
        <select id="fStatus" aria-label="Status">${opt(state.meta.statuses, f.status, "Any open status")}</select>
        <select id="fAssignee" aria-label="Assignee">${opt(state.meta.assignees, f.assignee, "Anyone")}</select>
        <label class="check"><input type="checkbox" id="fClosed" ${f.closed ? "checked" : ""}> Show done and cancelled</label>
        <span class="spacer"></span><span class="muted">${items.length} item${items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="bulk" ${n ? "" : "hidden"}>
        <strong>${n} selected</strong>
        <button class="btn sm" data-bulk="done">Mark done</button>
        <select data-bulk-field="status" aria-label="Set status"><option value="">Set status…</option>${state.meta.statuses.map(s => `<option value="${s}">${label(s)}</option>`).join("")}</select>
        <select data-bulk-field="assignee" aria-label="Assign to"><option value="">Assign to…</option><option value="me">me</option><option value="agent">agent</option></select>
        <select data-bulk-field="priority" aria-label="Set priority"><option value="">Priority…</option>${state.meta.priorities.map(s => `<option>${s}</option>`).join("")}</select>
        <span class="spacer"></span>
        <button class="btn sm danger ghost" data-bulk="delete">Delete</button>
        <button class="btn sm ghost" data-bulk="clear">Clear</button>
      </div>
      <div class="panel tablewrap"><table>
        <thead><tr>
          <th class="cb"><input type="checkbox" id="selAll" aria-label="Select all" ${n && n === items.length ? "checked" : ""}></th>
          <th>Item</th><th>Status</th><th>Next milestone</th><th>Checklist</th><th class="num">Estimate</th><th class="num">Cost</th></tr></thead>
        <tbody>${items.map(it => `<tr data-item="${it.id}" class="${state.selected.has(it.id) ? "sel" : ""} ${["done", "cancelled"].includes(it.status) ? "closed" : ""}">
            <td class="cb"><input type="checkbox" data-sel="${it.id}" ${state.selected.has(it.id) ? "checked" : ""} aria-label="Select ${esc(it.title)}"></td>
            <td><div class="title">${esc(it.title)}</div>
              <div class="sub"><span class="proj">${esc(it.project)}</span><span class="proj">#${it.id}</span>${it.ticket_ref ? `<span>${esc(it.ticket_ref)}</span>` : ""}${it.branch ? `<span class="mono">${esc(it.branch)}</span>` : ""}${tags(it)}</div></td>
            <td>${statusChip(it.status)}</td>
            <td>${next(it)}</td>
            <td>${progressHTML(it.description)}</td>
            <td class="num">${hours(it.estimate_hours)}</td><td class="num">${money(it.cost, it.currency)}</td></tr>`).join("")
          || `<tr><td colspan="7" class="empty">No items match these filters.</td></tr>`}</tbody>
      </table></div>`;
  },

  async calendar() {
    const c = state.cal, p = projectFilter.value, today = todayISO();
    const anchor = parseISO(c.anchor ||= today);
    const MS = [["submit", "submit_on"], ["merge", "merge_on"], ["deploy", "deploy_on"], ["due", "due_on"]];
    const items = await api(`/api/items?include_closed=true&limit=5000${p ? "&project=" + encodeURIComponent(p) : ""}`);
    const byDay = {};
    for (const it of items) {
      if (it.status === "cancelled") continue;
      for (const [type, field] of MS) {
        const d = it[field]; if (!d || !c.types[type]) continue;
        const done = RANK[it.status] >= RANK[MILESTONE_STATUS[type]];
        if (done && !c.done) continue;
        (byDay[d] ||= []).push({ type, field, done, it, late: !done && d < today });
      }
    }
    const order = { submit: 0, merge: 1, deploy: 2, due: 3 };
    Object.values(byDay).forEach(l => l.sort((x, y) => x.done - y.done || order[x.type] - order[y.type]));
    const monday = d => addDays(d, -((d.getDay() + 6) % 7));
    let start, days, title;
    if (c.mode === "week") {
      start = monday(anchor); days = 7;
      const end = addDays(start, 6);
      title = `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
    } else {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1), last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      start = monday(first); days = Math.ceil((Math.round((last - start) / 864e5) + 1) / 7) * 7;
      title = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    const max = c.mode === "week" ? 99 : 3;
    const evHTML = e => `<div class="cal-ev ${e.type}${e.done ? " done" : ""}${e.late ? " late" : ""}" draggable="true" data-item="${e.it.id}" data-field="${e.field}" data-date="${e.it[e.field]}"
        title="${esc(`${e.type.toUpperCase()} · ${e.it.title}\n${e.it.project} · ${label(e.it.status)}${e.it.branch ? " · " + e.it.branch : ""}\nDrag to another day to reschedule`)}">
        <span class="k">${e.type}</span><span class="tt">${esc(e.it.title)}</span>${c.mode === "week" ? `<span class="pp">${esc(e.it.project)} · ${label(e.it.status)}</span>` : ""}</div>`;
    let cells = "";
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i), key = toISO(d), evs = byDay[key] || [];
      const cls = ["cal-day", key === today && "today", d.getMonth() !== anchor.getMonth() && c.mode === "month" && "other", d.getDay() % 6 === 0 && "weekend"].filter(Boolean).join(" ");
      cells += `<div class="${cls}" data-day="${key}">
        <div class="cal-num"><span>${d.getDate()}</span>${evs.length ? `<em>${evs.length}</em>` : ""}</div>
        ${evs.slice(0, max).map(evHTML).join("")}
        ${evs.length > max ? `<button class="cal-more" data-week="${key}">+${evs.length - max} more</button>` : ""}</div>`;
    }
    const heads = c.mode === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(start, i).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }))
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const from = toISO(start), to = toISO(addDays(start, days - 1));
    const total = Object.entries(byDay).filter(([d]) => d >= from && d <= to).reduce((n, [, l]) => n + l.length, 0);
    const ics = `/api/calendar.ics${p ? "?project=" + encodeURIComponent(p) : ""}`;
    return `
      <div class="cal-bar">
        <button class="btn icon" data-cal-nav="-1" aria-label="Previous">${I('<path d="m15 18-6-6 6-6"/>')}</button>
        <button class="btn" data-cal-nav="0">Today</button>
        <button class="btn icon" data-cal-nav="1" aria-label="Next">${I('<path d="m9 18 6-6-6-6"/>')}</button>
        <h2>${esc(title)}</h2>
        <div class="seg" role="radiogroup" aria-label="Calendar view">
          <label><input type="radio" name="calMode" value="month" ${c.mode === "month" ? "checked" : ""}><span>Month</span></label>
          <label><input type="radio" name="calMode" value="week" ${c.mode === "week" ? "checked" : ""}><span>Week</span></label>
        </div>
        <span class="spacer"></span>
        <div class="cal-types">
          ${Object.keys(order).map(t => `<label class="check" style="--c:var(--c-${t})"><input type="checkbox" data-cal-type="${t}" ${c.types[t] ? "checked" : ""}><span class="dot"></span>${t}</label>`).join("")}
          <label class="check"><input type="checkbox" id="calDone" ${c.done ? "checked" : ""}> Completed</label>
        </div>
        <a class="btn" href="${ics}" download="devtrack.ics" title="Download for your calendar app, or subscribe to this URL in Outlook or Apple Calendar">${I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>')} .ics</a>
      </div>
      <div class="cal ${c.mode}">${heads.map(h => `<div class="cal-h">${h}</div>`).join("")}${cells}</div>
      <div class="cal-legend">${total} milestone${total === 1 ? "" : "s"} shown · drag a milestone to another day to reschedule · double-click a day to add an item due that day · <kbd>←</kbd> <kbd>→</kbd> move, <kbd>T</kbd> today</div>`;
  },

  async projects() {
    const [projects, costs] = await Promise.all([api("/api/projects?include_archived=true"), api("/api/costs")]);
    const fmtCost = obj => Object.entries(obj).map(([k, v]) => money(v, k)).join("<br>");
    return `
      <div class="toolbar"><span class="spacer"></span>
        <a class="btn" href="/api/export" download>Export JSON</a>
        <button class="btn primary" id="addProj">Add project</button></div>
      <div class="grid">${projects.map(p => `
        <div class="panel card" data-proj="${esc(p.slug)}" tabindex="0" role="button">
          <h4>${esc(p.name)} ${p.status !== "active" ? `<span class="tag">${p.status}</span>` : ""}</h4>
          <div class="proj">${esc(p.slug)}${p.repo_path ? " · " + esc(p.repo_path) : ""}</div>
          ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ""}
          <div class="stats">
            <div><b>${p.open_items || 0}</b><span>open</span></div>
            <div><b>${p.my_items || 0}</b><span>on you</span></div>
            <div><b>${p.parked_items || 0}</b><span>parked</span></div>
            <div><b>${hours(p.open_estimate_hours) || "0h"}</b><span>estimate</span></div>
          </div>
          <div class="muted" style="font-size:12.5px;margin-top:6px">${p.last_note_at ? "Last note " + ago(p.last_note_at) : "No notes yet"}</div>
        </div>`).join("")}</div>
      <div class="panel tablewrap" style="margin-top:22px">
        <div class="panel-h"><h3>Effort and cost</h3><span class="spacer"></span><span class="muted">${fmtCost(costs.total_cost).replace(/<br>/g, " · ") || "No costs recorded yet"}</span></div>
        <table><thead><tr><th>Project</th><th class="num">Items</th><th class="num">Open estimate</th><th class="num">Actual</th><th class="num">Cost open</th><th class="num">Cost done</th></tr></thead>
        <tbody>${costs.projects.map(c => `<tr data-filter-project="${esc(c.project)}"><td class="proj">${esc(c.project)}</td><td class="num">${c.items}</td>
          <td class="num">${hours(c.open_estimate_hours)}</td><td class="num">${hours(c.actual_hours)}</td>
          <td class="num">${fmtCost(c.cost_open)}</td><td class="num">${fmtCost(c.cost_done)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No items yet.</td></tr>`}</tbody></table></div>`;
  },

  async review() {
    const p = projectFilter.value, rv = state.review;
    const r = await api(`/api/review?${new URLSearchParams({ ...(rv.day && { day: rv.day }), ...(p && { project: p }) })}`);
    state.reviewMd = r.markdown;
    const thisWeek = !rv.day || r.start <= todayISO() && todayISO() <= r.end;
    const row = (it, extra = "") => `<div class="row" data-item="${it.id}"><span class="t"><span class="title">${esc(it.title)}</span>
        <span class="sub"><span class="proj">${esc(it.project)}</span>${extra}${it.assignee === "me" ? `<span>for you</span>` : ""}</span></span><span class="right">${statusChip(it.status)}</span></div>`;
    const ev = e => row(e.item, `<span class="ev ${e.type}">${e.type}</span><span>${fmtDate(e.date, { weekday: "short", day: "numeric", month: "short" })}</span>`);
    const panel = (title, sub, body, empty) => `<div class="panel"><div class="panel-h"><div><h3>${title}</h3>${sub ? `<span class="sub">${sub}</span>` : ""}</div></div>${body || `<div class="empty">${empty}</div>`}</div>`;
    const late = new Set(r.finished_late.map(i => i.id));
    const fmtRange = `${fmtDate(r.start, { day: "numeric", month: "short" })} – ${fmtDate(r.end, { day: "numeric", month: "short" })}`;
    const acts = `<div class="pills" role="group" aria-label="Week"><button type="button" data-rv="-1" aria-label="Previous week">‹</button><button type="button" data-rv="0" class="${thisWeek ? "on" : ""}">This week</button><button type="button" data-rv="1" aria-label="Next week" ${thisWeek ? "disabled" : ""}>›</button></div>
      <button class="btn" data-rv-copy>Copy summary</button><a class="btn" href="/api/review.md?${new URLSearchParams({ day: r.start, ...(p && { project: p }) })}" download>Download .md</a>`;
    return pageH("Weekly review", `Week ${+r.week.slice(6)}, ${r.week.slice(0, 4)} · ${fmtRange}${p ? ` · ${esc(p)}` : ""}`, acts) + `
      <div class="tiles">
        ${tile("Finished", r.finished.length, r.finished_late.length ? `<small> · ${r.finished_late.length} late</small>` : "")}
        ${tile("Started", r.created.length)}
        ${tile("Slipped", r.slipped.length, "", r.slipped.length ? "alert" : "")}
        ${tile("Focus", (r.focus_minutes / 60).toFixed(1) + "<small>h</small>")}
        ${tile("Actual vs estimate", r.estimate_hours ? `${hours(r.actual_hours) || "0h"}<small> / ${hours(r.estimate_hours)}</small>` : "–")}
      </div>
      <div class="cols">
        <div class="stack">
          ${panel("Finished", "Marked done this week", r.finished.map(it => row(it, `${late.has(it.id) ? `<span class="late">late, due ${fmtDate(it.due_on)}</span>` : ""}${it.actual_hours ? `<span>${hours(it.actual_hours)}</span>` : ""}`)).join(""), "Nothing finished this week.")}
          ${panel("Slipped", "Milestones this week that passed without being reached", r.slipped.map(ev).join(""), "Nothing slipped.")}
          ${panel("Started", "Items created this week", r.created.map(it => row(it)).join(""), "No new items.")}
        </div>
        <div class="stack">
          ${panel("Next week", fmtDate(toISO(addDays(parseISO(r.end), 1)), { day: "numeric", month: "short" }) + " – " + fmtDate(toISO(addDays(parseISO(r.end), 7)), { day: "numeric", month: "short" }), r.next_week.map(ev).join(""), "Nothing scheduled.")}
          ${panel("Decisions and blockers", "Notes of those kinds this week", r.decisions.map(n => `<div class="row"><span class="t"><span class="title">${esc(n.body.split("\n")[0])}</span><span class="sub"><span class="proj">${esc(n.project)}</span><span class="tag">${n.kind}</span>${n.item_id ? `<span>#${n.item_id}</span>` : ""}</span></span></div>`).join(""), "None noted.")}
          ${panel("By project", "", r.by_project.map(x => `<div class="row" data-filter-project="${esc(x.project)}"><span class="t">${pchip(x.project)}</span><span class="right muted">${x.finished} finished · ${x.created} started</span></div>`).join(""), "No activity.")}
          ${panel("Still open", "", `<div class="row"><span class="t">Blocked</span><span class="right"><b>${r.still_open.blocked}</b></span></div><div class="row" data-goto="agenda"><span class="t">Waiting on you</span><span class="right"><b>${r.still_open.waiting_on_me}</b></span></div>`, "")}
        </div>
      </div>`;
  },

  async activity() {
    const p = projectFilter.value;
    const notes = await api(`/api/notes?limit=150${p ? "&project=" + encodeURIComponent(p) : ""}`);
    return `
      <div class="cols" style="grid-template-columns:minmax(0,1fr) 360px">
        <div class="panel"><div class="panel-h"><h3>Activity</h3><span class="count">${notes.length}</span></div>
          ${notes.map(noteHTML).join("") || `<div class="empty">No notes yet. Agents add them with the MCP handoff tool.</div>`}</div>
        <div class="panel" style="position:sticky;top:76px"><div class="panel-h"><h3>Add a note</h3></div>
          <form id="noteForm" style="padding:14px 16px;display:grid;gap:10px">
            <div style="display:flex;gap:8px">
              <select name="project" required aria-label="Project" style="flex:1">${state.projects.map(x => `<option ${x.slug === p ? "selected" : ""}>${esc(x.slug)}</option>`).join("")}</select>
              <select name="kind" aria-label="Kind">${state.meta.note_kinds.map(k => `<option>${k}</option>`).join("")}</select>
            </div>
            <div data-editor-slot="body" data-rows="5" data-mode="write" data-placeholder="What happened, what was decided…"></div>
            <div><button class="btn primary">Add note</button></div>
          </form></div>
      </div>`;
  },
};

function noteHTML(n, { showItem = true } = {}) {
  const who = n.author || "unknown", me = who === "me";
  return `<div class="note">
    <span class="avatar ${me ? "me" : ""}" aria-hidden="true">${esc(who.slice(0, 2))}</span>
    <div style="flex:1;min-width:0">
      <div class="meta"><b>${esc(who)}</b><span class="tag">${n.kind}</span>${n.project && showItem ? `<span class="proj">${esc(n.project)}</span>` : ""}
        ${showItem && n.item_id ? `<a href="#" data-item="${n.item_id}">#${n.item_id} ${esc(n.item_title || "")}</a>` : ""}
        <span title="${esc(new Date(n.created_at).toLocaleString())}">${ago(n.created_at)}</span></div>
      <div class="md">${md(n.body)}</div>
    </div></div>`;
}

const PRIO = it => state.meta.priorities.indexOf(it.priority);
const TITLES = {
  agenda: ["Agenda", "Milestones in the next 14 days, what's waiting on you, parked and blocked work"],
  calendar: ["Calendar", "Submit, merge, deploy and due dates"],
  projects: ["Projects", "Every repo DevTrack follows"],
  activity: ["Activity", "Progress notes and agent handoffs"],
};
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq, view = state.view;
  $$("#nav button").forEach(b => { const on = b.dataset.view === view; b.classList.toggle("on", on); b.toggleAttribute("aria-current", on); });
  let html;
  try { html = await views[view](); if (TITLES[view]) html = pageH(...TITLES[view]) + html; }
  catch (e) { html = `<div class="panel empty">Could not load: ${esc(e.message)}</div>`; }
  if (seq !== renderSeq) return; // a newer render started while this one was loading
  $("#view").innerHTML = html; mountEditors($("#view")); $$("#view .editor").forEach(ed => setMode(ed, "auto"));
  const all = $("#selAll"); if (all) all.indeterminate = state.selected.size > 0 && state.selected.size < state.visible.length;
  paintFocus(); persist();
}

async function loadTemplates() {
  state.templates = await api("/api/templates").catch(() => []);
}
const TPL_KEYS = ["title", "description", "kind", "priority", "assignee", "estimate_hours"];
const tplSteps = d => (String(d || "").match(/^\s*[-*+]\s+\[[ xX]\]/gm) || []).length;
function useTemplate(tpl) {
  const preset = {};
  TPL_KEYS.forEach(k => { if (tpl[k] != null) preset[k] = tpl[k]; });
  return openItem(null, preset);
}
async function loadProjects() {
  state.projects = await api("/api/projects?include_archived=true");
  const cur = projectFilter.value || state.project || "";
  projectFilter.innerHTML = `<option value="">All projects</option>` + state.projects.map(p => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join("");
  projectFilter.value = state.projects.some(p => p.slug === cur) ? cur : "";
  const mine = state.projects.reduce((s, p) => s + (p.my_items || 0), 0), b = $("#bellN");
  b.hidden = !mine; b.textContent = mine > 99 ? "99+" : mine;
}
// chart tooltips (one floating tip per chart container)
document.addEventListener("pointerover", e => {
  const hit = e.target.closest?.("[data-tip]"); if (!hit) return;
  const box = hit.closest(".chart, .donut-wrap"); if (!box) return;
  let tip = $(".ctip", box); if (!tip) { tip = document.createElement("div"); tip.className = "ctip"; box.appendChild(tip); }
  tip.innerHTML = hit.dataset.tip;
  const svg = hit.ownerSVGElement || hit.closest("svg"), sb = svg.getBoundingClientRect(), bb = box.getBoundingClientRect(), vb = svg.viewBox.baseVal, k = sb.width / vb.width;
  const r = hit.getBoundingClientRect();
  let x = r.left + r.width / 2 - bb.left, y = r.top - bb.top + 6;
  if (hit.dataset.x) { x = sb.left - bb.left + +hit.dataset.x * k; y = sb.top - bb.top + +hit.dataset.y * k;
    const cross = $(".cross", svg), dot = $(".dot", svg);
    cross.setAttribute("x1", hit.dataset.x); cross.setAttribute("x2", hit.dataset.x); cross.hidden = dot.hidden = false; cross.removeAttribute("hidden"); dot.removeAttribute("hidden");
    dot.setAttribute("cx", hit.dataset.x); dot.setAttribute("cy", hit.dataset.y); }
  if (hit.dataset.slice) $$("path[data-slice]", svg).forEach(p => p.classList.toggle("fade", p !== hit));
  tip.style.left = Math.max(60, Math.min(bb.width - 60, x)) + "px"; tip.style.top = y + "px"; tip.hidden = false;
});
document.addEventListener("pointerout", e => {
  const hit = e.target.closest?.("[data-tip]"); if (!hit || hit.contains(e.relatedTarget)) return;
  const box = hit.closest(".chart, .donut-wrap"); if (!box) return;
  const tip = $(".ctip", box); if (tip) tip.hidden = true;
  const svg = hit.ownerSVGElement || hit.closest("svg");
  $$(".cross, .dot", svg).forEach(n => n.setAttribute("hidden", "")); $$("path.fade", svg).forEach(p => p.classList.remove("fade"));
});

// ---------- quick actions
async function setStatus(id, status, prev) {
  const saved = await api(`/api/items/${id}`, { method: "PATCH", body: { status } });
  toast(`#${id} → ${label(status)}${nextNote(saved)}`, prev && { label: "Undo", run: async () => { await api(`/api/items/${id}`, { method: "PATCH", body: { status: prev } }); toast("Undone"); render(); } });
}
async function quickCheck(cb) {
  const id = +(cb.dataset.done || cb.dataset.id);
  const target = cb.dataset.done ? "done" : MILESTONE_STATUS[cb.dataset.milestone];
  const row = cb.closest(".row, .task, .kcard"); row?.classList.add("done-anim"); cb.disabled = true;
  try {
    const it = await api(`/api/items/${id}`);
    if (RANK[it.status] >= RANK[target] && it.status !== "blocked") { toast(`#${id} is already ${label(it.status)}`); return render(); }
    await setStatus(id, target, it.status); await sleep(250); render();
  } catch (e) { toast(e.message); render(); }
}

// ---------- item dialog
const itemDlg = $("#itemDlg"), itemForm = $("#itemForm");
let editing = null, dirty = false;
const ITEM_KEYS = ["title","project","kind","status","assignee","priority","ticket_ref","description","branch","base_branch","built_on","pr_url","commit_date","submit_on","merge_on","deploy_on","due_on","estimate_hours","actual_hours","cost","currency","waiting_for","snoozed_until","repeat_every","blocked_by"];
const fillSelect = (sel, values) => sel.innerHTML = values.map(v => `<option value="${esc(v)}">${esc(label(v))}</option>`).join("");
const fit = ta => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
function paintStatus() { const s = itemForm.status; s.className = "status-select s-" + s.value; }
function paintHints() {
  $$("[data-hint]", itemForm).forEach(h => {
    const v = itemForm[h.dataset.hint].value; h.textContent = v ? rel(v) : "";
    h.classList.toggle("late", !!v && relDays(v) < 0);
  });
}
function renderItemNotes() {
  const notes = editing?.notes || [];
  $("#noteCount").textContent = notes.length;
  $("#itemNotes").innerHTML = notes.map(n => noteHTML(n, { showItem: false })).join("") || `<div class="empty">No notes on this item yet.</div>`;
}
async function openItem(id, preset = {}) {
  editing = id ? await api(`/api/items/${id}`) : null;
  const it = editing || { project: projectFilter.value || state.projects[0]?.slug, kind: "task", status: "todo", assignee: "agent", priority: "normal", currency: state.meta.currency, ...preset };
  fillSelect(itemForm.project, state.projects.map(p => p.slug));
  fillSelect(itemForm.status, state.meta.statuses);
  fillSelect(itemForm.priority, state.meta.priorities);
  fillSelect(itemForm.kind, state.meta.kinds);
  itemForm.reset();
  ITEM_KEYS.forEach(k => { if (k !== "description") itemForm[k].value = k === "commit_date" ? (it[k] || "").slice(0, 16) : k === "blocked_by" ? (it[k] || []).map(i => "#" + i).join(", ") : (it[k] ?? ""); });
  setEditor(itemForm.description, it.description);
  setEditor(itemForm.noteBody, "");
  $("#itemCrumbs").innerHTML = editing
    ? `<span class="proj">${esc(editing.project)}</span><span>/</span><b style="color:var(--text)">#${editing.id}</b><span class="muted" style="font-size:13px">updated ${ago(editing.updated_at)}</span>`
    : `<b style="color:var(--text)">New item</b>`;
  $("#deleteItem").hidden = $("#redateBtn").hidden = $("#focusBtn").hidden = !editing;
  $("#activitySection").hidden = !editing;
  $("#checklistProgress").innerHTML = progressHTML(it.description);
  paintStatus(); paintHints(); renderItemNotes();
  noteWaiting([it]); fillWaitingList();
  const gl = $("#gitLine"); gl.innerHTML = editing ? gitLine(editing) : ""; gl.hidden = !(editing && editing.branch);
  $("#gitSyncItem").hidden = !(editing && editing.branch);
  dirty = false;
  itemDlg.showModal(); fit(itemForm.title);
  if (!editing) itemForm.title.focus();
}
async function closeItem() {
  if (dirty && !(await ask("Discard changes?", "You have unsaved changes on this item.", { ok: "Discard", danger: true }))) return;
  dirty = false; itemDlg.close();
}
itemForm.addEventListener("input", e => {
  if (e.target.closest(".composer")) return;
  dirty = true;
  if (e.target === itemForm.title) fit(e.target);
  if (e.target.name === "description") $("#checklistProgress").innerHTML = progressHTML(e.target.value);
});
itemForm.addEventListener("change", e => { if (e.target.name === "status") paintStatus(); if (/_on$/.test(e.target.name)) paintHints(); if (!e.target.closest(".composer")) dirty = true; });
itemForm.title.addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });
itemForm.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); itemForm.requestSubmit(); } });
itemDlg.addEventListener("cancel", e => { e.preventDefault(); closeItem(); });
itemForm.addEventListener("submit", async e => {
  e.preventDefault();
  const body = {};
  ITEM_KEYS.forEach(k => { const v = String(itemForm[k].value ?? "").trim(); body[k] = v === "" ? null : v; });
  try {
    const saved = editing ? await api(`/api/items/${editing.id}`, { method: "PATCH", body }) : await api("/api/items", { method: "POST", body });
    dirty = false; itemDlg.close(); toast((editing ? `Saved #${saved.id}` : `Created #${saved.id}`) + nextNote(saved)); await loadProjects(); render();
  } catch (err) { toast(err.message); }
});
$("#saveTplBtn").onclick = async () => {
  const name = itemForm.title.value.trim(); if (!name) return itemForm.title.focus();
  const body = { name };
  TPL_KEYS.forEach(k => { const v = String(itemForm[k].value ?? "").trim(); body[k] = v || (k === "description" || k === "estimate_hours" ? null : undefined); });
  try {
    const exists = state.templates?.some(x => x.name.toLowerCase() === name.toLowerCase());
    if (exists && !(await ask(`Replace the ${name} template?`, "A template with this name exists. Its title, checklist, kind, priority, assignee and estimate are replaced with this item's.", { ok: "Replace" }))) return;
    const x = await api("/api/templates", { method: "POST", body });
    await loadTemplates(); toast(`Saved the ${x.name} template`);
  } catch (err) { toast(err.message); }
};
$("#deleteItem").onclick = async () => {
  if (!editing || !(await ask(`Delete #${editing.id}?`, `"${editing.title}" and its link to notes will be removed. This can't be undone.`, { ok: "Delete", danger: true }))) return;
  await api(`/api/items/${editing.id}`, { method: "DELETE" }); dirty = false; itemDlg.close(); toast("Deleted"); render();
};
$("#addItemNote").onclick = async () => {
  const ta = itemForm.noteBody, v = ta.value.trim(); if (!v) return ta.focus();
  try {
    await api("/api/notes", { method: "POST", body: { item_id: editing.id, body: v, kind: $("#noteKind").value } });
    editing.notes = (await api(`/api/items/${editing.id}`)).notes; setEditor(ta, ""); renderItemNotes(); toast("Note added");
  } catch (err) { toast(err.message); }
};
$("#gitSyncItem").onclick = async () => {
  const b = $("#gitSyncItem"); b.textContent = "Syncing…"; b.disabled = true;
  try {
    const r = await api(`/api/git/sync?item_id=${editing.id}`, { method: "POST" });
    const fresh = await api(`/api/items/${editing.id}`);
    editing.git = fresh.git; $("#gitLine").innerHTML = gitLine(fresh);
    if (r.changed.length) { toast(`#${editing.id} moved to ${label(r.changed[0].changed)} by git sync`); itemForm.status.value = fresh.status; paintStatus(); editing.notes = fresh.notes; renderItemNotes(); }
    else toast("Git status refreshed");
  } catch (err) { toast(err.message); }
  b.textContent = "Sync now"; b.disabled = false;
};
$("#focusBtn").onclick = () => { const it = editing; dirty = false; itemDlg.close(); startFocus(look.focusMin, { id: it.id, title: it.title }); toast(`Focusing on #${it.id} for ${look.focusMin} min`); };
$("#redateBtn").onclick = async () => {
  try {
    const r = await api(`/api/items/${editing.id}/redate`);
    $("#scriptTitle").textContent = `Re-date ${r.branch}`;
    $("#scriptInfo").textContent = `Rebases onto ${r.base} and spreads commit dates over ${fmtDate(r.date, { weekday: "long", day: "numeric", month: "long" })}, ${r.window}. ${r.after}`;
    $("#scriptBody").textContent = r.script;
    $("#copyScript").onclick = () => navigator.clipboard.writeText(r.script).then(() => toast("Script copied"));
    $("#scriptDlg").showModal();
  } catch (err) { toast(err.message); }
};

// ---------- project dialog
const projDlg = $("#projDlg"), projForm = $("#projForm");
let editingProj = null;
function openProject(slug) {
  fillSelect(projForm.status, state.meta.project_statuses);
  projForm.reset();
  editingProj = state.projects.find(p => p.slug === slug) || null;
  const p = editingProj || { status: "active" };
  ["slug", "name", "status", "repo_path", "repo_url"].forEach(k => projForm[k].value = p[k] ?? "");
  setEditor(projForm.description, p.description);
  projForm.slug.readOnly = !!editingProj;
  $("#projTitle").textContent = editingProj ? editingProj.name : "New project";
  $("#deleteProj").hidden = !editingProj;
  projDlg.showModal(); if (!editingProj) projForm.name.focus();
}
projForm.name.addEventListener("input", () => { if (!editingProj) projForm.slug.value = projForm.name.value.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""); });
projForm.addEventListener("submit", async e => {
  e.preventDefault();
  const body = {}; ["name", "status", "repo_path", "repo_url", "description"].forEach(k => body[k] = projForm[k].value);
  if (!body.name) body.name = projForm.slug.value;
  try {
    if (editingProj) await api(`/api/projects/${editingProj.id}`, { method: "PATCH", body });
    else await api("/api/projects", { method: "POST", body: { slug: projForm.slug.value.trim().toLowerCase(), ...body } });
    projDlg.close(); toast("Project saved"); await loadProjects(); render();
  } catch (err) { toast(err.message); }
});
$("#deleteProj").onclick = async () => {
  if (!editingProj || !(await ask(`Delete ${editingProj.slug}?`, "This deletes the project with all its items and notes. This can't be undone.", { ok: "Delete project", danger: true }))) return;
  await api(`/api/projects/${editingProj.id}`, { method: "DELETE" }); projDlg.close(); await loadProjects(); render();
};


// ---------- command bar (Ctrl+K)
const cmdk = $("#cmdk"), ckq = $("#ckq"), cklist = $("#cklist");
const ICON = {
  go: '<path d="m9 18 6-6-6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', item: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m9 12 2 2 4-4"/>',
  focus: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>', git: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 5-8 3-12 7"/>',
  disk: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>', theme: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  proj: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};
const ic = k => `<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg></span>`;
const VIEW_NAMES = { home: "Home", tasks: "Tasks", agenda: "Agenda", calendar: "Calendar", projects: "Projects", insights: "Insights", review: "Weekly review", activity: "Activity", settings: "Settings" };
const DATE_WORD = /^(today|tomorrow|\+\d+d|\d{4}-\d{2}-\d{2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
// "Fix invoice PDF frub high due friday #bug" -> title + {project, priority, due_on, kind}
function parseQuick(text) {
  const out = { fields: {}, chips: [] }, words = text.trim().split(/\s+/), keep = [];
  const slugs = new Set(state.projects.map(p => p.slug)), f = out.fields;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], lw = w.toLowerCase().replace(/^@/, "");
    const ms = { submit: "submit_on", merge: "merge_on", deploy: "deploy_on", due: "due_on", by: "due_on" }[lw];
    if (ms && keep.length && words[i + 1]) {
      let d = words[i + 1].toLowerCase(), used = 1;
      if (d === "next" && words[i + 2] && DATE_WORD.test(words[i + 2])) { d = "next " + words[i + 2].toLowerCase(); used = 2; }
      if (DATE_WORD.test(d) || d.startsWith("next ")) { f[ms] = d; out.chips.push(`${ms.replace("_on", "")} ${d}`); i += used; continue; }
    }
    // a project slug or a priority word only counts after the first word, so a title can start with it
    if (!f.project && slugs.has(lw) && (w.startsWith("@") || keep.length)) { f.project = lw; continue; }
    if (!f.priority && /^!?(urgent|high|low)$/i.test(w) && keep.length) { f.priority = lw.replace("!", ""); out.chips.push(f.priority); continue; }
    if (/^#(bug|feature|chore|task|followup|deploy)$/i.test(w)) { f.kind = w.slice(1).toLowerCase(); out.chips.push(f.kind); continue; }
    if (lw === "me" && /^(for|on)$/i.test(keep.at(-1) || "")) { keep.pop(); f.assignee = "me"; out.chips.push("for you"); continue; }
    keep.push(w);
  }
  out.title = keep.join(" ");
  return out;
}
let ckItems = [], ckSel = 0, ckSeq = 0;
function ckCommands() {
  return [
    { k: "plus", t: "New item", s: "Open the item editor", kbd: "N", run: () => openItem(null) },
    { k: "focus", t: focusS ? (focusS.endsAt ? "Pause focus" : "Resume focus") : `Start a ${look.focusMin}-minute focus`, s: focusS ? focusS.title : "The island keeps the time", kbd: "F", run: () => focusS ? focusAction("pause") : startFocus() },
    ...(focusS ? [{ k: "focus", t: "End focus session", run: () => focusAction("end") }] : []),
    { k: "git", t: "Sync git now", s: "Branches and MRs", run: async () => { toast("Syncing git…"); const r = await api("/api/git/sync", { method: "POST" }); toast(`Synced ${r.items} branches${r.changed.length ? ` · ${r.changed.length} moved forward` : ""}`); render(); } },
    { k: "disk", t: "Back up now", s: "Snapshot the database", run: async () => { const b = await api("/api/backups", { method: "POST" }); toast(`Backed up ${b.counts?.items ?? ""} items`); } },
    { k: "theme", t: isDark() ? "Switch to light" : "Switch to dark", run: () => { look.theme = isDark() ? "light" : "dark"; applyLook(); render(); } },
    ...VIEWS.map((v, i) => ({ k: "go", t: `Go to ${VIEW_NAMES[v]}`, kbd: String(i + 1), run: () => { state.view = v; render(); } })),
    { k: "proj", t: "Show all projects", run: () => { projectFilter.value = ""; render(); } },
    ...state.projects.map(p => ({ k: "proj", t: `Show ${p.name}`, s: `${p.open_items || 0} open · ${p.my_items || 0} on you`, run: () => { projectFilter.value = p.slug; render(); } })),
  ];
}
const fuzzy = (q, t) => { q = q.toLowerCase(); t = t.toLowerCase(); let i = 0; for (const ch of t) if (ch === q[i]) i++; return i === q.length; };
async function ckRender() {
  const q = ckq.value.trim(), seq = ++ckSeq;
  const all = ckCommands(), ql = q.toLowerCase();
  // commands whose name contains the text lead (so "sync" + Enter syncs); fuzzy-only ones trail
  const strong = q ? all.filter(c => c.t.toLowerCase().includes(ql)) : all;
  const cmds = q ? all.filter(c => !strong.includes(c) && fuzzy(q, c.t)) : [];
  let found = [];
  const idm = q.match(/^#?(\d+)$/);
  if (q.length >= 2 || idm) {
    try {
      found = idm ? [await api(`/api/items/${idm[1]}`).catch(() => null)].filter(Boolean)
        : await api(`/api/items?include_closed=true&limit=8&search=${encodeURIComponent(q)}`);
    } catch { found = []; }
    if (seq !== ckSeq) return; // a newer keystroke is already rendering
  }
  const tpls = (state.templates || []).filter(x => !q || fuzzy(q, x.name) || fuzzy(q, "template " + x.name));
  const quick = q.length >= 3 && !idm ? parseQuick(q) : null;
  const qProj = quick && (quick.fields.project || projectFilter.value || state.projects[0]?.slug);
  ckItems = [
    ...strong.slice(0, q ? 6 : 30).map(c => ({ sec: "Commands", ...c, sub: c.s ? esc(c.s) : "" })),
    ...tpls.slice(0, q ? 4 : 8).map(x => ({ sec: "Templates", k: "plus", t: `New ${x.name}`, sub: `${esc(x.kind)}${tplSteps(x.description) ? ` · ${tplSteps(x.description)} steps` : ""}${x.assignee === "me" ? " · for you" : ""}`, run: () => useTemplate(x) })),
    ...found.slice(0, 8).map(it => ({ sec: "Items", k: "item", t: `#${it.id} ${it.title}`, sub: `${pchip(it.project)}${statusChip(it.status)}${holdTag(it)}${repeatTag(it)}${depTag(it)}`, run: () => openItem(it.id) })),
    ...(quick && quick.title ? [{ sec: "Create", k: "plus", t: `New item: ${quick.title}`, kbd: "Shift ↵",
        sub: pchip(qProj) + quick.chips.map(c => `<span class="tag">${esc(c)}</span>`).join(""), run: () => quickCreate(quick, qProj) }] : []),
    ...cmds.slice(0, 5).map(c => ({ sec: "More commands", ...c, sub: c.s ? esc(c.s) : "" })),
  ];
  ckSel = Math.min(ckSel, Math.max(0, ckItems.length - 1));
  let sec = "";
  cklist.innerHTML = ckItems.map((x, i) => (x.sec !== sec ? `<div class="ck-sec">${(sec = x.sec)}</div>` : "")
    + `<div class="ck-it${i === ckSel ? " on" : ""}" role="option" aria-selected="${i === ckSel}" data-ck="${i}">${ic(x.k)}<span class="tx"><b>${esc(x.t)}</b>${x.sub ? `<small>${x.sub}</small>` : ""}</span>${x.kbd ? `<kbd>${x.kbd}</kbd>` : ""}</div>`).join("")
    || `<div class="ck-empty">Nothing matches.</div>`;
}
async function quickCreate(qp, project) {
  try {
    const it = await api("/api/items", { method: "POST", body: { ...qp.fields, project, title: qp.title } });
    toast(`Created #${it.id} in ${it.project}`, { label: "Open", run: () => openItem(it.id) });
    await loadProjects(); render();
  } catch (err) { toast(err.message); }
}
function openCmdk() { if (cmdk.open) return; ckq.value = ""; ckSel = 0; cmdk.showModal(); ckRender(); ckq.focus(); }
async function ckRun(i) {
  const x = ckItems[i]; if (!x) return;
  cmdk.close();
  try { await x.run(); } catch (err) { toast(err.message); }
}
let ckT;
ckq.addEventListener("input", () => { ckSel = 0; clearTimeout(ckT); ckT = setTimeout(ckRender, 120); });
ckq.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); if (!ckItems.length) return;
    ckSel = (ckSel + (e.key === "ArrowDown" ? 1 : -1) + ckItems.length) % ckItems.length;
    $$(".ck-it", cklist).forEach((n, i) => { n.classList.toggle("on", i === ckSel); n.setAttribute("aria-selected", i === ckSel); });
    $(".ck-it.on", cklist)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(ckT);
    const go = () => { if (e.shiftKey) { const qi = ckItems.findIndex(x => x.sec === "Create"); if (qi >= 0) return ckRun(qi); } ckRun(ckSel); };
    // results lag the input by the debounce; render first so Enter acts on what was typed
    ckRender().then(go);
  }
});
cklist.addEventListener("click", e => { const n = e.target.closest("[data-ck]"); if (n) ckRun(+n.dataset.ck); });
cmdk.addEventListener("mousedown", e => { if (e.target === cmdk) cmdk.close(); });
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !e.target.closest?.(".editor")) {
    e.preventDefault();
    if (cmdk.open) cmdk.close(); else if (!document.querySelector("dialog[open]")) openCmdk();
  }
});


// ---------- glass dropdowns
// The open list of a native <select> is drawn by the OS and can't be styled, so on mouse/trackpad
// devices each select gets a button + menu. The hidden native select stays the source of truth:
// forms, change listeners and code that sets .value keep working, and the button follows it.
// Touch devices keep the native picker.
const DD_FINE = matchMedia("(hover: hover) and (pointer: fine)");
const DD_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const DD_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';
const ddMenu = document.createElement("div");
ddMenu.className = "dd-menu"; ddMenu.setAttribute("role", "listbox"); ddMenu.id = "ddMenu";
if ("popover" in HTMLElement.prototype) ddMenu.popover = "manual"; // top layer: above dialogs, never clipped
let dd = null; // { sel, btn, act }
let ddType = "", ddTypeT;

function ddLabelFor(sel) {
  if (sel.getAttribute("aria-label")) return sel.getAttribute("aria-label");
  const l = sel.closest("label");
  return l ? l.textContent.replace(ddText(sel), "").trim() : "";
}
const ddText = sel => sel.selectedOptions[0]?.textContent ?? "";
function ddSync(sel) {
  const b = sel._dd; if (!b) return;
  if (!sel.classList.contains("dd-native")) sel.classList.add("dd-native");
  const cls = [...sel.classList].filter(c => c !== "dd-native").join(" ");
  if (b.dataset.cls !== cls) { b.className = "dd " + cls; b.dataset.cls = cls; }
  b.firstChild.textContent = ddText(sel) || " ";
  b.disabled = sel.disabled; b.hidden = sel.hidden;
  if (sel.style.cssText !== b.dataset.css) { b.style.cssText = sel.style.cssText; b.dataset.css = sel.style.cssText; }
  if (dd?.sel === sel) ddBuild();
}
function ddEnhance(sel) {
  if (sel._dd || sel.multiple || sel.hasAttribute("data-native") || !DD_FINE.matches) return;
  const b = document.createElement("button");
  b.type = "button"; b.innerHTML = `<span class="dd-t"></span>${DD_CHEV}`;
  b.setAttribute("aria-haspopup", "listbox"); b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-label", ddLabelFor(sel));
  b._sel = sel; sel._dd = b; sel.tabIndex = -1;
  sel.after(b); ddSync(sel);
}
function ddEnhanceAll(root = document) { $$("select", root).forEach(ddEnhance); }

function ddBuild() {
  const { sel } = dd, dots = sel.classList.contains("status-select") || ["fStatus"].includes(sel.id) || sel.dataset.bulkField === "status";
  ddMenu.innerHTML = [...sel.options].map((o, i) => `<div class="dd-opt${i === dd.act ? " act" : ""}" role="option" id="ddo${i}" data-i="${i}"
      aria-selected="${o.selected}" ${o.disabled ? 'aria-disabled="true"' : ""}>
      <span class="ck">${o.selected ? DD_CHECK : ""}</span>${dots && o.value ? `<span class="dot s-${esc(o.value)}"></span>` : ""}<span class="tx">${esc(o.textContent)}</span></div>`).join("");
  dd.btn.setAttribute("aria-activedescendant", "ddo" + dd.act);
}
function ddPlace() {
  const r = dd.btn.getBoundingClientRect(), vh = innerHeight, vw = innerWidth;
  ddMenu.style.minWidth = Math.max(r.width, 180) + "px";
  ddMenu.style.maxHeight = "";
  const mh = Math.min(ddMenu.scrollHeight + 2, 340), below = vh - r.bottom - 12, above = r.top - 12;
  const up = mh > below && above > below;
  ddMenu.style.maxHeight = Math.min(mh, up ? above : below) + "px";
  ddMenu.style.top = (up ? r.top - 6 - Math.min(mh, above) : r.bottom + 6) + "px";
  const w = ddMenu.offsetWidth;
  ddMenu.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
}
function ddOpen(btn) {
  if (dd) ddClose();
  const sel = btn._sel;
  dd = { sel, btn, act: Math.max(0, sel.selectedIndex) };
  (btn.closest("dialog") || document.body).appendChild(ddMenu);
  ddBuild();
  ddMenu.popover ? ddMenu.showPopover() : (ddMenu.style.display = "block");
  ddMenu.classList.add("show");
  btn.setAttribute("aria-expanded", "true"); btn.setAttribute("aria-controls", "ddMenu");
  ddPlace();
  $("#ddo" + dd.act)?.scrollIntoView({ block: "nearest" });
}
function ddClose(focus = false) {
  if (!dd) return;
  const { btn } = dd; dd = null;
  ddMenu.classList.remove("show");
  if (ddMenu.popover) { try { ddMenu.hidePopover(); } catch {} } else ddMenu.style.display = "";
  btn.setAttribute("aria-expanded", "false"); btn.removeAttribute("aria-activedescendant");
  if (focus) btn.focus();
}
function ddPick(i) {
  const { sel } = dd, o = sel.options[i];
  if (!o || o.disabled) return;
  const changed = sel.selectedIndex !== i;
  ddClose(true);
  if (!changed) return;
  sel.selectedIndex = i; ddSync(sel);
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}
function ddMove(to) {
  const n = dd.sel.options.length; if (!n) return;
  let i = Math.max(0, Math.min(n - 1, to)), guard = n;
  while (dd.sel.options[i]?.disabled && guard--) i = (i + (to >= dd.act ? 1 : -1) + n) % n;
  dd.act = i;
  $$(".dd-opt", ddMenu).forEach((el, j) => el.classList.toggle("act", j === i));
  dd.btn.setAttribute("aria-activedescendant", "ddo" + i);
  $("#ddo" + i)?.scrollIntoView({ block: "nearest" });
}

document.addEventListener("click", e => {
  const b = e.target.closest?.("button.dd");
  if (b) { e.preventDefault(); e.stopPropagation(); return dd?.btn === b ? ddClose() : ddOpen(b); }
  const o = e.target.closest?.(".dd-opt");
  if (o && dd) { e.stopPropagation(); return ddPick(+o.dataset.i); }
}, true);
document.addEventListener("pointerdown", e => { if (dd && !e.target.closest?.(".dd-menu, button.dd")) ddClose(); }, true);
ddMenu.addEventListener("pointermove", e => { const o = e.target.closest(".dd-opt"); if (o && +o.dataset.i !== dd?.act) ddMove(+o.dataset.i); });
addEventListener("resize", () => ddClose());
document.addEventListener("scroll", e => { if (dd && !ddMenu.contains(e.target)) ddClose(); }, true);
document.addEventListener("keydown", e => {
  const b = e.target.closest?.("button.dd");
  if (!dd) {
    if (b && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); ddOpen(b); }
    return;
  }
  const k = e.key, page = 8;
  const keys = { ArrowDown: () => ddMove(dd.act + 1), ArrowUp: () => ddMove(dd.act - 1), Home: () => ddMove(0), End: () => ddMove(dd.sel.options.length - 1),
    PageDown: () => ddMove(dd.act + page), PageUp: () => ddMove(dd.act - page), Enter: () => ddPick(dd.act), " ": () => ddPick(dd.act), Escape: () => ddClose(true), Tab: () => ddClose() };
  if (keys[k]) {
    if (k !== "Tab") { e.preventDefault(); e.stopPropagation(); } // Esc closes the menu, not the dialog
    return keys[k]();
  }
  if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { // type to jump
    e.preventDefault(); e.stopPropagation();
    ddType += k.toLowerCase(); clearTimeout(ddTypeT); ddTypeT = setTimeout(() => ddType = "", 600);
    const opts = [...dd.sel.options], n = opts.length;
    for (let s = 1; s <= n; s++) { const i = (dd.act + (ddType.length > 1 ? 0 : s)) % n; if (opts[i].textContent.trim().toLowerCase().startsWith(ddType)) return ddMove(i); }
  }
}, true);
// Esc on an open menu inside a dialog must not close the dialog
document.addEventListener("cancel", e => { if (dd) { e.preventDefault(); ddClose(true); } }, true);

// Follow the native select when code changes it
for (const prop of ["value", "selectedIndex"]) {
  const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
  Object.defineProperty(HTMLSelectElement.prototype, prop, { configurable: true, enumerable: d.enumerable,
    get() { return d.get.call(this); }, set(v) { d.set.call(this, v); if (this._dd) ddSync(this); } });
}
document.addEventListener("reset", e => setTimeout(() => $$("select", e.target).forEach(ddSync)), true);
document.addEventListener("change", e => { if (e.target._dd) ddSync(e.target); }, true);
new MutationObserver(muts => {
  const touched = new Set();
  for (const m of muts) {
    if (m.type === "attributes") { if (m.target.tagName === "SELECT") touched.add(m.target); continue; }
    const host = m.target.closest?.("select"); if (host) { touched.add(host); continue; }
    m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.tagName === "SELECT") ddEnhance(n); else if (n.querySelector?.("select")) ddEnhanceAll(n); });
    m.removedNodes.forEach(n => { if (n === ddMenu || !dd) return; if (n.nodeType === 1 && (n === dd.sel || n.contains?.(dd.sel))) ddClose(); });
  }
  touched.forEach(sel => sel._dd ? ddSync(sel) : ddEnhance(sel));
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden", "disabled", "style"] });
ddEnhanceAll();

// ---------- wiring
mountEditors(document);
fillSelect($("#noteKind"), ["progress", "decision", "blocker", "info", "handoff"]);
$$("[data-close]").forEach(b => b.onclick = () => b.closest("dialog") === itemDlg ? closeItem() : b.closest("dialog").close());
$$("dialog").forEach(d => d.addEventListener("mousedown", e => { if (e.target === d) d === itemDlg ? closeItem() : d.id !== "confirmDlg" && d.close(); }));
$("#nav").onclick = e => { const v = e.target.closest("[data-view]")?.dataset.view; if (v) { state.view = v; render(); } };
const projectFilter = $("#projectFilter");
projectFilter.onchange = () => { state.selected.clear(); render(); };
$("#newItem").onclick = () => openItem(null);
$("#tSearch").onclick = () => openCmdk();
$("#tTheme").onclick = () => { look.theme = isDark() ? "light" : "dark"; applyLook(); if (state.view === "settings") render(); };
// ---------- bell: what's waiting on you, in a menu under the button
const bell = $("#tBell"), bellMenu = document.createElement("div");
bellMenu.className = "dd-menu bell-menu"; bellMenu.id = "bellMenu"; bellMenu.setAttribute("role", "menu"); bellMenu.setAttribute("aria-label", "Waiting on you");
if ("popover" in HTMLElement.prototype) bellMenu.popover = "manual";
document.body.appendChild(bellMenu);
bell.setAttribute("aria-haspopup", "menu"); bell.setAttribute("aria-expanded", "false"); bell.setAttribute("aria-controls", "bellMenu");
const bellOpen = () => bell.getAttribute("aria-expanded") === "true";
function bellRow(it) {
  const when = it.due_on ? `<span class="${it.due_on < todayISO() ? "late" : ""}">${it.due_on === todayISO() ? "today" : rel(it.due_on)}</span>` : "";
  return `<button type="button" class="dd-opt bell-row" role="menuitem" data-open="${it.id}">
    <span class="tx"><b>${esc(it.title)}</b><span class="sub">${pchip(it.project)}${when}${holdTag(it)}</span></span></button>`;
}
async function showBell() {
  bellMenu.innerHTML = `<div class="bell-h">Waiting on you</div><div class="empty">Loading…</div>`;
  bellMenu.popover ? bellMenu.showPopover() : bellMenu.classList.add("show");
  bell.setAttribute("aria-expanded", "true"); placeBell();
  try {
    const a = await api("/api/agenda?days=7" + (projectFilter.value ? "&project=" + encodeURIComponent(projectFilter.value) : ""));
    const mine = [...a.waiting_on_me].sort((x, y) => (x.due_on || "9999").localeCompare(y.due_on || "9999") || PRIO(x) - PRIO(y));
    bellMenu.innerHTML = `<div class="bell-h">Waiting on you <b>${mine.length}</b></div>`
      + (mine.slice(0, 12).map(bellRow).join("") || `<div class="empty">Nothing waiting on you.</div>`)
      + `<button type="button" class="dd-opt bell-all" role="menuitem" data-home>${mine.length > 12 ? `See all ${mine.length} on Home` : "Open Home"}</button>`;
  } catch (err) { bellMenu.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  if (bellOpen()) placeBell();
}
function placeBell() {
  const r = bell.getBoundingClientRect(), w = Math.min(380, innerWidth - 16);
  bellMenu.style.width = w + "px";
  bellMenu.style.maxHeight = Math.max(200, innerHeight - r.bottom - 16) + "px";
  bellMenu.style.top = r.bottom + 6 + "px";
  bellMenu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
}
function hideBell(focus = false) {
  if (!bellOpen()) return;
  bellMenu.popover ? (() => { try { bellMenu.hidePopover(); } catch {} })() : bellMenu.classList.remove("show");
  bell.setAttribute("aria-expanded", "false");
  if (focus) bell.focus();
}
bell.onclick = () => bellOpen() ? hideBell() : showBell();
bellMenu.addEventListener("click", e => {
  const row = e.target.closest("[data-open]");
  if (row) { hideBell(); return openItem(+row.dataset.open); }
  if (e.target.closest("[data-home]")) { hideBell(); state.view = "home"; render(); }
});
document.addEventListener("pointerdown", e => { if (bellOpen() && !e.target.closest?.("#bellMenu, #tBell")) hideBell(); }, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && bellOpen()) { e.preventDefault(); hideBell(true); } }, true);
addEventListener("resize", () => hideBell());
island.addEventListener("click", e => {
  const b = e.target.closest("[data-focus]"); if (b) { e.stopPropagation(); return focusAction(b.dataset.focus); }
  if (focusS && !island.classList.contains("toasting")) island.classList.toggle("open");
});
document.addEventListener("click", e => { if (!e.target.closest("#island")) island.classList.remove("open"); });
function goSearch() {
  const focusIt = () => $("#fSearch")?.focus();
  if (state.view !== "tasks") { state.view = "tasks"; render().then(focusIt); } else focusIt();
}

$("#view").addEventListener("click", async e => {
  const t = e.target;
  if (t.matches("input[type=checkbox][data-done], input[type=checkbox][data-milestone]")) return; // handled on change
  if (t.matches("input[data-sel], #selAll") || t.closest("td.cb")) {
    if (t.closest("td.cb") && !t.matches("input")) { const cb = $("input", t.closest("td.cb")); cb.click(); }
    return;
  }
  const hb = t.closest("[data-hold]"); if (hb) { e.stopPropagation(); return openHold(hb.dataset.hold); }
  const go = t.closest("[data-goto]"); if (go) { if (go.hasAttribute("data-mine")) state.tasks.mine = true; state.view = go.dataset.goto; return render(); }
  if (t.closest("[data-new]")) return openItem(null);
  const ln = t.closest("[data-lane-new]"); if (ln) return openItem(null, { status: ln.dataset.laneNew });
  const tm = t.closest("[data-tmode]"); if (tm) { state.tasks.mode = tm.dataset.tmode; return render(); }
  if (t.closest("[data-tmine]")) { state.tasks.mine = !state.tasks.mine; return render(); }
  const rg = t.closest("[data-range]"); if (rg) { state.ins.range = +rg.dataset.range; return render(); }
  if (t.closest("[data-csv]")) return exportCSV();
  const fm = t.closest("[data-fmin]"); if (fm) { state.fmin = +fm.dataset.fmin; $$("[data-fmin]").forEach(b => b.classList.toggle("on", b === fm)); $("#dial .t b").textContent = mmss(state.fmin * 60); return; }
  if (t.closest("[data-fstart]")) {
    const sel = $("#focusItem"), id = sel?.value;
    startFocus(state.fmin || look.focusMin, id ? { id: +id, title: sel.selectedOptions[0].textContent.replace(/^#\d+ /, "") } : null);
    return state.view === "settings" ? render() : undefined;
  }
  const fa = t.closest("[data-focus]"); if (fa) { focusAction(fa.dataset.focus); return state.view === "settings" ? render() : undefined; }
  const st = t.closest("[data-step]"); if (st) {
    const k = st.dataset.step, d = +st.dataset.d; look[k] = Math.min(+(st.dataset.max || 1e9), Math.max(+(st.dataset.min || 0), look[k] + d)); applyLook(); return render();
  }
  const sc = t.closest("[data-sect]"); if (sc) return $("#sect-" + sc.dataset.sect)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (t.closest("[data-backup-now]")) {
    try { const b = await api("/api/backups", { method: "POST" }); toast(`Backed up: ${b.counts?.items ?? ""} items`); } catch (err) { toast(err.message); }
    return render();
  }
  const rs = t.closest("[data-restore]"); if (rs) {
    const when = `${fmtDate(rs.dataset.when, { weekday: "long", day: "numeric", month: "long" })} ${rs.dataset.when.slice(11, 16)}`;
    if (!(await ask("Restore this backup?", `Everything goes back to how it was on ${when}. Changes since then are lost, but a safety backup of the current state is taken first.`, { ok: "Restore", danger: true }))) return;
    try { const r = await api(`/api/backups/${encodeURIComponent(rs.dataset.restore)}/restore`, { method: "POST" }); toast(`Restored · ${r.counts.items} items. Safety copy saved.`); await loadProjects(); }
    catch (err) { toast(err.message); }
    return render();
  }
  if (t.closest("[data-git-sync]")) {
    const b = t.closest("[data-git-sync]"); b.disabled = true; b.textContent = "Syncing…";
    try { const r = await api("/api/git/sync", { method: "POST" }); toast(`Synced ${r.items} branches${r.changed.length ? ` · ${r.changed.length} moved forward` : ""}`); await loadProjects(); }
    catch (err) { toast(err.message); }
    return render();
  }
  const rvb = t.closest("[data-rv]"); if (rvb) {
    const n = +rvb.dataset.rv, base = parseISO(state.review.day || todayISO());
    state.review.day = n === 0 ? "" : toISO(addDays(base, 7 * n));
    if (state.review.day && state.review.day >= todayISO()) state.review.day = "";
    return render();
  }
  if (t.closest("[data-rv-copy]")) return navigator.clipboard.writeText(state.reviewMd || "").then(() => toast("Summary copied as Markdown"), () => toast("Couldn't copy here; use Download .md"));
  const tu = t.closest("[data-tpl-use]"); if (tu) return useTemplate(state.templates.find(x => x.id === +tu.dataset.tplUse));
  const td = t.closest("[data-tpl-del]"); if (td) {
    if (!(await ask(`Delete the ${td.dataset.name} template?`, "Items already made from it stay as they are.", { ok: "Delete", danger: true }))) return;
    try { await api(`/api/templates/${td.dataset.tplDel}`, { method: "DELETE" }); toast("Template deleted"); } catch (err) { toast(err.message); }
    return render();
  }
  if (t.closest("[data-clear-focus]")) {
    if (!(await ask("Clear focus history?", "Deletes every logged focus session. Items, notes and their actual hours are not touched.", { ok: "Clear", danger: true }))) return;
    await api("/api/focus", { method: "DELETE" }); Object.keys(focusLog).forEach(k => delete focusLog[k]); toast("Focus history cleared"); return render();
  }
  const mp = t.closest("[data-me-proj]"); if (mp) { state.meProject = mp.dataset.meProj; state.expanded.me = false; return render(); }
  if (t.closest("[data-tl-reset]")) { state.tl = { project: "", status: "", type: "" }; return render(); }
  const nav = t.closest("[data-cal-nav]"); if (nav) {
    const c = state.cal, n = +nav.dataset.calNav, a = parseISO(c.anchor || todayISO());
    c.anchor = n === 0 ? todayISO() : toISO(c.mode === "week" ? addDays(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1));
    return render();
  }
  const wk = t.closest("[data-week]"); if (wk) { state.cal.mode = "week"; state.cal.anchor = wk.dataset.week; return render(); }
  const ex = t.closest("[data-expand]"); if (ex) { state.expanded[ex.dataset.expand] = !state.expanded[ex.dataset.expand]; return render(); }
  const bulk = t.closest("[data-bulk]"); if (bulk) return runBulk(bulk.dataset.bulk);
  const item = t.closest("[data-item]"); if (item && !t.closest("a[href^=http]")) { e.preventDefault(); return openItem(item.dataset.item); }
  const proj = t.closest("[data-proj]"); if (proj) return openProject(proj.dataset.proj);
  const fp = t.closest("[data-filter-project]"); if (fp) { projectFilter.value = fp.dataset.filterProject; state.view = "tasks"; return render(); }
  if (t.id === "addProj") openProject(null);
});
$("#view").addEventListener("keydown", e => { const c = e.target.closest("[data-proj]"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openProject(c.dataset.proj); } });
$("#view").addEventListener("change", e => {
  const t = e.target, f = state.filters;
  if (t.matches("[data-done], [data-milestone]")) return quickCheck(t);
  if (t.dataset.sel) { const id = +t.dataset.sel; t.checked ? state.selected.add(id) : state.selected.delete(id); return render(); }
  if (t.id === "selAll") { state.selected = new Set(t.checked ? state.visible : []); return render(); }
  if (t.dataset.bulkField && t.value) return runBulk("set", { [t.dataset.bulkField]: t.value });
  if (t.dataset.tl) { state.tl[t.dataset.tl] = t.value; return render(); }
  if (t.hasAttribute("data-tprio")) { state.tasks.priority = t.value; return render(); }
  if (["theme", "wall", "accent", "glass"].includes(t.name) && t.type === "radio") { look[t.name] = t.value; applyLook(); return render(); }
  if (t.dataset.look) { look[t.dataset.look] = t.checked; applyLook(); return; }
  if (t.name === "calMode") { state.cal.mode = t.value; return render(); }
  if (t.dataset.calType) { state.cal.types[t.dataset.calType] = t.checked; return render(); }
  if (t.id === "calDone") { state.cal.done = t.checked; return render(); }
  if (t.id === "fStatus") f.status = t.value;
  else if (t.id === "fAssignee") f.assignee = t.value;
  else if (t.id === "fClosed") f.closed = t.checked;
  else return;
  render();
});
function exportCSV() {
  const cols = ["id", "project", "title", "kind", "status", "assignee", "priority", "ticket_ref", "branch", "created_at", "completed_at", "due_on", "estimate_hours", "actual_hours", "cost", "currency"];
  const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(","), ...(state.csv || []).map(it => cols.map(c => q(it[c])).join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `devtrack-finished-${state.ins.range}d-${todayISO()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${(state.csv || []).length} finished items`);
}
async function runBulk(action, fields) {
  const ids = [...state.selected]; if (!ids.length) return;
  if (action === "clear") { state.selected.clear(); return render(); }
  if (action === "delete" && !(await ask(`Delete ${ids.length} item${ids.length > 1 ? "s" : ""}?`, "This can't be undone.", { ok: "Delete", danger: true }))) return;
  try {
    for (const id of ids) {
      if (action === "delete") await api(`/api/items/${id}`, { method: "DELETE" });
      else await api(`/api/items/${id}`, { method: "PATCH", body: action === "done" ? { status: "done" } : fields });
    }
    toast(`${action === "delete" ? "Deleted" : "Updated"} ${ids.length} item${ids.length > 1 ? "s" : ""}`);
    if (action === "delete" || action === "done") state.selected.clear();
  } catch (err) { toast(err.message); }
  render();
}
// calendar: drag a milestone to reschedule it
let dragEv = null, dragCard = null;
$("#view").addEventListener("dragstart", e => {
  const kc = e.target.closest?.(".kcard");
  if (kc) { dragCard = { id: +kc.dataset.item, from: kc.dataset.status }; kc.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", kc.dataset.item); return; }
  const ev = e.target.closest?.(".cal-ev"); if (!ev) return;
  dragEv = { id: +ev.dataset.item, field: ev.dataset.field, from: ev.dataset.date };
  e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(dragEv.id));
});
$("#view").addEventListener("dragover", e => {
  const lane = e.target.closest(".lane"); if (lane && dragCard) { e.preventDefault(); $$(".lane.drop").forEach(l => l !== lane && l.classList.remove("drop")); lane.classList.add("drop"); return; }
  const day = e.target.closest(".cal-day"); if (!day || !dragEv) return;
  e.preventDefault(); $$(".cal-day.drop").forEach(d => d !== day && d.classList.remove("drop")); day.classList.add("drop");
});
$("#view").addEventListener("dragleave", e => { const day = e.target.closest(".cal-day"); if (day && !day.contains(e.relatedTarget)) day.classList.remove("drop"); });
$("#view").addEventListener("dragend", () => { dragCard = null; $$(".lane.drop, .kcard.dragging").forEach(n => n.classList.remove("drop", "dragging")); dragEv = null; $$(".cal-day.drop").forEach(d => d.classList.remove("drop")); });
$("#view").addEventListener("drop", async e => {
  const lane = e.target.closest(".lane");
  if (lane && dragCard) {
    e.preventDefault(); const { id, from } = dragCard, key = lane.dataset.lane; dragCard = null;
    const sts = LANES.find(l => l[0] === key)[2];
    if (sts.includes(from)) return render();
    const to = sts.at(-1) === "deployed" ? "merged" : sts.at(-1);
    try { await setStatus(id, to, from); } catch (err) { toast(err.message); }
    return render();
  }
  const day = e.target.closest(".cal-day"); if (!day || !dragEv) return;
  e.preventDefault(); const { id, field, from } = dragEv, to = day.dataset.day; dragEv = null;
  if (to === from) return render();
  try {
    await api(`/api/items/${id}`, { method: "PATCH", body: { [field]: to } });
    toast(`#${id} ${field.replace("_on", "")} moved to ${fmtDate(to)}`, { label: "Undo", run: async () => { await api(`/api/items/${id}`, { method: "PATCH", body: { [field]: from } }); toast("Undone"); render(); } });
  } catch (err) { toast(err.message); }
  render();
});
$("#view").addEventListener("dblclick", e => {
  const day = e.target.closest(".cal-day"); if (!day || e.target.closest(".cal-ev, .cal-more")) return;
  openItem(null, { due_on: day.dataset.day });
});

let searchT;
$("#view").addEventListener("input", e => {
  if (e.target.id !== "fSearch") return;
  clearTimeout(searchT); searchT = setTimeout(async () => {
    state.filters.search = e.target.value; await render();
    const s = $("#fSearch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  }, 250);
});
$("#view").addEventListener("submit", async e => {
  if (e.target.id === "tplForm") {
    e.preventDefault(); const f = e.target;
    const steps = f.steps.value.split("\n").map(s => s.trim().replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")).filter(Boolean);
    try {
      const x = await api("/api/templates", { method: "POST", body: { name: f.name.value, kind: f.kind.value, description: steps.map(s => `- [ ] ${s}`).join("\n") || null } });
      toast(`Saved the ${x.name} template`); render();
    } catch (err) { toast(err.message); }
    return;
  }
  if (e.target.id !== "noteForm") return;
  e.preventDefault(); const f = e.target;
  if (!f.body.value.trim()) return f.body.focus();
  try { await api("/api/notes", { method: "POST", body: { project: f.project.value, kind: f.kind.value, body: f.body.value } }); toast("Note added"); render(); }
  catch (err) { toast(err.message); }
});
document.addEventListener("keydown", e => {
  if (document.querySelector("dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { if (e.key === "Escape") document.activeElement.blur(); return; }
  if (e.key === "n") { e.preventDefault(); openItem(null); }
  else if (e.key === "/") { e.preventDefault(); goSearch(); }
  else if (e.key === "f") { if (focusS) focusAction("pause"); else startFocus(); }
  else if (/^[1-9]$/.test(e.key)) { state.view = VIEWS[+e.key - 1]; render(); }
  else if (state.view === "calendar" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) $(`[data-cal-nav="${e.key === "ArrowLeft" ? -1 : 1}"]`)?.click();
  else if (state.view === "calendar" && e.key === "t") $('[data-cal-nav="0"]')?.click();
});
let resizeT, lastW = innerWidth;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40 && $(".chart")) { lastW = innerWidth; render(); } }, 250); });
setInterval(() => {
  const busy = document.querySelector("dialog[open]") || state.selected.size || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (!busy && document.visibilityState === "visible") render();
}, 30000);

(async () => {
  applyLook(); paintFocus();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => look.theme === "auto" && state.view === "settings" && render());
  state.meta = await api("/api/meta");
  await loadFocus();
  await Promise.all([loadProjects(), loadTemplates()]);
  render();
})();
