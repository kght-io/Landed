# Contributing to Landed

Thanks for your interest. Landed is a local-first job-search command center that pairs a
Next.js app with a Claude Code agent working over MCP. This guide covers how to get set up,
how we build (the verification loop), and what a good PR looks like.

## What you can run without an agent

Most of the app — the pipeline board, the change feed, prep tracking, profile/settings — runs
as a plain Next.js app against a local SQLite DB. **You do not need a Claude subscription, an
MCP setup, or Gmail credentials to contribute to the UI, the data layer, or the job queue.**

The agent-driven features (fit assessment, résumé tailoring, inbox reconciliation) route all
LLM work through a Claude Code / CoWork job queue over MCP — there is no API key and the app
never calls a model provider directly. Those paths need the agent wired in (see the
[README](README.md#how-the-agent-fits-in)); everything else does not.

## Setup

Prerequisites: Node.js 24+ (see [.nvmrc](.nvmrc)) and npm.

```bash
git clone <your-fork-url> landed
cd landed
npm install
cp .env.example .env      # defaults work out of the box; edit only what you need
npm run dev               # http://localhost:3000
npm run seed:prep         # optional: populate the interview-prep catalog
```

The database is created on first use at `data/jobhunt.db` (gitignored). The shipped defaults
in the profile and target-company lists are illustrative placeholders — see
[README → Make it yours](README.md#make-it-yours).

## How we build — the verification loop

Features are built against an automated feedback signal, not by eyeballing. The signal is:

```bash
npm run check      # typecheck (tsc --noEmit) + the full test suite — must be green
```

The loop for any behavior change:

1. **Target → test first.** Encode the goal as a test in `tests/*.test.ts` (`node:test` +
   `node:assert/strict`). Run it and confirm it fails *for the right reason* before writing
   the fix.
2. **Build the minimum** to make it pass — no opportunistic refactors (that's scope creep).
3. **Run `npm run check`** — the whole suite, to catch regressions elsewhere.
4. **Self-correct until green.** Don't open a PR on a red or unrun signal.

Tests are pure and fast: pure logic (`shared/src/util/coerce.ts`, `config/leveling.ts`, `util/linediff.ts`)
and the job queue (`backend/src/jobs/`) are all directly testable without a live agent — that's most
of the surface area worth a contribution.

`npm run lint` runs as an advisory signal. There's a pre-existing `react-hooks` backlog it
flags — help burn it down, but don't add to it.

## Conventions

- **This is not the Next.js you may know.** The repo pins a version with breaking changes from
  older releases. Read the relevant guide in `node_modules/next/dist/docs/` before writing app
  or routing code, and heed deprecation notices.
- **Coerce untyped boundaries.** Agent/JSON results arrive as `unknown`. Run them through
  [shared/src/util/coerce.ts](shared/src/util/coerce.ts) (`num` never returns `NaN`; `str` maps empty → `undefined`).
  Don't hand-roll `Number(x)` on agent input.
- **Keep the agent brief in sync.** [instructions/README.md](instructions/README.md) is the
  single source of truth that briefs the agent on how the system works — it's consumed by a
  live agent, not just humans. If your change touches MCP tools
  ([mcp/jobhunt-server.mjs](mcp/jobhunt-server.mjs)), job types/playbooks, the asset layout, or
  the run flow, update `instructions/README.md` in the *same* PR. Don't spin up a second doc.
- **One SQLite DB is the source of truth**, edited by two actors — You (human, via the UI) and
  the agent (via MCP) — and every change is attributed to one of them. Preserve attribution
  when you touch write paths.

## Opening a PR

1. Branch off `main`.
2. Make `npm run check` green locally.
3. Fill in the [PR template](.github/pull_request_template.md): **intent**, **scope** (what you
   deliberately did *not* touch), and the green-`check` evidence. PRs are reviewed for
   intent-match and scope creep, so a drive-by refactor bundled into a feature PR will get
   flagged — split it out.
4. Keep PRs focused. One intent per PR.

## Reporting bugs & proposing features

Open an issue with:
- **Bugs** — what you expected, what happened, and the smallest repro. A failing test in
  `tests/` is the gold standard.
- **Features** — the problem you're trying to solve before the solution. Because the app is
  local-first and agent-paired, features that assume a hosted backend or a direct model-API key
  are out of scope by design.

## Security & privacy

Landed is local-first and holds personal data (your inbox, résumé, application history) in a
local SQLite DB that is **never** committed. If you find a vulnerability, please open a private
report rather than a public issue. Never commit real credentials, a populated `data/` dir, or
personal résumé/profile assets — `.gitignore` is set up to keep those out; keep it that way.
