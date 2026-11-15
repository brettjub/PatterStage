# Environment reference

Quick lookup for Control Hub and Hermes paths. Set values in `.env.local` (created by `scripts/bootstrap/setup.sh`) or export them before `npm run start`.

## Naming

| Name | Meaning |
|------|---------|
| Git repo clone | `hermes-control-hub` (this repository) |
| Default install directory | `~/control-hub` (bootstrap scripts) |
| npm package | `control-hub` |

## Core paths

| Variable | Default | Purpose |
|----------|---------|---------|
| `HERMES_HOME` | `~/.hermes` | Hermes data root: `config.yaml`, profiles, cron, sessions, skills. Python package at `{HERMES_HOME}/hermes-agent/`. (`AGENT_HOME` is accepted as a deprecated alias in code.) |
| `CH_DATA_DIR` / `CONTROL_HUB_DATA_DIR` | `~/control-hub/data` | Control Hub SQLite, missions JSON, templates, stories, hardware scripts |
| `CH_SCRIPTS_DIR` | `{CH_DATA_DIR}/scripts` | System cron script prefix (must match crontab entries) |
| `CH_HARDWARE_LOG_DIR` | `{CH_DATA_DIR}/logs` | Hardware cron log output |
| `PORT` | `42069` (or first free in 42069–42100 at setup) | Next.js listen port |

## Dual SQLite databases

| Location | When written | Notes |
|----------|--------------|-------|
| `{repo}/data/control-hub.db` | `npm run prebuild` (before `next build`) | Dev/CI convenience; recreated when `schema_version !== 3` |
| `{CH_DATA_DIR}/control-hub.db` | Runtime API + `npm run db:migrate` | **Production source of truth** on the host |

`ch-deploy update` runs `npm run build` (prebuild on repo DB) then `db:migrate` on `CH_DATA_DIR`. Use the same `CH_DATA_DIR` as the running server when troubleshooting.

## Install and setup

| Variable | Purpose |
|----------|---------|
| `CH_INSTALL_NONINTERACTIVE` | `1` — non-interactive bootstrap |
| `CH_SETUP_SKIP_CATALOG_SEED` | `1` — skip catalog seed during setup |
| `INSTALL_HERMES_PROFILE_TEMPLATES` | `yes` — optional bash copy of missing profile files (catalog seed is the main path) |

## Deploy API (sidebar Update / Rebuild)

| Variable | Purpose |
|----------|---------|
| `CH_ENABLE_DEPLOY_API` | `1` — allow `POST /api/update` |
| `CH_UPDATE_GIT_BRANCH` | Branch for `ch-deploy update` (default `dev`) |
| `CH_READ_ONLY` | `1` — block mutating API routes (503) |
| `CH_REQUEST_SIGNING_SECRET` | Optional HMAC for selected routes |

## LLM / gateway

| Variable | Purpose |
|----------|---------|
| `HERMES_GATEWAY_URL` | Gateway base for health probes and chat (e.g. `http://127.0.0.1:8642`) |
| `CONTROL_HUB_LLM_API` | Full chat completions URL or gateway-derived base |

## My Hub

| Variable | Purpose |
|----------|---------|
| `CH_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` | GitHub token for **My Hub → Code & Sites** (first one set wins). If none is set in Control Hub's environment, the same names are read from the active Hermes `.env`. Read-only access to contents, pull requests and actions is enough. Without a token only public repositories work, at 60 requests an hour. |

## Debug artifact (not read by the app)

After setup or `ch-deploy update`, `scripts/tooling/discover-agents.mjs` writes **`CH_DATA_DIR/hermes-detection.json`** (version 3) with `valid`, `hermesHome`, `defaultRoot`, `canonicalAgentPackage`, `legacyInstallDetected`, and related fields. Use it to verify path resolution on the host; the Next.js app does not load this file at runtime.

## Related docs

- [DEPLOY.md](DEPLOY.md) — `ch-deploy`, Docker, TLS
- [MIGRATION.md](MIGRATION.md) — data directory moves, schema v3
- [HERMES_CONFIG_INTEGRATION.md](HERMES_CONFIG_INTEGRATION.md) — Hermes + Control Hub path checklist
