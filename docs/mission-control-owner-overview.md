# Mission Control — Owner Overview

**Route:** `/mission-control` (sidebar: Main → Mission Control). The existing dashboard at `/` is unchanged.

**Status: mostly DEMO. The page is never LIVE as a whole.**

- **Agent board.** This is the only panel that can show live data. It polls the same-origin route `GET /api/mission-control/agents`, which shows which agent processes a VPS exporter observed. The browser never contacts the VPS.
- **Owner inbox, Project radar, Deliverables & risks.** These panels show **synthetic demo data**. None of it describes a real project, person, decision or business system.
- **No action controls.** The page has no dispatch, cancel, approve, save or send controls.

> **Security: read this before running it.** See [Security posture](#security-posture-required). The Control Hub shell around this page exposes powerful **unauthenticated** API routes. Run it on localhost only, with an isolated `HERMES_HOME` and `CH_DATA_DIR`, and never expose it publicly.

## What is on the page

| Panel | Purpose | Content |
|-------|---------|---------|
| Banner + header badge | Persistent data-source notice | `DEMO · NOT CONNECTED · NOT LIVE` until the first successful agent poll. After that, `MIXED · DEMO DATA + LIVE AGENT PROCESS OBSERVATION · PAGE NOT LIVE`. |
| One-minute view | Open items, agent state counts, biggest recorded blocker, freshness count | Computed at render time. "N live sources" counts only live stamps that are still fresh. |
| Owner inbox | Decisions and approvals, oldest first; items older than 3 days are flagged | Synthetic "Example decision…" rows plus one simulated approval row |
| Agent board | **LIVE VPS AGENT PROCESS OBSERVATION**: connector status, source, checked-at, and one row per observed process | Live data when connected. Before the first successful poll there are no rows; the board shows NOT CONNECTED / unknown. |
| Project radar | Recorded state, position, blocker and next move | Synthetic "Example project …" rows, all **UNVERIFIED** with no successful check on record |
| Deliverables & risks | Evidence-shelf placeholder and risk list | Deliverables: *not connected* (empty). Risks: stale/unchecked count, "business panels are demo only", "spend unavailable (not $0)". |

### What is demo, exactly

- **Every inbox, project and deliverable/risk row is synthetic.** Names start with "Example" or "Simulated". There are no KPIs, prices, counts, schedules or connector states, and a unit test fails if fixture names stop being generic or if a currency amount is added.
- **Demo timestamps are simulated** relative to the browser clock on page load and are labelled "simulated" in every source tag.
- **Fixture agents (`Demo agent A–E`) are never shown on the page.** They remain in `demo-fixture.ts` so the pure `OwnerOverview` component (and its tests) can exercise every availability/run state. Next to a live connector, the board shows the live observation or nothing.

## Live agent process observation

### Contract (implemented server-side in this branch)

`GET /api/mission-control/agents`

- **HTTP 200:** `{ schemaVersion: 1, checkedAt: string, source: string, agents: AgentBoardEntry[] }`. Each agent has the shape `{ id, name, runtime, availability, run: null, note?, stamp: { source, kind: "live", checkedAt, staleAfterMinutes: 1 } }` (see `src/components/mission-control/types.ts`).
- **HTTP 503:** `{ error: string }` when the connector is disabled or the read failed.

### Client behaviour (`MissionControlClient.tsx`, `live-agents.ts`)

- **Polling.** Sequential `fetch` with `cache: "no-store"` every **20 s**. The next poll is scheduled only after the previous one settles. Each request has a 15 s timeout. An `AbortController` cancels the in-flight request and the timer on unmount.
- **Validation.** The response shape is checked strictly: `schemaVersion === 1`, valid ISO times, non-empty strings, a known `availability`, `run === null`, `stamp.kind === "live"`, a finite `staleAfterMinutes`, unique ids, and at most 200 agents. One malformed agent rejects the whole response, which then counts as a failed poll. A partial board could silently hide a process.
- **On success.** Only `snapshot.agents` is replaced. `snapshot.mode` becomes `"mixed"`, never `"live"`.
- **On failure (503, network error, timeout, bad JSON, invalid shape).** The previous successful observation and its `checkedAt` are kept unchanged. The board shows **CONNECTOR UNAVAILABLE (reason)** together with the age of the held observation. If no poll has ever succeeded, it shows **NOT CONNECTED** with no rows and "agent states unknown", never invented process states.
- **Clock.** The clock re-renders every 15 s regardless of poll results. With `staleAfterMinutes: 1`, held evidence shows **STALE** once it is two whole minutes old. A remote clock up to 30 s ahead of the browser counts as "just now"; anything further ahead counts as unknown.
- **Assignments are not claimed.** A process scan cannot see tasks. Live rows show run state as "Not observed — process scan cannot see assignments", never "No run assigned".

### Setup: PC (runs Control Hub) → VPS (runs agents)

The PC runs Control Hub. The route on the PC opens an SSH connection to the VPS and runs a read-only exporter script there. The browser only ever talks to the PC on localhost.

#### 1. Deploy the exporter script on the VPS

The exporter script ships at `scripts/mission-control/export-agent-snapshot.py`. The route requires a configured absolute path to the copied VPS script.

1. Copy it to the VPS as a **non-root user** at a path that user owns, such as `~/bin/export-agent-snapshot.py`. Then run `chmod 755` on it. A dedicated observer account is preferable if it has the needed process visibility; to read an existing Hermes coordinator schedule, the SSH account must have permission to read that account's `~/.hermes/cron/jobs.json` (the exporter never prints its contents).
2. Confirm that it only *reads* the process table and prints the JSON the route expects. It must not start, stop or signal processes, and must not read secrets or environment variables of other processes.
3. Run it once by hand on the VPS and inspect the output before connecting anything. The optional coordinator row appears only when the VPS exporter has `MC_COORDINATOR_JOB_ID` set locally or reads a job ID from `~/.config/mission-control/coordinator-id` (mode 0600); keep the real ID out of this public repo and the PC's environment.

#### 2. Create a dedicated SSH key on the PC and restrict it on the VPS

```bash
# On the PC (inside WSL2 if you use it — see below)
ssh-keygen -t ed25519 -f ~/.ssh/mc_observer -C "mission-control observer" -N ""
```

Add the public key to the VPS user's `~/.ssh/authorized_keys` with a **forced command**, so the key can run nothing except the exporter:

```text
restrict,command="/home/mc-observer/bin/<exporter-script>" ssh-ed25519 AAAA... mission-control observer
```

With a forced command, the VPS ignores whatever command the client sends. Keep `MC_AGENT_SSH_REMOTE_SCRIPT` equal to the same path anyway, so the configuration documents itself.

#### 3. Pin the VPS host key

The connection is non-interactive, so an unknown or changed host key must make it **fail**, not prompt or silently accept.

1. Get the fingerprint **out-of-band** from the VPS itself (provider console or an existing trusted session):
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
2. On the PC, fetch the key with `ssh-keyscan -t ed25519 <vps-host>` and compare it to that fingerprint (`ssh-keygen -lf <(ssh-keyscan -t ed25519 <vps-host> 2>/dev/null)`). Append it to `~/.ssh/known_hosts` only if the fingerprints match.
3. Use an SSH config alias with strict settings:

```text
# ~/.ssh/config on the PC
Host mc-vps
  HostName <vps-host-or-ip>
  User mc-observer
  IdentityFile ~/.ssh/mc_observer
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  BatchMode yes
  ConnectTimeout 10
```

If the VPS is rebuilt and its host key changes, polls will fail (the page shows CONNECTOR UNAVAILABLE). Re-verify the fingerprint before you replace the entry. Never set `StrictHostKeyChecking no`.

#### 4. Configure Control Hub on the PC

Add to `.env.local`. Do not hardcode a VPS host anywhere in the repo:

```bash
MC_AGENT_SSH_TARGET=mc-vps                                   # SSH alias (or user@host) from ~/.ssh/config
MC_AGENT_SSH_REMOTE_SCRIPT=/home/mc-observer/bin/export-agent-snapshot.py  # absolute path on the VPS
```

Restart the server. If either variable is unset, the route answers 503, and the page shows NOT CONNECTED. See `docs/mission-control-agent-snapshot.md` for the server-side behavior.

Check the SSH leg by hand first: `ssh mc-vps` should print the exporter's JSON and exit.

#### WSL2 on a Windows PC

- **Run everything inside the WSL2 distro.** That includes Control Hub (`npm run dev` / `next start`), the SSH key and `~/.ssh/config`. The route spawns WSL's OpenSSH, which reads WSL's `~/.ssh`, not `%USERPROFILE%\.ssh` on Windows.
- **Keep keys on the Linux filesystem**, not under `/mnt/c/...`. DrvFs does not enforce Unix permissions, and OpenSSH refuses private keys it considers too open. Use `chmod 700 ~/.ssh` and `chmod 600 ~/.ssh/mc_observer ~/.ssh/config`.
- **Browse from Windows to `http://localhost:<PORT>`.** WSL2 forwards localhost from Windows to a server bound to `127.0.0.1` inside the distro, so there is no need to bind `0.0.0.0`.
- **Watch for mirrored networking.** If WSL2 *mirrored* networking mode is enabled, a `0.0.0.0` bind inside WSL is reachable from the LAN. That is one more reason to bind `127.0.0.1`.

## Security posture (required)

This page reads data, but it lives inside the Control Hub shell. The shell's existing API routes include config writes, cron management, mission dispatch and file access, and they have **no authentication**. Anyone who can reach the port can call them. The new agents route also triggers an SSH connection to the VPS on every request.

Required for any instance that sets `MC_AGENT_SSH_TARGET`:

1. **Bind to localhost only.** Start with `next dev -H 127.0.0.1` or `next start -H 127.0.0.1`. Do **not** use `npm run dev:network`, `npm run start:network`, or the `-H 0.0.0.0` that the general deployment notes in `AGENTS.md` show. Those notes target a different, trusted-network setup.
2. **Use an isolated `HERMES_HOME` and `CH_DATA_DIR`.** Point both at scratch directories created for this instance, not at your real `~/.hermes` or production Control Hub data. That way the shell's other routes cannot read or modify real agent configuration, cron, sessions or credentials.
3. **Never expose it publicly.** No port forwarding, public reverse proxy, tunnel (ngrok, Cloudflare Tunnel, Tailscale Funnel, etc.) or cloud deployment.
4. **`CH_READ_ONLY` is not authentication.** It only makes routes that call `requireAuth()` refuse writes. It does not stop anyone from reading data, it does not cover every route, and it does not identify the caller. Set it as defence in depth, but do not rely on it.
5. **Keep the SSH key narrow:** a dedicated key, a non-root VPS user with only the needed read permissions, a forced command, `restrict`, and a pinned host key, as described above.

Owner authentication and deny-by-default writes must exist before this page, or the shell around it, is reachable by anything but the local machine.

## Display rules (enforced in `freshness.ts` / `live-agents.ts` and tested)

- **Source tags.** Every status row carries a `SourceTag` showing the source kind (`DEMO`, `NOT CONNECTED` or `LIVE`), the source name, and the freshness.
- **Bad timestamps.** If `checkedAt` is missing, unparsable or more than 30 s in the future, the row is **unknown**, never fresh.
- **Stale rows.** If the age exceeds `staleAfterMinutes`, the row shows **STALE**. On the agent board a stale heartbeat replaces the headline state with `STALE`, and the previous value moves to "last reported: …". A stale agent never shows as idle.
- **Missing data.** Missing usage shows as unavailable, never `$0`. Missing deliverables show as not connected, never "none delivered".
- **No colour-only states.** Every state is written as text with an icon.

## Accessibility and mobile

- **Layout.** Single column by default; the `sm:`/`md:` breakpoints add columns.
- **Jump nav.** `<nav aria-label="Owner overview sections">` with 44px touch targets. Each target is a `<section tabindex="-1" aria-labelledby>` with an `h2`, so it can take keyboard focus.
- **Reading order.** Summary → Owner inbox → agents → projects → deliverables & risks.
- **Tokens.** Theme tokens only (`neon-*`, `semantic-*`, `dark-*`); no raw hex values.

## Files

- `src/app/mission-control/page.tsx`: route shell (`AppPageShell` + `PageHeader`).
- `src/components/mission-control/`:
  - `types.ts`: data contract.
  - `freshness.ts`: pure freshness rules.
  - `live-agents.ts`: response validation, poll-state transitions, fetch helper and merge.
  - `demo-fixture.ts`: synthetic fixture.
  - `MissionControlClient.tsx`: polling client.
  - `OwnerOverview.tsx` and the section components.
- Tests: `tests/unit/mission-control-freshness.test.tsx`, `tests/unit/mission-control-owner-overview.test.tsx`, `tests/unit/mission-control-live-agents.test.tsx`.

## What further adapters must supply

Every panel other than the agent board still renders the synthetic fixture. Any future read-only adapter that replaces part of the fixture must follow these rules:

1. **Provenance per datum.** Each item needs a `SourceStamp`:
   - `source`: a named system.
   - `kind`: `"live"` only after a successful read.
   - `checkedAt`: the UTC time of the last *successful* read, not the last attempt.
   - `staleAfterMinutes`: matched to the source's refresh cadence.

   A failed refresh keeps the previous `checkedAt`, so the row goes stale instead of being zeroed.
2. **Agents.** Report availability separately from run state. Do not infer an assignment from a branch name or process name alone. A lost heartbeat must yield `unknown`/`interrupted`, never `succeeded` or `idle`.
3. **Inbox.** Include the exact target, impact and `createdAt`. Approval actions stay absent until an authenticated backend binds approval to the exact payload and rejects changed payloads.
4. **Projects.** Use `verification: "verified"` only when the state was read from a named source. A green CI result must not clear a release blocker.
5. **Deliverables.** Link each artifact to its task/project. Keep the empty "not connected" state until a source is configured.
6. **Mode.** Set `mode: "live"` only when every panel is backed by a live adapter. Mixed snapshots stay `mixed`, so the banner remains.
7. **Security gate first.** Owner authentication, deny-by-default writes and redaction come before any further connector. Never put secrets in a snapshot.
