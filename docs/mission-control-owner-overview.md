# Mission Control — Owner Overview

**Route:** `/mission-control` (sidebar: Main → Mission Control). The existing dashboard at `/` is unchanged.

**Status: OBSERVED DATA ONLY, partial coverage. The page shows no demo or fixture data and is never LIVE as a whole.**

The runtime page uses an explicit `observed` snapshot mode (`observed-snapshot.ts`). It is neither "demo" nor "fully live": it starts with no records and shows only what the three same-origin, read-only routes return. A live read of a manually maintained Sheet is not independent verification of the recorded business facts.

- **Agent board.** Can show live data. It polls the same-origin route `GET /api/mission-control/agents`, which shows which agent processes a VPS exporter observed. The browser never contacts the VPS.
- **Live evidence.** Can show live data. It polls the same-origin route `GET /api/mission-control/evidence` on its own loop and lists Hermes task/run records, GitHub PR state/checks and Drive file metadata per source. It is a separate section: evidence never makes an inbox item or project live. See [Live evidence section](#live-evidence-section-ui).
- **Observed artifacts.** Lists the Drive files and GitHub PRs from the same evidence observation, labelled as **observed artifacts**: not completed deliverables and not linked to any task. See [Observed artifacts shelf](#observed-artifacts-shelf).
- **Owner inbox, Project radar.** A separate, manually maintained Google Sheet supplies open decision rows and project positions through `GET /api/mission-control/register`. It starts with zero recorded open decisions and two NGM/Launchhost placeholder rows marked **unknown / UNVERIFIED**. `0 open decisions recorded in register` is shown only after a successful read; a failed read is unavailable/held/stale and cannot claim a current zero. Source-read time and owner-review time are separate. See `docs/mission-control-owner-register.md`.
- **No fabricated content.** Project status appears only as manually recorded in the Sheet, with its owner-review time or UNVERIFIED label. No approvals, costs, release gates or assignments are inferred.
- **No action controls.** The page has no dispatch, cancel, approve, save or send controls.
- **Demo fixture.** `demo-fixture.ts` remains only so the pure `OwnerOverview` component can be tested in `demo`/`mixed` mode. `MissionControlClient` and the route never import it (a unit test checks this).

> **Security: read this before running it.** See [Security posture](#security-posture-required). The Control Hub shell around this page exposes powerful **unauthenticated** API routes. Run it on localhost only, with an isolated `HERMES_HOME` and `CH_DATA_DIR`, and never expose it publicly.

## What is on the page

| Panel | Purpose | Content |
|-------|---------|---------|
| Banner + header badge | Persistent data-source notice (`SourceCoverageBanner`) | Names agent, evidence and manual owner-register read states separately. Title remains `OBSERVED DATA ONLY · PARTIAL COVERAGE …` when any source is live; a Sheet **LIVE READ** does not make project facts verified or the page fully connected. The Sheet edit link appears only after an allowlisted successful read. |
| One-minute view | Owner inbox, agent state counts, biggest recorded blocker, freshness | Inbox count is scoped to **open decisions recorded in the Sheet**, only after a successful read. If no blocker is entered, actual blockers are unknown. Freshness counts five observed sources (agents, three evidence sources, manual register); unavailable/held/stale states never count as live. |
| Owner inbox | Recorded open decisions; no approval control | On successful Sheet read, oldest open rows with exact target, impact, age, owner-review time and provenance. Empty means zero **recorded in this register**, not zero across all systems. A failed read holds the previous records with current count unknown. |
| Agent board | **LIVE VPS AGENT PROCESS OBSERVATION**: connector status, source, checked-at, and one row per observed process | Live data when connected. Before the first successful poll there are no rows; the board shows NOT CONNECTED / unknown. |
| Live evidence | Hermes / GitHub / Drive sources, each with its own LIVE, HELD, STALE, UNAVAILABLE or UNKNOWN state | Before the first successful poll every source is UNKNOWN. |
| Project radar | Manually recorded project positions | NGM and Launchhost start with unknown state and no owner review. Blank fields read "Not recorded"; status is not independently verified. A failed read holds prior rows with held/stale provenance, not a current healthy state. |
| Observed artifacts | Drive files and GitHub PRs from the evidence observation | Per-source state chip and last-success time; items keep their own source timestamps. See below. |

### Demo fixture (tests only)

- **Not used at runtime.** `/mission-control` renders `MissionControlClient`, which starts from `buildObservedSnapshot()` and never calls `buildDemoSnapshot()`. The demo banner, "Example" project rows, simulated inbox rows and demo risks therefore never appear on the page.
- **Kept for pure component tests.** `OwnerOverview` still renders a `demo` or `mixed` snapshot, so tests can exercise every availability/run state, inbox sorting and the demo labelling. Fixture names stay generic ("Example", "Simulated", "Demo agent"), and a unit test fails if a currency amount is added.

## Observed artifacts shelf

- **Source.** The Drive and GitHub sources of the same `GET /api/mission-control/evidence` observation that feeds Live evidence. No extra route, poll or contract.
- **Labelling.** "Observed artifacts — not completed deliverables, and not linked to any task, project status or approval." Drive is metadata only (direct children of the selected folder); GitHub is PR state only, and a green check is not a merge, deploy or release approval.
- **States.** Each source shows LIVE, HELD — LAST POLL FAILED, STALE, UNAVAILABLE or UNKNOWN with its last successful check:
  - **Live, 0 items:** "Source live — this bounded query returned 0 items." (expected for GitHub when there are no recent PRs).
  - **Held or stale:** previously observed items stay listed with their timestamps; never shown as LIVE, never reset to zero.
  - **Unavailable:** "could not be read. This is not zero."
  - **Unknown:** "Not connected — state unknown."
- **Links.** Only URLs that already passed `safeEvidenceUrl` at the client boundary (https, no credentials/port, allowlisted host per source) are linked, with `target="_blank" rel="noopener noreferrer"`. Others show "Link withheld".

## Owner register (UI)

- The register polls on an independent 60 s sequential loop (`cache: "no-store"`, 20 s request timeout). Every response is shape-checked; malformed rows reject the whole read rather than hiding a decision. The backend permits at most 100 decisions and 50 project rows, rejects formulas and requires owner-reviewed UTC time for any non-`unknown` project state.
- A successful poll proves **Sheet read**, not owner review or external verification. Each row says when its owner review happened, if at all; reviews older than seven days say `OWNER REVIEW STALE`. The register source read goes stale after ten minutes. On an outage the prior observation stays visible but is never counted as current.
- Links from cells are constrained to explicit Google Drive/Docs or PatterStage GitHub paths, over HTTPS with no credentials, port, query or fragment. Only the fixed approved Sheet edit URL is linked in the banner. No mutation controls exist in the dashboard.

## Live agent process observation

### Contract (implemented server-side in this branch)

`GET /api/mission-control/agents`

- **HTTP 200:** `{ schemaVersion: 1, checkedAt: string, source: string, agents: AgentBoardEntry[] }`. Each agent has the shape `{ id, name, runtime, availability, run: null, note?, stamp: { source, kind: "live", checkedAt, staleAfterMinutes: 1 } }` (see `src/components/mission-control/types.ts`).
- **HTTP 503:** `{ error: string }` when the connector is disabled or the read failed.

### Client behaviour (`MissionControlClient.tsx`, `live-agents.ts`)

- **Polling.** Sequential `fetch` with `cache: "no-store"` every **20 s**. The next poll is scheduled only after the previous one settles. Each request has a 15 s timeout. An `AbortController` cancels the in-flight request and the timer on unmount.
- **Validation.** The response shape is checked strictly: `schemaVersion === 1`, valid ISO times, non-empty strings, a known `availability`, `run === null`, `stamp.kind === "live"`, a finite `staleAfterMinutes`, unique ids, and at most 200 agents. One malformed agent rejects the whole response, which then counts as a failed poll. A partial board could silently hide a process.
- **On success.** Only `snapshot.agents` is replaced. The runtime snapshot stays `"observed"`; a demo snapshot in tests becomes `"mixed"`. Never `"live"`.
- **On failure (503, network error, timeout, bad JSON, invalid shape).** The previous successful observation and its `checkedAt` are kept unchanged. The board shows **CONNECTOR UNAVAILABLE (reason)** together with the age of the held observation. If no poll has ever succeeded, it shows **NOT CONNECTED** with no rows and "agent states unknown", never invented process states.
- **Clock.** The clock re-renders every 15 s regardless of poll results. With `staleAfterMinutes: 1`, held evidence shows **STALE** once it is two whole minutes old. A remote clock up to 30 s ahead of the browser counts as "just now"; anything further ahead counts as unknown.
- **Assignments are not claimed.** A process scan cannot see tasks. Live rows show run state as "Not observed — process scan cannot see assignments", never "No run assigned".

### Setup: PC (runs Control Hub) → VPS (runs agents)

The PC runs Control Hub. The route on the PC opens an SSH connection to the VPS and runs a read-only exporter script there. The browser only ever talks to the PC on localhost.

#### 1. Deploy the three read-only exporters on the VPS

The agent, evidence and owner-register exporters and `ssh-dispatch.py` ship under `scripts/mission-control/`. The agent/evidence routes require configured absolute VPS paths; the register route uses a fixed third path. The current VPS installation accepts the three corresponding `/home/brettjubinville/bin/` paths but dispatches the dedicated SSH key to root-owned copies under `/usr/local/libexec/mission-control/`. Never take an exporter command or path from a browser request.

The agent exporter observes process identities; the evidence exporter reads only the selected Hermes schedule/run, public PatterStage PR metadata and selected-folder Drive metadata. Neither provides approval or project-status authority. The register exporter reads the separate, manually maintained Google Sheet for owner-recorded decisions and project status, not approvals or external verification. Its selected sheet ID and Drive account selector stay in VPS-local protected files. See `docs/mission-control-owner-register.md`. An optional Hermes coordinator ID is also stored only in a VPS-local protected selector; do not put it in the repository or PC environment. Keep the Launchhost coordinator paused.

#### 2. Restrict a dedicated SSH key

Generate a dedicated ED25519 key in WSL (the current preview uses `~/.ssh/patterstage_mc`); the private key never leaves the PC. Authorize its **public** key on the VPS with `restrict,command="/usr/local/libexec/mission-control/ssh-dispatch.py"`. The root-owned dispatcher accepts only the three exact exporter paths in `SSH_ORIGINAL_COMMAND`, executes the root-owned copies without a shell, and rejects an interactive session or any other command. A bare `ssh <host>` is expected to fail for this key. Do not add an unrestricted personal key for the dashboard; keep this PC-local preview bound to localhost.

#### 3. Pin the VPS host key

The connection is non-interactive, so an unknown or changed host key must make it **fail**, not prompt or silently accept.

1. Get the fingerprint **out-of-band** from the VPS itself (provider console or an existing trusted session):
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
2. On the PC, fetch the key with `ssh-keyscan -t ed25519 <vps-host>` and compare it to that fingerprint (`ssh-keygen -lf <(ssh-keyscan -t ed25519 <vps-host> 2>/dev/null)`). Append it to `~/.ssh/known_hosts` only if the fingerprints match.
3. Put the dedicated key first in WSL `~/.ssh/config` (before `Host *`), matching the literal VPS host used by both routes:

```text
Host <vps-host-or-ip>
  User <observer-user>
  IdentityFile ~/.ssh/patterstage_mc
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  BatchMode yes
```

If the VPS is rebuilt and its host key changes, polls fail closed. Re-verify the fingerprint before changing `known_hosts`; never set `StrictHostKeyChecking no`.

#### 4. Configure Control Hub on the PC

Set these **server-process** variables in WSL before starting `npm run dev`; keep the host/account in local configuration, not this repository:

```text
MC_AGENT_SSH_TARGET=<observer-user>@<vps-host-or-ip>
MC_AGENT_SSH_REMOTE_SCRIPT=/home/<observer-user>/bin/export-agent-snapshot.py
MC_EVIDENCE_SSH_TARGET=<observer-user>@<vps-host-or-ip>
MC_EVIDENCE_SSH_REMOTE_SCRIPT=/home/<observer-user>/bin/export-mission-evidence.py
```

Restart the server after changing variables. The evidence and register routes require the `user@host` target form; the register route reuses `MC_EVIDENCE_SSH_TARGET` with its own fixed exporter command, so no new PC-side secret or target is needed. Test each exporter with its exact remote script path, then check all three same-origin endpoints; a bare SSH connection intentionally fails. The owner previously confirmed agent/evidence PC-local endpoints returned 200 and, on October 7, 2026, reported that the updated Owner inbox and Project radar looked good and were connected on his PC. No raw PC register response or failure-state test was supplied.

#### WSL2 on a Windows PC

- **Run everything inside the WSL2 distro.** That includes Control Hub (`npm run dev` / `next start`), the SSH key and `~/.ssh/config`. The route spawns WSL's OpenSSH, which reads WSL's `~/.ssh`, not `%USERPROFILE%\.ssh` on Windows.
- **Keep keys on the Linux filesystem**, not under `/mnt/c/...`. DrvFs does not enforce Unix permissions, and OpenSSH refuses private keys it considers too open. Use `chmod 700 ~/.ssh` and `chmod 600 ~/.ssh/patterstage_mc ~/.ssh/config`.
- **Browse from Windows to `http://localhost:<PORT>`.** WSL2 forwards localhost from Windows to a server bound to `127.0.0.1` inside the distro, so there is no need to bind `0.0.0.0`.
- **Watch for mirrored networking.** If WSL2 *mirrored* networking mode is enabled, a `0.0.0.0` bind inside WSL is reachable from the LAN. That is one more reason to bind `127.0.0.1`.

#### First-run database

Before starting `npm run dev`, initialize the **same isolated `CH_DATA_DIR`** used by the PC preview. The current preview uses `data-v2`; keep the earlier directory untouched:

```bash
mkdir -p "$HOME/.patterstage-preview/hermes" "$HOME/.patterstage-preview/data-v2"
CH_DATA_DIR="$HOME/.patterstage-preview/data-v2" CONTROL_HUB_DATA_DIR="$HOME/.patterstage-preview/data-v2" npm run db:migrate
```

Use `data-v2` for both migration and runtime. Do not delete the earlier directory; it may contain data worth preserving. A fresh development run applies baseline and incremental migrations automatically, but an already-partial database must not be silently treated as healthy.

## Live evidence section (UI)

The backend route and its connectors are documented separately (`docs/mission-control-evidence-bridge.md`). This section covers only what the browser does with the response.

- **Contract checked at the client boundary.** `{ schemaVersion: 1, checkedAt, sources: [{ id, status, checkedAt, items }] }` with **exactly** the three sources `hermes`, `github` and `drive`. Times must be ISO-8601 UTC (`Z` or `+00:00`). A `live` source needs a `checkedAt`; an `unavailable` source must carry no items. Kinds are tied to sources: Hermes → `task`/`run`, GitHub → `pull_request`, Drive → `document`. Any malformed source or item rejects the whole response, which counts as a failed poll.
- **Links.** Rendered only for absolute `https` URLs without credentials or ports on `github.com` (GitHub) or `drive.google.com` / `docs.google.com` (Drive). Hermes items are never linked. Any other URL is dropped and the item says "Link withheld".
- **Polling.** Its own sequential loop, independent of the agent poll: `cache: "no-store"`, every 60 s, 20 s request timeout, aborted with its timer on unmount.
- **Source states.**
  - **LIVE:** fresh and from a successful poll.
  - **HELD — LAST POLL FAILED:** the route failed; the previous items stay with their timestamps and the connector error. HELD is never counted as live.
  - **STALE:** last successful check more than 10 minutes old.
  - **UNAVAILABLE:** the route reported it could not read the source. This is not zero and not idle.
  - **UNKNOWN:** no observation yet, or an unusable timestamp.

  A live source with no items says "returned 0 items".
- **Scope labels.** GitHub shows PR state/checks only and says a PR or green check is not a merge, deploy or release approval. Drive shows metadata only; contents are not read. Hermes shows only records the route returned.

## Security posture (required)

This page reads data, but it lives inside the Control Hub shell. The shell's existing API routes include config writes, cron management, mission dispatch and file access, and they have **no authentication**. Anyone who can reach the port can call them. The agents, evidence and owner-register routes also trigger bounded SSH reads from the VPS on every request.

Required for any instance that sets `MC_AGENT_SSH_TARGET`:

1. **Bind to localhost only.** Start with `next dev -H 127.0.0.1` or `next start -H 127.0.0.1`. Do **not** use `npm run dev:network`, `npm run start:network`, or the `-H 0.0.0.0` that the general deployment notes in `AGENTS.md` show. Those notes target a different, trusted-network setup.
2. **Use an isolated `HERMES_HOME` and `CH_DATA_DIR`.** Point both at scratch directories created for this instance, not at your real `~/.hermes` or production Control Hub data. That way the shell's other routes cannot read or modify real agent configuration, cron, sessions or credentials.
3. **Never expose it publicly.** No port forwarding, public reverse proxy, tunnel (ngrok, Cloudflare Tunnel, Tailscale Funnel, etc.) or cloud deployment.
4. **`CH_READ_ONLY` is not authentication.** It only makes routes that call `requireAuth()` refuse writes. It does not stop anyone from reading data, it does not cover every route, and it does not identify the caller. Set it as defence in depth, but do not rely on it.
5. **Keep the SSH key narrow:** a dedicated key, a non-root VPS user with only the needed read permissions, a forced command, `restrict`, and a pinned host key, as described above.

Owner authentication and deny-by-default writes must exist before this page, or the shell around it, is reachable by anything but the local machine.

## Display rules (enforced in `freshness.ts` / `live-agents.ts` and tested)

- **Source tags.** Agent/evidence status rows carry `SourceTag` provenance; manual-register rows use `RegisterReadStatus` and `RegisterRowProvenance` so a successful Sheet read cannot be mistaken for an owner review.
- **Bad timestamps.** If `checkedAt` is missing, unparsable or more than 30 s in the future, the row is **unknown**, never fresh.
- **Stale rows.** If the age exceeds `staleAfterMinutes`, the row shows **STALE**. On the agent board a stale heartbeat replaces the headline state with `STALE`, and the previous value moves to "last reported: …". A stale agent never shows as idle.
- **Missing data.** Panels without a source or before any successful register read show unknown/unavailable, never `0 open`, "none" or $0. A successful register read with no open rows says only "0 open decisions recorded in register." Observed artifacts are never presented as deliverables.
- **No colour-only states.** Every state is written as text with an icon.

## Accessibility and mobile

- **Layout.** Single column by default; the `sm:`/`md:` breakpoints add columns.
- **Jump nav.** `<nav aria-label="Owner overview sections">` with 44px touch targets. Each target is a `<section tabindex="-1" aria-labelledby>` with an `h2`, so it can take keyboard focus.
- **Reading order.** Summary → Owner inbox → agents → live evidence → projects → observed artifacts (demo/test snapshots end with deliverables & risks instead).
- **Tokens.** Theme tokens only (`neon-*`, `semantic-*`, `dark-*`); no raw hex values.

## Files

- `src/app/mission-control/page.tsx`: route shell (`AppPageShell` + `PageHeader`).
- `src/components/mission-control/`:
  - `types.ts`: data contract.
  - `freshness.ts`: pure freshness rules.
  - `live-agents.ts`: response validation, poll-state transitions, fetch helper and merge.
  - `live-evidence.ts`: UI-side copy of the evidence contract, validation, URL allowlist, poll state and display rules.
  - `live-register.ts` and `RegisterStatus.tsx`: strict manual-register contract, poll state, owner-review status and rendering provenance.
  - `LiveEvidence.tsx`: evidence section.
  - `observed-snapshot.ts`: empty runtime snapshot (`mode: "observed"`).
  - `SourceCoverageBanner.tsx`: runtime data-source banner.
  - `ObservedArtifacts.tsx`: Drive/GitHub observed-artifact shelf.
  - `demo-fixture.ts`: synthetic fixture, for pure component tests only.
  - `MissionControlClient.tsx`: polling client.
  - `OwnerOverview.tsx` and the section components.
- Tests include `tests/unit/mission-control-owner-register.test.tsx`, `tests/unit/mission-control-owner-register.test.ts`, `tests/unit/mission-control-owner-register-route.test.ts` and `tests/unit/test_owner_register_exporter.py`, plus the existing overview, agent, evidence and freshness suites.

## What further adapters must supply

The manual register now supplies decisions and project rows, but the artifact shelf is not task-linked and approval actions remain disconnected. Future adapters must follow these rules:

1. **Provenance per datum.** Each item needs a `SourceStamp`:
   - `source`: a named system.
   - `kind`: `"live"` only after a successful read.
   - `checkedAt`: the UTC time of the last *successful* read, not the last attempt.
   - `staleAfterMinutes`: matched to the source's refresh cadence.

   A failed refresh keeps the previous `checkedAt`, so the row goes stale instead of being zeroed.
2. **Agents.** Report availability separately from run state. Do not infer an assignment from a branch name or process name alone. A lost heartbeat must yield `unknown`/`interrupted`, never `succeeded` or `idle`.
3. **Inbox.** The register records exact target, impact and raised-at for open decisions. Approval actions stay absent until an authenticated backend binds approval to the exact payload and rejects changed payloads.
4. **Projects.** A manually owner-reviewed status is not independently verified by evidence sources. A green CI result must not clear a release blocker.
5. **Deliverables.** Link each artifact to its task/project before calling it a deliverable. Until then the shelf stays "Observed artifacts".
6. **Mode.** Set `mode: "live"` only when every panel is backed by a live adapter. The runtime snapshot stays `observed`, so the coverage banner remains.
7. **Security gate first.** Owner authentication, deny-by-default writes and redaction come before any further connector. Never put secrets in a snapshot.
