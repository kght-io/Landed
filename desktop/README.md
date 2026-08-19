# Landed desktop

The Electron app. It exists for one thing nothing else can do: **drain the job queue while nobody
is watching.** A connector inside another client can notice queued work but cannot start a model
turn on its own — every turn is anchored to a person in a session. Only a process the user installed
can tailor a résumé at 3am.

Everything else it does follows from that: it spawns the agent, so it owns the transcript; it runs
on the user's machine, so it owns their files.

```
npm run desktop          # build + run
npm run desktop:dev      # same, with esbuild watching (renderer reloads; main needs a relaunch)
npm run desktop:package  # unsigned DMG → desktop/release/
```

## What it is made of

| | |
| --- | --- |
| `src/main.ts` | window, tray, deep links, IPC, the fetch proxy |
| `src/supervisor.ts` | the drain loop — long-poll, spawn, never twice per type, outlive a crash |
| `src/agent.ts` | spawning `claude` scoped to the user's folder, and the MCP config |
| `src/mcp-local.ts` | the second MCP server: the machine's own files |
| `src/local-tools.ts` `src/docx.ts` | `readBaseResumeText`, `buildTailoredResume` |
| `src/preflight.ts` | what must be true before any of it works |
| `src/renderer/` | React. Imports the web app's `AgentsView` rather than reimplementing it |

The renderer's agent UI **is** `frontend/components/AgentsView` — a build-time alias in `build.mjs`
swaps only the chat provider, whose web version tails SSE and whose desktop version reads an IPC
transcript. See the boundary note in the repo's `AGENTS.md` for why `desktop -> frontend` is the one
allowed direction across that pair.

## Signing and notarisation

The build is **configured** for both; the credentials are not in the repo, so `npm run
desktop:package` deliberately produces an unsigned DMG (macOS quarantines it — first launch needs
right-click → Open).

To produce a distributable build you need:

1. **A "Developer ID Application" certificate** in the login keychain, from an Apple Developer
   account. `security find-identity -v -p codesigning` should list it.
2. **Three environment variables** for notarisation:
   ```
   APPLE_ID=you@example.com
   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx   # appleid.apple.com → App-Specific Passwords
   APPLE_TEAM_ID=XXXXXXXXXX                          # Membership page
   ```
3. `npm run desktop:package:signed`

**Test this first when you sign it.** The hardened runtime strips environment variables from child
processes, and both MCP servers run as `Electron <script>` with `ELECTRON_RUN_AS_NODE=1` — a
packaged app cannot assume the user has node. `build/entitlements.mac.plist` grants
`allow-dyld-environment-variables` and is applied to children via `entitlementsInherit` for exactly
this reason. If it is wrong, the app launches fine and the agent silently has no tools: the failure
looks like a bad prompt, not a signing problem.

The quick check on a signed build:

```sh
codesign -dv --entitlements - "/Applications/Landed.app"      # entitlements actually applied?
xcrun stapler validate "/Applications/Landed.app"             # notarisation stapled?
```

Then queue one job and confirm the transcript shows tool calls (`claimNext`, `submitJobResult`) —
not just prose. Tool calls are the proof the MCP servers started.

## What a user needs

Checked at launch by `preflight.ts`, which gates the app with a setup screen rather than failing
inside a transcript:

- **Claude Code**, installed and logged in — work runs on their subscription, never an API key
- **A folder**, chosen on first run; the only folder the app touches
- **The backend**, reachable
- **LibreOffice**, optional — without it tailored résumés are written as `.docx` with no PDF
