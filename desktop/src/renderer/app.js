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
// The same transcript the web agents page shows, because it is the same frames: prose merged into
// paragraphs, tool calls with their results attached, and the context meter. What differs is where
// it comes from — there, an SSE tail of a log file; here, the child process this app spawned.
//
// The reduction happens in the main process (shared/agents/stream), so this file only paints. That
// keeps a closed window from losing history: the agent runs regardless, and reopening shows what
// happened while you were away.

const typesEl = document.getElementById("types");
const logEl = document.getElementById("log");
const dotEl = document.getElementById("dot");
const statusEl = document.getElementById("status");

let selected = null;

function setView(view) {
  document.body.className = `view-${view}`;
  for (const t of document.querySelectorAll(".tab")) {
    t.setAttribute("aria-selected", String(t.dataset.view === view));
  }
}

const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

// Tool inputs are arbitrary JSON. One line, clipped — the argument that matters (a slug, a type) is
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

  // Tool call: name, a clipped input, and the result state once it arrives. Pending calls show a
  // dim marker rather than nothing, so a hung tool is visible instead of looking like silence.
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

function renderTranscript(t) {
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60;
  logEl.replaceChildren(...t.entries.map(renderEntry));

  if (t.contextTokens || t.costUsd != null) {
    const meta = document.createElement("div");
    meta.className = "run-meta";
    const bits = [];
    if (t.model) bits.push(t.model);
    if (t.contextTokens) bits.push(`${fmtTokens(t.contextTokens)} ctx`);
    if (t.turns) bits.push(`${t.turns} turns`);
    if (t.costUsd != null) bits.push(`$${t.costUsd.toFixed(2)}`);
    meta.textContent = bits.join(" · ");
    logEl.append(meta);
  }

  if (atBottom) logEl.scrollTop = logEl.scrollHeight; // don't yank the view if you scrolled up
}

async function selectType(type) {
  selected = type;
  for (const b of typesEl.children) b.setAttribute("aria-selected", String(b.dataset.type === type));
  renderTranscript(await window.landed.agentTranscript(type));
}

async function renderStatus() {
  const s = await window.landed.agentStatus();
  const running = s.running ?? [];
  dotEl.className = `dot ${running.length ? "live" : s.lastError ? "error" : ""}`;
  statusEl.textContent = s.stopped
    ? "Not draining"
    : running.length
      ? `Running ${running.join(", ")}`
      : s.lastError
        ? `Can't reach ${s.origin}`
        : "Watching for work";
  for (const b of typesEl.children) b.classList.toggle("live", running.includes(b.dataset.type));
}

async function initAgent() {
  const types = await window.landed.agentTypes();
  typesEl.replaceChildren();
  for (const t of types) {
    const b = document.createElement("button");
    b.dataset.type = t;
    b.textContent = t;
    b.onclick = () => selectType(t);
    typesEl.append(b);
  }
  await selectType(types[0]);

  // Main sends the whole folded transcript, so a repaint cannot disagree with it.
  window.landed.onAgentFrame(({ type, transcript }) => {
    if (type === selected) renderTranscript(transcript);
  });

  renderStatus();
  setInterval(renderStatus, 1500);
}

for (const t of document.querySelectorAll(".tab")) t.onclick = () => setView(t.dataset.view);
setView("agent");
initAgent();
