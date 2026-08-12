# Landed — production image. ONE container, ONE persistent volume.
#
# That shape is not incidental: `data/jobhunt.db` is SQLite (single-writer), the agent runner keeps
# `.pid` files and per-type `.jsonl` journals on disk (backend/src/agents/run-log.ts), and
# assets live on the filesystem. All three assume one instance with a durable disk. Run this on a VM
# or anything with a real volume — NOT on a platform that scales to N replicas or resets the
# filesystem between deploys, or the DB and the run journals diverge or vanish.
#
# What does NOT come along: the two routes that shell out to `osascript` (resume/open,
# prep-assets) are macOS automation and no-op here, and the Claude Code agent runs separately.

# ── build ────────────────────────────────────────────────────────────────────────────────────
# node:24 to match .nvmrc. The non-slim base carries the toolchain better-sqlite3 needs to compile
# its native addon for linux; the runtime stage below is slim.
FROM node:24 AS build
WORKDIR /app

# Manifests first so `npm ci` is cached independently of source edits. Every workspace manifest is
# needed — npm resolves the whole workspace graph before it installs anything.
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json  backend/
COPY shared/package.json   shared/
COPY mcp/package.json      mcp/
RUN npm ci

COPY . .
# `next build`. The workspace packages ship raw TypeScript (their `exports` point at src/*.ts), so
# transpilePackages compiles them in — see frontend/next.config.ts.
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# paths.ts walks up from cwd for the workspace-root package.json; set it explicitly so nothing
# depends on which directory the process happens to start in.
ENV REPO_ROOT=/app

# node_modules is copied WHOLE rather than reinstalled with --omit=dev: better-sqlite3 is listed in
# serverExternalPackages, so it is NOT bundled and must exist at runtime as the linux binary that
# was just compiled above.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/frontend     ./frontend
COPY --from=build /app/backend      ./backend
COPY --from=build /app/shared       ./shared
COPY --from=build /app/mcp          ./mcp
COPY --from=build /app/scripts      ./scripts
COPY --from=build /app/instructions ./instructions
COPY --from=build /app/package.json ./package.json

# Mount points for the two stateful trees. Created (and owned) up front so a fresh volume mounted
# over them is writable by the unprivileged user below.
RUN mkdir -p /app/data /app/asset-root && chown -R node:node /app/data /app/asset-root
VOLUME ["/app/data", "/app/asset-root"]
ENV ASSET_ROOT=/app/asset-root

USER node
EXPOSE 3000
# /api/health, not a data route: it answers "is the schema there and queryable" and nothing else, so
# a probe running every 30s forever can't fail for reasons unrelated to liveness. It returns 503 when
# unhealthy, which is what `r.ok` reads. See backend/src/db/health.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
