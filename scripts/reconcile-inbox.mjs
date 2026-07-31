// Reconcile the inbox audit into the DB.
//   node scripts/reconcile-inbox.mjs            -> dry run, prints the plan
//   node scripts/reconcile-inbox.mjs --apply    -> backs up the DB, applies, logs events
//
// Strategy (confirmed): merge, inbox supersedes covered companies; preserve tier
// and DB-only apps inbox missed; alias-map renames; flag low-confidence rows.
import D from "better-sqlite3";
import fs from "node:fs";
import { isTarget } from "@landed/shared/targets.mjs";

const APPLY = process.argv.includes("--apply");
// Path to the inbox-audit CSV. Override with INBOX_AUDIT_CSV; defaults to one in the asset root.
const CSV = process.env.INBOX_AUDIT_CSV || "data/inbox-audit.csv";
const DB_PATH = "data/jobhunt.db";
const now = new Date().toISOString();
const today = now.slice(0, 10);

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Canonical company: merge known variants, drop junk. Returns {key, name} or null to drop.
function canonical(rawName) {
  const k = norm(rawName);
  if (k === "seniorsoftwareengineer" || k === "") return null; // junk row, no company
  if (k === "peregrine" || k === "peregrinetechnologies") return { key: "peregrine", name: "Peregrine Technologies" };
  if (k === "langchain" || k === "langchainsenior") return { key: "langchain", name: "LangChain" };
  if (k === "scaleai") return { key: "scaleai", name: "Scale AI" };
  if (k === "normai") return { key: "normai", name: "Norm AI" };
  return { key: k, name: rawName.trim() };
}

const STATUS_MAP = { rejected: "rejected", no_response: "ghost", applied: "applied", interviewing: "interview" };

function parseLine(line) {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}

// --- load inbox ---
const lines = fs.readFileSync(CSV, "utf8").split(/\r?\n/).filter((l) => l.trim());
const inboxByKey = new Map();
for (const row of lines.slice(1).map(parseLine)) {
  const c = canonical(row[0]);
  if (!c) continue;
  const note = row[12] || "";
  const app = {
    role: row[1] || null, level: row[2] || null, team: row[3] || null, location: row[4] || null,
    status: STATUS_MAP[row[5]] || "applied",
    interviewed: row[6] === "yes" ? 1 : 0,
    appliedDate: row[7] || null, updatedAt: row[8] || row[7] || today,
    channel: row[9] || null, source: row[10] || null, url: row[11] || null, note: note || null,
    needsReview: /unclear if application submitted/i.test(note) ? 1 : 0,
  };
  if (!inboxByKey.has(c.key)) inboxByKey.set(c.key, { name: c.name, apps: [] });
  inboxByKey.get(c.key).apps.push(app);
}

// --- load DB ---
const db = new D(DB_PATH);
const dbCompanies = db.prepare("select id, name, tier from companies").all();
const dbApps = db.prepare("select * from applications").all();
const appsByCompanyId = new Map();
for (const a of dbApps) (appsByCompanyId.get(a.company_id) ?? appsByCompanyId.set(a.company_id, []).get(a.company_id)).push(a);

// group DB companies by canonical key (merges Scale AI / ScaleAI, Peregrine, etc.)
const dbByKey = new Map();
for (const co of dbCompanies) {
  const c = canonical(co.name);
  if (!c) { // junk company → mark for deletion
    dbByKey.set("__junk__" + co.id, { junk: true, rows: [co] });
    continue;
  }
  if (!dbByKey.has(c.key)) dbByKey.set(c.key, { name: c.name, rows: [] });
  dbByKey.get(c.key).rows.push(co);
}

// --- build plan ---
const plan = { newCompanies: [], merges: [], supersede: [], preserve: [], drops: [], flags: [] };

for (const [key, inbox] of inboxByKey) {
  const dbEntry = dbByKey.get(key);
  const dbRows = dbEntry?.rows ?? [];
  const dbAppCount = dbRows.reduce((n, r) => n + (appsByCompanyId.get(r.id)?.length ?? 0), 0);
  const tier = dbRows.some((r) => r.tier === "tier2" || r.tier === "tier1") ? "tier2"
    : dbRows.length ? "tier3"
    : isTarget(key) ? "tier2" : "tier3";
  if (!dbRows.length) plan.newCompanies.push({ key, name: inbox.name, tier, n: inbox.apps.length });
  if (dbRows.length > 1) plan.merges.push({ name: inbox.name, dups: dbRows.map((r) => r.name) });
  plan.supersede.push({ key, name: inbox.name, tier, was: dbAppCount, now: inbox.apps.length });
  for (const a of inbox.apps) if (a.needsReview) plan.flags.push({ name: inbox.name, role: a.role });
}
for (const [key, entry] of dbByKey) {
  if (entry.junk) { plan.drops.push({ name: entry.rows[0].name, reason: "junk company" }); continue; }
  if (!inboxByKey.has(key)) {
    const apps = entry.rows.flatMap((r) => appsByCompanyId.get(r.id) ?? []);
    plan.preserve.push({ name: entry.name, apps: apps.map((a) => a.status + (a.interviewed ? "*" : "")) });
  }
}

