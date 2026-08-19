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
// What the browser cannot show you: this app's own agent runs. The job QUEUE is cloud state and the
// web UI already renders it; what lives only here is the transcript of a process on this machine.
// So this view is deliberately not a second queue board — it is the output the supervisor would
// otherwise be writing to a terminal nobody is looking at.

const typesEl = document.getElementById("types");
const logEl = document.getElementById("log");
const dotEl = document.getElementById("dot");
const statusEl = document.getElementById("status");

let selected = null;
let types = [];

function setView(view) {
  document.body.className = `view-${view}`;
  for (const t of document.querySelectorAll(".tab")) {
    t.setAttribute("aria-selected", String(t.dataset.view === view));
  }
}

async function selectType(type) {
  selected = type;
  for (const b of typesEl.children) b.setAttribute("aria-selected", String(b.dataset.type === type));
  const lines = await window.landed.agentLog(type);
  logEl.textContent = lines.join("\n");
  logEl.scrollTop = logEl.scrollHeight;
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
  // A type currently draining is outlined, so you can tell which tab is live without opening it.
  for (const b of typesEl.children) b.classList.toggle("live", running.includes(b.dataset.type));
}

async function initAgent() {
  types = await window.landed.agentTypes();
  typesEl.replaceChildren();
  for (const t of types) {
    const b = document.createElement("button");
    b.dataset.type = t;
    b.textContent = t;
    b.onclick = () => selectType(t);
    typesEl.append(b);
  }
  await selectType(types[0]);

  // Append only when the visible type is the one that spoke; other types keep buffering in main.
  window.landed.onAgentLine(({ type, line }) => {
    if (type !== selected) return;
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    logEl.textContent += (logEl.textContent ? "\n" : "") + line;
    if (atBottom) logEl.scrollTop = logEl.scrollHeight; // don't yank the view if you scrolled up
  });

  renderStatus();
  setInterval(renderStatus, 1500);
}

for (const t of document.querySelectorAll(".tab")) t.onclick = () => setView(t.dataset.view);
setView("agent");
initAgent();
