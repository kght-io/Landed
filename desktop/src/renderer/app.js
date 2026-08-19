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
