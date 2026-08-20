#!/bin/bash
# Always-on dev server for the job-hunt app, supervised by launchd. Runs `next dev`
# so hot-reload is preserved — edits show without a rebuild — and CoWork can hit
# localhost:3000 anytime. Resolves the project root relative to this script, so it
# works wherever you clone the repo.
# launchd hands us a bare PATH, and the app SPAWNS `claude` (the prep chat, the headless run route),
# so the agent binary has to be findable from here. ~/.local/bin is where the official installer puts
# it; without it every spawn dies with "spawn claude ENOENT" long after the server looked healthy.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.." || exit 1
exec npm run dev