// --- report ---
const line = (s = "") => console.log(s);
line(`\n=== RECONCILE PLAN ${APPLY ? "(APPLYING)" : "(dry run)"} ===`);
line(`Inbox: ${[...inboxByKey.values()].reduce((n, c) => n + c.apps.length, 0)} apps / ${inboxByKey.size} companies`);
line(`\nNEW companies (${plan.newCompanies.length}): ${plan.newCompanies.map((c) => `${c.name}[${c.tier}]`).join(", ")}`);
line(`\nMERGE duplicate company rows (${plan.merges.length}):`);
plan.merges.forEach((m) => line(`  ${m.name}  <=  ${m.dups.join(" + ")}`));
line(`\nSUPERSEDE — replace DB apps with inbox (covered companies):`);
plan.supersede.filter((s) => s.was !== s.now).forEach((s) => line(`  ${s.name}: ${s.was} -> ${s.now} apps  [${s.tier}]`));
line(`  …and ${plan.supersede.filter((s) => s.was === s.now).length} more at same count`);
line(`\nPRESERVE — DB-only apps inbox missed (${plan.preserve.length}):`);
plan.preserve.forEach((p) => line(`  ${p.name} [${p.apps.join(",")}]`));
line(`\nDROP (${plan.drops.length}): ${plan.drops.map((d) => d.name).join(", ")}`);
line(`\nFLAG for review (${plan.flags.length}): ${plan.flags.map((f) => f.name + " / " + f.role).join("; ")}`);

const totalAfter =
  [...inboxByKey.values()].reduce((n, c) => n + c.apps.length, 0) +
  plan.preserve.reduce((n, p) => n + p.apps.length, 0);
line(`\n=> applications after: ${totalAfter} (was ${dbApps.length})`);

if (!APPLY) { line(`\nDry run only. Re-run with --apply to execute.\n`); process.exit(0); }

// --- apply ---
db.pragma("wal_checkpoint(FULL)");
const bak = `${DB_PATH}.bak-${now.replace(/[:.]/g, "-")}`;
fs.copyFileSync(DB_PATH, bak);
line(`\nbacked up DB -> ${bak}`);

const logEvent = db.prepare(
  "insert into events(ts,source,entity,entity_id,action,field,old_value,new_value,summary) values (@ts,@source,@entity,@entityId,@action,@field,@oldValue,@newValue,@summary)"
);
const ev = (o) => logEvent.run({ ts: now, source: "inbox", entity: "application", entityId: null, field: null, oldValue: null, newValue: null, summary: null, ...o });

const insApp = db.prepare(`insert into applications
  (company_id, role, level, team, location, status, channel, url, source, note,
   interviewed, needs_review, historical, applied_date, updated_at)
  values (@company_id,@role,@level,@team,@location,@status,@channel,@url,@source,@note,
   @interviewed,@needsReview,0,@appliedDate,@updatedAt)`);

const tx = db.transaction(() => {
  for (const [key, inbox] of inboxByKey) {
    const dbEntry = dbByKey.get(key);
    let rows = dbEntry?.rows ?? [];
    let tier = rows.some((r) => r.tier === "tier2" || r.tier === "tier1") ? "tier2"
      : rows.length ? "tier3" : isTarget(key) ? "tier2" : "tier3";

    // ensure a single canonical company row
    let companyId;
    if (!rows.length) {
      companyId = db.prepare("insert into companies(name,tier,created_at,updated_at) values (?,?,?,?)").run(inbox.name, tier, now, now).lastInsertRowid;
      ev({ entity: "company", entityId: companyId, action: "insert", summary: `new company ${inbox.name} [${tier}] from inbox` });
    } else {
      const primary = rows.find((r) => r.tier === "tier2" || r.tier === "tier1") ?? rows[0];
      companyId = primary.id;
      db.prepare("update companies set name=?, tier=?, updated_at=? where id=?").run(inbox.name, tier, now, companyId);
      // merge duplicate company rows into primary
      for (const dup of rows.filter((r) => r.id !== companyId)) {
        db.prepare("update applications set company_id=? where company_id=?").run(companyId, dup.id);
        db.prepare("delete from companies where id=?").run(dup.id);
        ev({ entity: "company", entityId: companyId, action: "merge", summary: `merged "${dup.name}" into "${inbox.name}"` });
      }
    }
    // supersede: delete this company's existing apps, insert inbox apps
    const removed = db.prepare("delete from applications where company_id=?").run(companyId).changes;
    if (removed) ev({ entityId: companyId, action: "delete", summary: `${inbox.name}: superseded ${removed} old row(s) with inbox data` });
    for (const a of inbox.apps) {
      const id = insApp.run({ company_id: companyId, ...a }).lastInsertRowid;
      ev({ entityId: id, action: a.needsReview ? "flag" : "insert",
        summary: `${inbox.name} — ${a.role ?? "?"} · ${a.status}${a.interviewed ? " · interviewed" : ""}${a.needsReview ? " · NEEDS REVIEW" : ""}` });
    }
  }
  // drop junk companies (DB-only, not canonical)
  for (const [, entry] of dbByKey) {
    if (entry.junk) {
      const co = entry.rows[0];
      db.prepare("delete from applications where company_id=?").run(co.id);
      db.prepare("delete from companies where id=?").run(co.id);
      ev({ entity: "company", entityId: co.id, action: "delete", summary: `dropped junk company "${co.name}"` });
    }
  }
});
tx();

const after = db.prepare("select count(*) c from applications").get().c;
const evCount = db.prepare("select count(*) c from events").get().c;
line(`\napplied. applications now: ${after}. change-log events: ${evCount}.\n`);
