# Landed

A local-first job-search command center. It unifies the whole pipeline — discovery,
fit assessment, résumé tailoring, applications, interviews, and prep — into one
stage-aware view, and pairs with **a Claude Code agent** (working over MCP) to do the
heavy lifting: assessing job fit, tailoring résumés, and reconciling your inbox.

Everything runs on your machine. A single SQLite database is the source of truth; the
app and the agent both read and write it — the app through its UI, the agent through an
MCP server.

> Built with Next.js 16 (App Router), React 19, Tailwind 4, Drizzle ORM, and
> `better-sqlite3`. Two actors edit the data: **You** (the human, via the UI) and
> **the agent** (a Claude Code session, via MCP) — every change is attributed to one of them.

## Features

- **Unified pipeline** — one stage-aware board from discovery → fit → tailor →
  apply → interview → closed, with per-stage actions.
- **Fit assessment & résumé tailoring** — queue a posting and hand it to the agent; it
  assesses fit and tailors a résumé, versioned with a "redo with a note" flow.
- **Change log** — every edit is attributed to You or the agent and shown in a feed.
- **Interview prep** — DB-backed coding / system-design question tracking with
  per-company playbooks and attempt history.
- **Inbox reconciliation** — fold an inbox audit into the tracker (script).
- **Always-on + backed up** — optional launchd service keeps it running; a second
  agent snapshots the SQLite DB on a schedule.

## Getting started

Prerequisites: Node.js 24+ (see [.nvmrc](.nvmrc); the lockfile + native modules are built on 24) and npm.

```bash
git clone <your-fork-url> landed
cd landed
npm install
cp .env.example .env      # then edit as needed
npm run dev               # http://localhost:3000
```

The database is created on first use at `data/jobhunt.db` (gitignored) — so a fresh clone starts
with an **empty** pipeline. To see the app populated with realistic fake data (companies and
postings across every stage — discovery → fit → tailor → apply → interview → closed), no agent or
Claude subscription required:

```bash
npm run seed:demo    # fake data for demos / screenshots / UI dev — safe & idempotent, refreshes only its own rows
```

To populate the interview-prep catalog:

```bash
npm run seed:prep
```

### Configuration

