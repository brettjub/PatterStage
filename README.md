# Control Hub (Hermes)

Control Hub is a web command centre built for [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation). Hermes runs your agents on the machine; Control Hub gives you a dashboard to see what is running, dispatch missions, manage cron, browse sessions, and edit config—without living in the terminal.

![Control Hub dashboard](docs/images/dashboard.png)

**More documentation:** [Doc index](docs/README.md) · [Control Hub overview](docs/CONTROL_HUB.md) · [Missions](docs/MISSIONS.md) · [Deploy](docs/DEPLOY.md) · [Catalog & profiles](docs/CATALOG_AND_PROFILES.md)

---

## What you need

| Requirement | Notes |
|-------------|--------|
| **macOS or Linux** | Bootstrap scripts use bash. No Windows installer for Control Hub itself. |
| **Node.js 20+** | Matches [CI](.github/workflows/ci.yml). On macOS, install [Xcode Command Line Tools](https://developer.apple.com/xcode/resources/) if `npm install` fails building native modules. |
| **Hermes Agent** | [Install Hermes](https://hermes-agent.nousresearch.com/docs/getting-started/installation) first for full missions, cron, and gateway features. Control Hub can start without Hermes, but agent paths stay limited until `~/.hermes` is configured. |
| **git** | For clone-based install. |

---

## Quick start (operators)

1. **Install Hermes Agent** on the same machine (see link above). Run `hermes setup` if prompted.

2. **Get Control Hub** (installs to `~/control-hub` by default, or use an existing clone):
   ```bash
   git clone https://github.com/Daniel-Parke/hermes-control-hub.git
   cd hermes-control-hub
   bash scripts/bootstrap/install.sh --in-repo
   ```
   Fresh machine without a clone yet: `bash scripts/bootstrap/install.sh` (clones to `~/control-hub` then runs setup).

3. **Open the dashboard** at `http://127.0.0.1:<PORT>/` (PORT is written to `.env.local` during setup, usually **42069–42100**).

4. **Catalog is seeded during setup** — six professional agent profiles and mission templates land in Control Hub SQLite automatically. When `HERMES_HOME` is ready, profiles are pushed to `~/.hermes/profiles/`. You do **not** need Config → Seed on first install unless you want to restore defaults later.

5. **Optional checks:** Config → Models (API keys), Operations → Agents (running processes), Orchestration → Missions (mission board).

**Non-interactive VPS:** set `CH_INSTALL_NONINTERACTIVE=1` for install; use `INSTALL_HERMES_PROFILE_TEMPLATES=yes` only if you need the extra bash copy of missing profile files (catalog seed is the main path). Skip catalog seed with `CH_SETUP_SKIP_CATALOG_SEED=1`.

---

## Using the dashboard

**Screenshots and page-by-page guide:** [User walkthrough](docs/USER_WALKTHROUGH_GUIDE.md) (dashboard, missions, chat, cron, profiles, skills, tools, models).

| Sidebar area | What to do there |
|--------------|------------------|
| **Dashboard** | Overview: health, active missions, sync status—not the primary place to launch missions. |
| **Orchestration → Missions** | Compose, dispatch, schedule, and **cancel** missions ([details](docs/MISSIONS.md)). Cancel stops the running `hermes chat` process and any delegated subagents. |
| **Orchestration → Cron** | Agent cron jobs Hermes runs on a schedule. |
| **Orchestration → Chat** | Gateway-backed chat (separate from mission dispatch). |
| **Main → Sessions / Memory** | Browse transcripts and memory stores. |
| **Operations → Agents / Skills / Tools / Personalities** | Profile-aware agent configuration. |
| **Config → Models / HERMES.md / YAML** | Models registry, environment, Hermes `config.yaml` sections. |
| **Config → Seed** | Restore or replace the professional catalog (normally not needed after setup). |
| **Sidebar (bottom)** | **Check** compares to remote; **Update** pulls and rebuilds; **Rebuild** builds the current tree and restarts. |

---

## Where your data lives

| Location | Holds |
|----------|--------|
| **`~/.hermes`** (`HERMES_HOME`) | Hermes data: `config.yaml`, `profiles/`, cron `jobs.json`, sessions. Package: `~/.hermes/hermes-agent/`. |
| **`~/control-hub/data`** (`CH_DATA_DIR`, default) | Control Hub SQLite, missions, templates, stories—not committed to git. |

Set `CH_DATA_DIR` and `HERMES_HOME` in `.env.local` if you use non-default paths.

---

## Updating Control Hub

Use the sidebar **Check → Update → Rebuild** buttons, or on the server:

```bash
bash scripts/application/ch-deploy.sh update   # pull, build, migrate, seed catalog, restart
bash scripts/application/ch-deploy.sh rebuild  # build current tree + restart (no git pull)
```

See [docs/DEPLOY.md](docs/DEPLOY.md) for Docker, TLS, and environment variables.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| **Port already in use** | Read `PORT` in `.env.local`; run `bash scripts/bootstrap/stop.sh` or change PORT and re-run setup. |
| **Empty mission categories** | On the host: `npm run db:migrate` with the same `CH_DATA_DIR` as the server, then restart. |
| **Hermes not found / missions fail** | Install Hermes; set `HERMES_HOME` in `.env.local`; confirm `hermes` is on `PATH`. |
| **Catalog seed warning during setup** | Run `npx tsx scripts/tooling/seed-catalog.ts --merge` or use Config → Seed. |
| **Cancel did not stop agent** | See [Missions → Cancellation](docs/MISSIONS.md); check server logs. Kill targets Linux/macOS only. |
| **Optional LAN relay (`CH_SOCAT_RELAY`)** | On macOS install socat if needed: `brew install socat`. See [DEPLOY.md](docs/DEPLOY.md). |

---

## Features (summary)

| Feature | Description |
|---------|-------------|
| **Dashboard** | Live stats, health, sync overview |
| **My Hub** | Your own projects, tasks (with due dates; hand one to Hermes as a mission), GitHub repos and website uptime ([HUB.md](docs/HUB.md)) |
| **Missions** | Mission board, templates, cancel stops agent + subagents |
| **Agent profiles** | Six professional profiles + default Bob persona ([catalog](docs/CATALOG_AND_PROFILES.md)) |
| **Cron** | Hermes agent cron + optional system cron scripts |
| **Config editor** | YAML sections, HERMES.md, `.env` viewer |
| **Sessions / memory** | Transcripts; Hindsight or Holographic memory |
| **Gateway status** | On dashboard and Orchestration → Chat |
| **Logs** | Main → Logs (Hermes log tail) |
| **Story Weaver** | Rec Room interactive fiction |

---

## For developers

App URLs like `/sessions` and `/memory` live under `src/app/(main)/` — parentheses are a **route group** (organizational only; no `/main` in the path). See [CONTRIBUTING.md](docs/CONTRIBUTING.md#where-ui-lives).

**Run path:** develop and deploy with **npm** and [`scripts/application/ch-deploy.sh`](scripts/application/ch-deploy.sh). [Docker](docs/DEPLOY.md#docker) is optional on your machine; CI builds the production image to regression-test container deploy.

```bash
npm run dev              # hot reload (PORT from .env.local)
npm run build && npm test
npm run build && npm run test:e2e
```

- **Contributing & branches:** [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- **Testing & CI:** [docs/TESTING.md](docs/TESTING.md)
- **REST API:** [docs/API.md](docs/API.md)
- **Agent rules & repo tree:** [AGENTS.md](AGENTS.md)

Mission schemas: `src/lib/schema/` · regenerate JSON with `npm run generate:schema-json`.

---

## Scripts (high level)

| Script | Role |
|--------|------|
| `scripts/bootstrap/install.sh` | Clone + setup, or `--in-repo`; optional Hermes install |
| `scripts/bootstrap/setup.sh` | `.env.local`, PORT, deps, build, **catalog seed** |
| `scripts/application/ch-deploy.sh` | `update` \| `restart` \| `rebuild` |
| `scripts/bootstrap/stop.sh` | Stop listeners on PORT |

Professional seeds: **`data/seed/`** · Full layout: [docs/DEPLOY.md](docs/DEPLOY.md).

---

## Repository layout (short)

| Area | Purpose |
|------|---------|
| `src/app/` | Pages and `api/` routes |
| `src/lib/` | DB, Hermes paths, repositories, sync |
| `tests/unit/` · `tests/e2e/` | Jest · Playwright |
| `docs/` | Technical documentation |
| `scripts/` | Bootstrap, deploy, tooling |

---

## License

[MIT](LICENSE)
