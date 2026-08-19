// The folder browser. Deliberately plain — no framework, no build step: this view is small and
// changes rarely, and a bundler here would be more machinery than the feature is worth.
//
// Every path handed to the main process is RELATIVE to the chosen folder. The renderer never sees
// or sends an absolute path, so a bug here cannot widen what the app can reach; browse.ts is what
// enforces that, and this file simply has no vocabulary for asking a wider question.

const listEl = document.getElementById("list");
const crumbsEl = document.getElementById("crumbs");

let cwd = ""; // relative to the root; "" is the root itself

const fmtBytes = (n) => {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};

const join = (a, b) => (a ? `${a}/${b}` : b);

function renderCrumbs() {
  const parts = cwd ? cwd.split("/") : [];
  crumbsEl.replaceChildren();
  const add = (label, rel) => {
    const b = document.createElement("button");
    b.className = "crumb";
    b.textContent = label;
    b.onclick = () => go(rel);
    crumbsEl.append(b);
  };
  add("Home", "");
  parts.forEach((p, i) => {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "/";
    crumbsEl.append(sep);
    add(p, parts.slice(0, i + 1).join("/"));
  });
}

async function go(rel) {
  cwd = rel;
  renderCrumbs();
  const entries = await window.landed.list(cwd);
  listEl.replaceChildren();

  if (entries.length === 0) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = cwd ? "This folder is empty." : "Nothing here yet — the agent writes résumés and prep material into this folder.";
    listEl.append(p);
    return;
  }

  for (const e of entries) {
    const li = document.createElement("li");
    li.className = e.dir ? "dir" : "file";

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = e.dir ? "▸" : "·";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = e.name;

    const size = document.createElement("span");
    size.className = "size";
    size.textContent = fmtBytes(e.bytes);

    const rev = document.createElement("button");
    rev.className = "ghost rev";
    rev.textContent = "Reveal";
    rev.title = "Show in Finder";
    rev.onclick = (ev) => {
      ev.stopPropagation(); // a click on Reveal is not a click on the row
      window.landed.reveal(join(cwd, e.name));
    };

    li.append(icon, name, size, rev);
    // Folders navigate in place; files open in whatever the OS thinks owns them — a .docx should
    // land in Word, not in a viewer we would have to write and keep correct.
    li.onclick = () => (e.dir ? go(join(cwd, e.name)) : window.landed.open(join(cwd, e.name)));
    listEl.append(li);
  }
}

document.getElementById("open-browser").onclick = () => window.landed.openInBrowser();
document.getElementById("reveal-root").onclick = () => window.landed.reveal("");

window.landed.root().then((r) => {
  document.getElementById("root").textContent = r;
});
go("");

// ─── Agent view ──────────────────────────────────────────────────────────────
//
// The web agents page's layout, with the same frames behind it: one card per agent, persona name,
// backlog badge, context meter, and the transcript inside. Two things are deliberately absent —
// the Auto/Paused toggle and the "Work queue" button — because this app has no manual mode. The
// supervisor drains whatever appears; a button offering to do what already happens would be a lie.

const agentEl = document.getElementById("agent");
const dotEl = document.getElementById("dot");
const statusEl = document.getElementById("status");

const cards = new Map(); // type → { root, log, badge, meter, spinner }
let open = null; // only one card expanded at a time — five transcripts at once is a wall

function setView(view) {
  document.body.className = `view-${view}`;
  for (const t of document.querySelectorAll(".tab")) {
    t.setAttribute("aria-selected", String(t.dataset.view === view));
  }
}

const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