Day-to-day configuration is split across two in-app pages: the **Profile** page holds your
candidate profile, leveling reference, and base résumé (the biggest drivers of fit); the
**Settings** page holds connections and a read-only view of the asset folder (path + "Open in
Finder"). Machine-level settings are environment variables in `.env` — see
[.env.example](.env.example) for the full list. The most important one is `ASSET_ROOT`:
the folder the app and the agent share for your base résumé, tailored-resume folders,
and the tailor queue. It defaults to `./asset-root` inside the repo so a fresh clone
works out of the box. (The agent playbooks are not in the asset folder — they ship in the
repo under [`instructions/`](instructions); `INSTRUCTIONS_ROOT` defaults there.)

### Make it yours

Two things ship with generic placeholder defaults that you should personalize — both are
the biggest drivers of how the app assesses fit:

- **Your search profile** — level baseline, included/excluded disciplines, locations, and the
  candidate résumé the fit/leveling playbooks judge against. Edit it on the **Profile** page
  (stored per install in the DB). The shipped defaults in [packages/core/src/db/profile.ts](packages/core/src/db/profile.ts)
  and [packages/shared/src/fitlab/seed.ts](packages/shared/src/fitlab/seed.ts) are generic, fictional placeholders — uploading a
  base résumé (.docx) auto-adopts its text as your Fit Lab profile.
- **Target companies** — the list that decides whether a newly-seen company starts in the
  "target" vs "practice" tier. It's a single starter list in
  [packages/shared/src/targets.mjs](packages/shared/src/targets.mjs) — edit it for your own search. (You can also re-tier any
  company in the UI regardless.) The leveling anchor ladder defaults to Amazon's and is
  swappable on the **Settings** page.

## How the agent fits in

Agentic work runs as a **headless Claude Code agent**, which connects to the app's MCP
server ([apps/mcp/jobhunt-server.mjs](apps/mcp/jobhunt-server.mjs)) and reads/writes the same SQLite
DB over a set of tools. The brief that tells the agent how the system works, plus one
playbook per job type, ship in the repo under [`instructions/`](instructions) — so a fresh
clone can drive the agent out of the box. [`instructions/README.md`](instructions/README.md)
is the single source of truth for the agent; it's editable both on disk and from the app's
Guides & reference view (which writes back to the tracked file).

To wire in the MCP server, add `apps/mcp/jobhunt-server.mjs` to the Claude Code runner's MCP
config (a project `.mcp.json` or `--mcp-config`); it talks to the running app at
`JOBHUNT_URL` (default `http://localhost:3000`).

## Database & backups

`data/jobhunt.db` (SQLite, WAL mode) is the single source of truth and is **not**
committed. Back it up with:

```bash
npm run backup   # writes a VACUUM INTO snapshot to data/backups, integrity-checked
```

Each snapshot is consistent and self-contained (safe to sync to cloud storage). Tune
with `BACKUP_DIR` / `BACKUP_KEEP`. To restore: stop the server, swap the file in for
`data/jobhunt.db` (clearing any `-wal`/`-shm` sidecars), and restart.

## Always-on server (optional, macOS launchd)

[scripts/serve.sh](scripts/serve.sh) runs `next dev` (hot-reload preserved) and is meant
to be supervised by a launchd agent so `localhost:3000` is always up — for the browser
and the agent. Create a LaunchAgent plist (label e.g. `com.jobhunt`) whose
`ProgramArguments` points at this repo's `scripts/serve.sh`, then:

```bash
chmod +x scripts/serve.sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jobhunt.plist
launchctl enable  gui/$(id -u)/com.jobhunt

# maintenance
launchctl kickstart -k gui/$(id -u)/com.jobhunt   # restart after pulling code
launchctl bootout      gui/$(id -u)/com.jobhunt   # stop (e.g. to run npm run dev by hand)
```

Because launchd owns port 3000, don't also run `npm run dev` by hand while it's up.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm run lint` | ESLint |
| `npm run test` | Node test runner (`tests/*.test.ts`) |
| `npm run boundary` | Enforce the workspace dependency rules (web → core → shared) |
| `npm run check` | The gate: typecheck + boundary + tests |
| `npm run seed:demo` | Populate the DB with realistic fake data (every pipeline stage) — for demos / UI dev |
| `npm run seed:prep` | Seed the interview-prep catalog |
| `npm run import:prep` | Import coding-prep progress |
| `npm run backup` | Snapshot the SQLite DB |
| `npm run diagram:arch` / `diagram:pipeline` | Regenerate the docs diagrams |

## Project structure

An npm-workspaces monorepo. The frontend and backend are separate packages that run in a single
`next dev` process — the split is about ownership and enforced dependencies, not deployment.

```
apps/
  web/         @landed/web — Next.js App Router: pages, components, hooks,
               and the /api route handlers (the only place core meets HTTP)
  mcp/         @landed/mcp — stdio MCP server exposing the app to the Claude Code agent
               (zero-dependency; a thin HTTP client over apps/web, it never opens the DB)
packages/
  core/        @landed/core — server-only backend: Drizzle schema + queries, the job
               queue, agent orchestration, on-disk paths. Node-only, never bundled to the browser.
  shared/      @landed/shared — client-safe: domain types, pure logic, formatting.
               Imported by both sides; may not touch node builtins or the DB.
data/          SQLite DB + generated agent artifacts (gitignored)
instructions/  The CoWork brief + per-job-type playbooks (tracked source)
scripts/       Seeds, imports, backups, diagram generators, the serve wrapper
docs/          Architecture & pipeline docs (some auto-generated)
tests/         Node test-runner tests, run against every workspace
```

The dependency arrows are enforced by `npm run boundary` (included in `npm run check`):
`web → core → shared`, never the reverse. See **The workspace boundary** in
[AGENTS.md](AGENTS.md) for the rules and where new code belongs.

See [docs/architecture.md](docs/architecture.md) and [docs/pipeline.md](docs/pipeline.md)
for more.

## License

[MIT](LICENSE).