// Tool inputs are arbitrary JSON. One clipped line — the argument that matters (a slug, a type) is
// almost always near the front, and a pretty-printed blob buries the next line of prose.
function summarizeInput(input) {
  if (input == null) return "";
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function renderEntry(e) {
  const el = document.createElement("div");
  el.className = `entry ${e.role}`;

  if (e.role === "assistant") {
    el.textContent = e.text;
    return el;
  }
  if (e.role === "note") {
    el.classList.toggle("error", !!e.error);
    el.textContent = e.text;
    return el;
  }

  // Tool call: name, clipped input, and the result once it lands. A pending call shows a dim marker
  // rather than nothing, so a hung tool looks different from silence.
  const head = document.createElement("div");
  head.className = "tool-head";
  const dot = document.createElement("span");
  dot.className = `tool-dot ${e.result ? (e.result.ok ? "ok" : "bad") : "pending"}`;
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = e.name;
  const args = document.createElement("span");
  args.className = "tool-args";
  args.textContent = summarizeInput(e.input);
  head.append(dot, name, args);
  el.append(head);

  if (e.result?.preview) {
    const res = document.createElement("div");
    res.className = "tool-result";
    res.textContent = e.result.preview;
    el.append(res);
  }
  return el;
}

// The context window a run is filling. Approximate on purpose — the exact ceiling varies by model,
// and what matters is the shape of the curve, not the denominator.
const CONTEXT_CEILING = 200_000;

function paint(type, transcript) {
  const card = cards.get(type);
  if (!card) return;

  const atBottom = card.log.scrollHeight - card.log.scrollTop - card.log.clientHeight < 60;
  card.log.replaceChildren(...transcript.entries.map(renderEntry));

  if (transcript.contextTokens || transcript.costUsd != null) {
    const meta = document.createElement("div");
    meta.className = "run-meta";
    const bits = [];
    if (transcript.model) bits.push(transcript.model);
    if (transcript.contextTokens) bits.push(`${fmtTokens(transcript.contextTokens)} ctx`);
    if (transcript.turns) bits.push(`${transcript.turns} turns`);
    if (transcript.costUsd != null) bits.push(`$${transcript.costUsd.toFixed(2)}`);
    meta.textContent = bits.join(" · ");
    card.log.append(meta);
  }
  if (atBottom) card.log.scrollTop = card.log.scrollHeight;

  const pct = Math.min(1, (transcript.contextTokens ?? 0) / CONTEXT_CEILING);
  card.meter.style.display = transcript.contextTokens ? "" : "none";
  card.meter.className = `meter ${pct > 0.85 ? "hot" : pct > 0.6 ? "warn" : ""}`;
  card.meter.firstChild.style.width = `${Math.round(pct * 100)}%`;
  card.meter.title = transcript.contextTokens ? `${fmtTokens(transcript.contextTokens)} context tokens` : "";
}

function buildCard({ type, persona }) {
  const root = document.createElement("div");
  root.className = "card";

  const head = document.createElement("div");
  head.className = "card-head";

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = persona.slice(0, 1);

  const who = document.createElement("div");
  who.className = "who";
  const personaEl = document.createElement("div");
  personaEl.className = "persona";
  personaEl.textContent = persona;
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.style.display = "none";
  personaEl.append(spinner);
  const jobtype = document.createElement("div");
  jobtype.className = "jobtype";
  jobtype.textContent = type;
  who.append(personaEl, jobtype);

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.display = "none";

  const meter = document.createElement("span");
  meter.className = "meter";
  meter.style.display = "none";
  meter.append(document.createElement("i"));

  const chev = document.createElement("span");
  chev.className = "chev";
  chev.textContent = "▸";

  head.append(avatar, who, badge, meter, chev);

  const body = document.createElement("div");
  body.className = "card-body";
  const log = document.createElement("div");
  log.className = "log";
  body.append(log);

  head.onclick = async () => {
    if (open === type) {
      root.classList.remove("open");
      open = null;
      return;
    }
    for (const c of cards.values()) c.root.classList.remove("open");
    root.classList.add("open");
    open = type;
    paint(type, await window.landed.agentTranscript(type));
  };

  root.append(head, body);
  cards.set(type, { root, log, badge, meter, spinner });
  return root;
}

async function renderStatus() {
  const [s, counts] = await Promise.all([window.landed.agentStatus(), window.landed.queueCounts()]);
  const running = s.running ?? [];

  dotEl.className = `dot ${running.length ? "live" : s.lastError ? "error" : ""}`;
  statusEl.textContent = s.stopped
    ? "Not draining"
    : running.length
      ? `Running ${running.join(", ")}`
      : s.lastError
        ? `Can't reach ${s.origin}`
        : "Watching for work";

  for (const [type, card] of cards) {
    card.spinner.style.display = running.includes(type) ? "" : "none";
    const n = counts[type] ?? 0;
    card.badge.style.display = n ? "" : "none";
    card.badge.textContent = `${n} queued`;
  }
}

async function initAgent() {
  const types = await window.landed.agentTypes();
  agentEl.replaceChildren(...types.map(buildCard));

  // Main sends the whole folded transcript, so a repaint cannot disagree with it. Only the open
  // card paints; the rest keep accumulating in main and are current whenever you expand them.
  window.landed.onAgentFrame(({ type, transcript }) => {
    if (type === open) paint(type, transcript);
  });

  renderStatus();
  setInterval(renderStatus, 1500);
}

for (const t of document.querySelectorAll(".tab")) t.onclick = () => setView(t.dataset.view);
setView("agent");
initAgent();
