# Mission Control — requirements ledger

This ledger maps **every stable requirement ID** from the three Mission Control source documents to its current status in this repository. For each ID it gives a phase, a source of truth, an acceptance check and a dependency. It is a planning record, not a claim of delivery.

- **Nothing here is marked `implemented`.** No requirement has been verified end to end on the owner's PC against live sources.
- **UI-only work is `partial`.** That includes this branch's Live evidence section. It stays `partial` until its backend is merged and the result is verified on the PC.
- **No dated figures from the sources.** Metrics, prices, quota counts, lead counts, account or job identifiers, and credential strings are not copied here or into the app. Where a requirement depends on one, the row says the value needs a fresh source read.

## Sources and namespaces

Two documents both use `AC-01`…, so **every ID in this ledger carries a document namespace.**

| Namespace | Document (local snapshot file) | ID families | Count |
|---|---|---|---|
| `ACR` | *Agent Command Center: Requirements*, Draft v1 (`latest_claude.md`) — the **older draft** per coordinator labelling | REG, RUN, APPR, GUARD, DEP, MAP, FIND, SCORE, ALERT, REF, COST | 47 |
| `PRD` | *Brett's Agent Command Center — Product Requirements*, v1.0 (`existing_markdown.md`) — the **newer draft** per coordinator labelling | TASK, AGENT, CTRL, KNOW, FILE, AUTO, OPS, WF, AC (AC-01…AC-12) | 38 |
| `BP` | *Brett's Mission Control — owner view and PatterStage build blueprint* (`mission-control-blueprint.md`) | MC (MC-01…MC-11), AC (AC-01…AC-09) | 20 |

**Total: 105 IDs.**

- **Snapshot location.** The local snapshots are in the Hermes scratch cache (`agent-command-center-source/`).
- **Drive check.** The coordinator checked the five objects in the shared Google Drive folder and reported no metadata changes since the October 6 snapshot. This worker did not re-check Drive.
- **Draft order.** The "older/newer" labels follow the coordinator's instruction, and the blueprint also calls the PRD "the more recent" draft. The snapshot filenames do not establish order. Rows are told apart by **namespace, not age**.
- **Precedence.** No draft supersedes another without the owner's review (blueprint, "Source map and decisions").

### Coverage check

`tests/unit/mission-control-requirements-ledger.test.ts` parses this file and checks three things:

1. Every expected ID appears **exactly once** as a ledger row.
2. Every status is one of the three allowed values.
3. No currency amounts or credential-like strings appear.

When the local snapshots are present, the same test also extracts every requirement and acceptance ID defined in them. It fails if any of those IDs is missing from the ledger or extra. On machines without the snapshots, that part of the test is skipped.

## Status vocabulary

- **implemented:** built, wired to its real source, and verified on the PC. No row is at this status today.
- **partial:** some code exists in this repository, such as a UI, contract, reducer or read-only route, but it is incomplete, uses demo data, or has not been verified on the PC.
- **not started:** no code in this repository serves the requirement. Related Control Hub base features may be noted in the row, but they do not count.

**Phase column.** Gives the source priority and then the Mission Control phase:

- Source priority: Must/Should/Later for `ACR`; P0/P1/P2 for `PRD`; P0/P1 for `BP`.
- Mission Control phase:
  - **MC-P0:** visibility, read-only.
  - **MC-P1:** connected operations.
  - **MC-P2:** expansion.
  - **Out:** excluded from scope.

**Focus column.** Order of work:

- **NGM** (New Growth Media) and **LH** (Launchhost) come first.
- **Core** is shared platform work that both need.
- **Backlog** is everything else. Backlog items stay recorded but are not scheduled.

## Decisions and constraints that apply across rows

### Owner timezone — America/Edmonton default

- **The draft conflict.** ACR (RUN-4) requires Calgary time, IANA `America/Edmonton`; PRD (section 3) says `America/Denver`. The blueprint uses `America/Edmonton`.
- **Standing owner preference.** Brett's calendar timezone is `America/Edmonton`, which resolves the owner-facing default for this build. Per-account campaign timezones can still override it where appropriate. This is not derived from the Hermes host profile setting.
- **Implementation status.** Mission Control currently renders UTC only (`formatUtc`); schedule conversion, DST tests and warnings are still not implemented. Store timestamps in UTC.
- **Rows dependent on implementation:** `ACR:RUN-4`, `PRD:AUTO-01`, `PRD:WF-01`, `ACR:ALERT-2`.

### Excluded from scope

- **Clinical and brokerage writes.** These are excluded from the hub's initial scope: clinical record writes, finalizing clinical judgments, placing trades or any brokerage execution, and moving money. Clinical Prose uses synthetic data only. ThetaAlpha/Tradier is limited to diagnostics.
- **Rows bound by these exclusions:** `PRD:CTRL-01`, the P2 integration boundaries, and blueprint P2 item 12.

### Local-only security gate

- **Localhost only.** Control Hub must run on localhost, with an isolated `HERMES_HOME`/`CH_DATA_DIR`. The shell around Mission Control exposes powerful unauthenticated routes.
- **The read-only flag is not access control.** `CH_READ_ONLY` is a write flag, not authentication.
- **No exposure before the gate passes.** Nothing may be exposed beyond localhost, given production credentials, or allowed to dispatch until `BP:AC-09` passes on a private test instance. A UI smoke test does not count as that proof.
- **Related work.** A separate security-foundation branch exists but is not part of this base and is not evaluated here.

### Launchhost coordinator paused

- **Paused, and no dispatch.** The Launchhost autonomous coordinator is paused, and Mission Control has **no dispatch, cancel, approve, save or send controls**.
- **Read-only display.** The exporter can show a configured coordinator's schedule state, for example *paused*. That is read-only: an enabled schedule is not evidence that the coordinator is running.
- **Testing.** Tests use simulators. Nothing resumes the production coordinator.

### Evidence is not project status

- **Separate from the demo panels.** The Live evidence section (Hermes task/run records, GitHub PR state and checks, Drive file metadata) is separate from the owner inbox and project radar, which stay **demo**.
- **PR state is not a release gate.** A green check or open PR does not clear any release gate.
- **Drive.** Only metadata is shown, never document contents.

## Ledger — `ACR` (older draft: Agent Command Center Requirements)

| ID | Requirement (summary) | Status | Phase | Focus | Source of truth | Acceptance check | Dependency | Clarification |
|---|---|---|---|---|---|---|---|---|
| ACR:REG-1 | Single registry of every agent/automation across runtimes with purpose, trigger, business and state | partial | Must · MC-P0 | Core | Registry table (not built), fed by runtime adapters | Every runtime's agents appear once with a named source and checked-at | Adapters for Hermes, Claude, Zapier, ActiveCampaign, iClosed | Only the live VPS process observation exists (agent board); no registry, no non-Hermes runtimes. |
| ACR:REG-2 | Per entry: reads, may change, must never do | not started | Must · MC-P0 | Core | Registry permission fields | Each entry shows reads/changes/forbidden lists from its config | REG-1, GUARD-1 | — |
| ACR:REG-3 | Per entry: dependencies (connections, plans, accounts, other automations) | not started | Must · MC-P0 | Core | Registry dependency fields + connection status | Dropping a connection marks dependent entries at risk | REG-1, DEP-1 | — |
| ACR:REG-4 | Version history of agent instructions with restore | not started | Should · MC-P2 | Backlog | Versioned instruction store | Diff between two versions and restore produces the prior text | REG-1, write policy | Restore is a write; needs approval policy first. |
| ACR:REG-5 | On-demand workflows saved as named agents with standing instructions | not started | Should · MC-P1 | NGM | Registry + instruction store | Each named on-demand agent starts from the same stored brief | REG-1, REG-4 | Control Hub has Hermes templates/profiles; not mapped to these workflows. |
| ACR:REG-6 | Weekly scan flags automations missing from the registry | not started | Later · MC-P2 | Backlog | Connector discovery reads | A seeded unregistered automation is flagged | REG-1, connectors for each system | — |
| ACR:RUN-1 | Last run, result, duration, next run, link per scheduled agent | partial | Must · MC-P0 | Core | Runtime run records (Hermes first) | Each scheduled agent shows last/next run with a working evidence link | Evidence backend (Hermes run items), local-time scheduling | Live evidence UI can list Hermes task/run items if the route returns them (UI only, backend separate). No next-run or duration display. |
| ACR:RUN-2 | Missed-run detection, incl. stalled on unanswered approval | not started | Must · MC-P0 | Core | Schedule + run records | A skipped window raises a missed-run item | RUN-1, AUTO schedules | — |
| ACR:RUN-3 | One plain result per run: OK / fixed something / needs you | not started | Must · MC-P0 | Core | Run result field | Every run renders one of the three results | Runtime result contract | — |
| ACR:RUN-4 | Schedules shown in owner local time; warn on UTC-stored schedules | not started | Must · MC-P0 | Core | Schedule records with stored zone | A UTC-stored schedule shows a warning and its local time | Timezone display/DST implementation | Owner default is America/Edmonton; UI is UTC-only until implemented. |
| ACR:RUN-5 | Run now, pause, resume from the hub | not started | Should · MC-P1 | LH | Runtime adapter controls | Control returns real confirmation and reads back state | Authentication, GUARD-1, approval policy | Deliberately absent: Mission Control has no controls. Launchhost coordinator stays paused. |
| ACR:RUN-6 | 30-day duration and failure rate per agent | not started | Should · MC-P1 | Core | Run history | Rates computed from stored runs with explicit window | RUN-1 history retention | — |
| ACR:RUN-7 | External automations: last fired, contacts waiting | not started | Should · MC-P1 | NGM | Zapier / ActiveCampaign / iClosed reads | Each external automation shows last-fired time with source and checked-at | Read connectors for those systems | Historical states in the draft are dated; need fresh reads. |
| ACR:APPR-1 | One queue of everything waiting on the owner | partial | Must · MC-P0 | Core | Approval items table (not built) | Every pending draft/inactive automation appears once with source | Connectors that expose drafts; GUARD | Owner inbox UI exists with **synthetic demo rows only**. |
| ACR:APPR-2 | Each item shows what/where/before-after; approve, send back, dismiss | not started | Must · MC-P1 | Core | Approval items with payload | Decision bound to exact payload; changed payload re-queues | Authentication, payload binding (MC-03/MC-11) | Approve/reject controls intentionally absent. |
| ACR:APPR-3 | Age on every item; flag older than 3 days | partial | Must · MC-P0 | Core | Approval item created-at | Items sort oldest first; >3 days flagged | APPR-1 real source | Implemented in the demo inbox UI and tested; no real items. |
| ACR:APPR-4 | Approve from a phone | not started | Should · MC-P1 | Core | Approval API | Phone approval executes only the bound payload | APPR-2, authentication | Mobile layout exists; no approval action. |
| ACR:APPR-5 | Ad items carry build spec + Editor import files; "approved" = owner imported | not started | Should · MC-P1 | NGM | Approval item attachments (Drive) | Approved ad item links its spec and files; no agent-applied change | APPR-2, FILE-01 | — |
| ACR:GUARD-1 | Three permission levels per agent | not started | Must · MC-P0 | Core | Registry permission level | Agent at "read only" cannot queue or act | REG-1, enforcement at execution boundary | — |
| ACR:GUARD-2 | Global rules: no live ad changes, no lead/client email, no spend changes, no deletions without approval | not started | Must · MC-P0 | Core | Policy store enforced at execution | A forbidden action is denied and audited | GUARD-1, CTRL-01 | Mission Control itself is read-only, but that does not enforce anything on agents. |
| ACR:GUARD-3 | Account scoping per agent | not started | Must · MC-P0 | NGM | Registry account scopes | Agent touching an unlisted account is denied | GUARD-1, connector scoping | — |
| ACR:GUARD-4 | One switch that pauses everything | not started | Should · MC-P1 | Core | Dispatcher state | Switch stops new dispatch; in-flight work reported honestly | Authentication, adapter pause support | Absent by design; see coordinator paused. |
| ACR:GUARD-5 | Log of every agent change in any system, with undo where possible | not started | Should · MC-P1 | Core | Append-only audit events | Every external write has an audit record with authorizer | Audit store, adapters | — |
| ACR:DEP-1 | Live status of every connection and which agents break | partial | Must · MC-P0 | Core | Connection health reads | A dropped connection shows unavailable/stale and lists dependent agents | REG-3, connectors | Agent connector status and per-source evidence status (Hermes/GitHub/Drive) are shown; UI-only for evidence; no dependency mapping. |
| ACR:DEP-2 | Plan and trial tracker incl. plan-gated features | not started | Must · MC-P1 | NGM | Billing/plan records (manual or API) | Each plan shows tier/renewal with source and checked-at | Owner-supplied or API plan data | Draft trial dates are historical; need fresh reads. |
| ACR:DEP-3 | Quota meters for metered tools; warn before an unfinishable job | not started | Must · MC-P1 | NGM | Provider usage reads | Job blocked/warned when quota insufficient | Usage APIs | Draft quota figures not copied; need fresh reads. |
| ACR:DEP-4 | Where each agent runs; whether that machine is online | partial | Should · MC-P0 | Core | Host heartbeats | Each agent shows host and host freshness | Exporters per host | VPS process observation only; Windows PC not observed. |
| ACR:DEP-5 | Domain expiry, DNS and email auth status | not started | Later · MC-P2 | Backlog | DNS/registrar reads | Status shows checked-at; unavailable ≠ healthy | Read-only DNS checks | — |
| ACR:MAP-1 | Per lead source, timeline of every automated message and its stop condition | not started | Must · MC-P1 | NGM | iClosed / ActiveCampaign / Meta configs | Map lists each touch with sender and stop condition from a fresh read | Read connectors; owner confirms current flows | Draft flow details are dated observations. |
| ACR:MAP-2 | Conflict warnings: two systems messaging within the hour; missing stop | not started | Should · MC-P1 | NGM | MAP-1 data | Seeded overlap raises a warning | MAP-1 | — |
| ACR:MAP-3 | Look up one lead and see everything sent | not started | Later · MC-P2 | Backlog | Per-contact send logs | Lookup returns sends with sources | MAP-1, privacy design | Personal data; needs scoping first. |
| ACR:FIND-1 | Every audit/agent issue becomes a tracked finding | not started | Must · MC-P0 | NGM | Findings table | New finding has what/where/impact/found/status | Findings store | Draft findings are dated and of unknown current status. |
| ACR:FIND-2 | Finding stays open until re-verified | not started | Must · MC-P0 | Core | Findings verification field | "Fixed" without verification keeps it open | FIND-1 | — |
| ACR:FIND-3 | Repeat findings linked | not started | Should · MC-P1 | Core | Findings links | Third recurrence is visibly linked | FIND-1 | — |
| ACR:SCORE-1 | NGM funnel row for 7/30 days incl. cost per qualified booked call vs target | not started | Must · MC-P1 | NGM | Ad, iClosed, CRM reads | Each figure shows source, window, checked-at; unavailable ≠ 0 | Read connectors; **owner target not set** | No historical number becomes a live tile. |
| ACR:SCORE-2 | Funnel split by path: booking page vs Meta instant form | not started | Must · MC-P1 | NGM | Same as SCORE-1 | Two rows with explicit denominators | SCORE-1 | — |
| ACR:SCORE-3 | Show/no-show outcomes from iClosed | not started | Should · MC-P1 | NGM | iClosed read | Show rate has a source and window | iClosed connector | — |
| ACR:SCORE-4 | Flag when two systems disagree on a count | not started | Should · MC-P1 | NGM | SCORE-1 inputs | Seeded disagreement raises a flag | SCORE-1 | Draft discrepancy example is historical. |
| ACR:SCORE-5 | Per-client ad account rows and a TherapySites row | not started | Later · MC-P2 | Backlog | Client ad accounts; product billing | Rows isolated per client | Client isolation (PRD:AC-10) | Client accounts in the hub: owner decision pending. |
| ACR:ALERT-1 | Phone alert only when something needs the owner | not started | Must · MC-P1 | Core | Alert pipeline | Routine success produces no alert | OPS-03, notification channel | — |
| ACR:ALERT-2 | Morning digest: overnight runs, waiting items, expiring | not started | Must · MC-P1 | Core | Digest generator | Digest lists sources; missing integrations become setup items | RUN-1, APPR-1, local-time scheduling | Can be a section of the existing morning brief. |
| ACR:ALERT-3 | Each alert: what happened, what was done, the one owner action | not started | Should · MC-P1 | Core | Alert template | Alert includes all three parts | ALERT-1 | — |
| ACR:REF-1 | One reference page every agent reads at run start | not started | Should · MC-P1 | NGM | Versioned reference record | Agents cite reference version per run | KNOW-01 | Must not hold credentials. |
| ACR:REF-2 | Standing preferences stored once and applied by every agent | not started | Should · MC-P1 | NGM | Versioned preferences record | Preference change propagates with version | KNOW-01 | Draft pricing is historical; not copied; needs owner confirmation. |
| ACR:REF-3 | Client roster with accounts, contacts, status | not started | Later · MC-P2 | Backlog | Client records | Roster isolated per client | Client isolation, privacy design | — |
| ACR:COST-1 | Monthly stack cost list with renewal and using agents | not started | Should · MC-P1 | Core | Plan/billing records | Each line shows source; unknown is never shown as zero | DEP-2 | Placeholder risk row says spend unavailable; no figures. |
| ACR:COST-2 | Claude usage per agent | not started | Later · MC-P2 | Backlog | Provider usage reads | Usage shown as actual/estimated/incomplete | OPS-02 | — |

## Ledger — `PRD` (newer draft: Product Requirements)

| ID | Requirement (summary) | Status | Phase | Focus | Source of truth | Acceptance check | Dependency | Clarification |
|---|---|---|---|---|---|---|---|---|
| PRD:TASK-01 | Unified intake (web + authenticated Telegram) with structured task fields | not started | P0 · MC-P1 | Core | Durable task database | Intake persists before acknowledgement (PRD:AC-01) | Authentication, task store | Control Hub's Hermes mission form is a base feature, not this requirement; MC has no intake. |
| PRD:TASK-02 | Task state separate from run state; lost heartbeat → unknown/interrupted | partial | P0 · MC-P0 | Core | Task/run records + adapter events | Lost heartbeat never yields succeeded (PRD:AC-02) | Adapters, task store | `observations.ts` reducer and UI keep availability/run separate and show STALE/UNKNOWN; not wired to a task store. |
| PRD:TASK-03 | Controlled delegation with limits and parent/child tree | not started | P0 · MC-P1 | Core | Run tree records | Child cannot widen scope (PRD:AC-04) | TASK-02, CTRL-01 | Dispatch stays off. |
| PRD:TASK-04 | Reviewable completion with evidence | not started | P0 · MC-P1 | Core | Task + artifact links | Completion blocked without evidence (PRD:AC-12) | FILE-01 | Live evidence section is a read-only precursor; it does not gate completion. |
| PRD:TASK-05 | Recovery without duplicate actions (idempotency, reconciliation) | not started | P0 · MC-P1 | Core | External IDs + idempotency keys | PRD:AC-05 / BP:AC-07 | Adapters with external IDs | — |
| PRD:AGENT-01 | Agent registry with runtime, capabilities, status, heartbeat | partial | P0 · MC-P0 | Core | Registry + heartbeats | Each agent shows status and heartbeat freshness | Adapters | Live VPS process observation only; no capabilities/owner/cost fields. |
| PRD:AGENT-02 | Common adapter contract; unsupported controls visible | partial | P0 · MC-P0 | Core | Adapter interface | Unsupported control shown unavailable, never successful | Verified runtime interfaces | Read-only `AdapterObservation` contract exists; no start/cancel/events. |
| PRD:AGENT-03 | Run detail timeline (inputs, actions, approvals, costs) | not started | P0 · MC-P1 | Core | Append-only run events | Timeline renders from stored events; secrets redacted | Event store | — |
| PRD:AGENT-04 | Stop controls: cancel run, pause agent/workspace, global stop | not started | P0 · MC-P1 | LH | Adapter controls | BP:AC-02 with simulator | Authentication, AGENT-02 controls | Intentionally absent from MC. |
| PRD:CTRL-01 | Action policy by workspace/tool/action | not started | P0 · MC-P0 | Core | Policy store | Excluded actions (money, trades, clinical judgments) are refused | Enforcement at execution boundary | Exclusions recorded above. |
| PRD:CTRL-02 | Concrete approval queue bound to payload/version/target/expiry | not started | P0 · MC-P1 | Core | Approval records with payload hash | PRD:AC-03 / BP:AC-06 | Authentication, payload binding | Demo inbox rows exist (see ACR:APPR-1); no binding. |
| PRD:CTRL-03 | Narrow standing authorization with revocation | not started | P0 · MC-P1 | Core | Policy records | Action records which policy authorized it | CTRL-01 | — |
| PRD:KNOW-01 | Versioned project memory with fact status | not started | P0 · MC-P1 | Core | Knowledge records | Conflicting facts surfaced, not silently chosen | Knowledge store | This ledger is a manual document, not that system. |
| PRD:KNOW-02 | Scoped retrieval; imported content untrusted; secrets server-side | not started | P0 · MC-P1 | Core | Scoped knowledge index | Cross-workspace retrieval denied | KNOW-01, auth | — |
| PRD:FILE-01 | Deliverable shelf linking artifacts to task/run/workspace/version | partial | P0 · MC-P0 | LH | Drive metadata + GitHub PR reads | Each artifact links to its task with an authoritative link | Evidence backend, task store | Live evidence UI lists Drive metadata and PR state (UI only; not linked to tasks; backend separate; PC unverified). |
| PRD:FILE-02 | Knowledge sync from changed Drive files | not started | P1 · MC-P2 | Backlog | Drive change feed | Changed file updates indexed version | FILE-01, KNOW-01 | — |
| PRD:AUTO-01 | Schedules with timezone, next run, missed-run policy, overlap prevention | not started | P0 · MC-P1 | Core | Schedule records | DST transition preserves intended local time | Local-time scheduling and DST tests | Default owner zone is America/Edmonton; Control Hub's Hermes cron page is not verified against this requirement. |
| PRD:OPS-01 | Connection health and concrete recovery steps | partial | P0 · MC-P0 | Core | Host/connector health reads | Failed connector shows unavailable with reason, never healthy | Connectors | Agent connector and per-source evidence status shown (evidence UI only); no recovery guidance. |
| PRD:OPS-02 | Cost accounting with currency and actual/estimated/incomplete | not started | P0 · MC-P1 | Core | Usage records | Unavailable usage never shown as free | Usage sources | Placeholder risk row only. |
| PRD:OPS-03 | Useful notifications; bound Telegram commands | not started | P0 · MC-P1 | Core | Notification pipeline | Generic "yes" approves nothing (PRD:AC-09) | Auth, single Telegram consumer | — |
| PRD:WF-01 | Morning owner brief linking evidence | not started | P0 · MC-P1 | Core | Digest generator | Missing integrations become setup items, not invented numbers | ALERT-2, local-time scheduling | — |
| PRD:WF-02 | Meta lead to booked call (consent-aware proposals) | not started | P1 · MC-P1 | NGM | Meta, iClosed, CRM reads | Follow-up proposals recheck booking/opt-out before draft | MAP-1, consent records | Sending stays off without policy. |
| PRD:WF-03 | Therapy-practice campaign review | not started | P1 · MC-P1 | NGM | Client campaign reads | Proposed change waits for owner review | Client isolation, CTRL-02 | — |
| PRD:WF-04 | SaaS feature delivery: scope → change → QA → preview → review → authorized deploy | not started | P0 manual / P1 connected · MC-P1 | LH | GitHub PR/checks + deploy records | Green CI never implies deploy (BP:AC-04) | MC-09 release gates | Evidence UI shows PR state separately from deploy (precursor only). |
| PRD:WF-05 | Product experiment with hypothesis, budget, review date | not started | P1 · MC-P2 | Backlog | Experiment records | No launch from a draft alone | CTRL-01 | — |
| PRD:WF-06 | Agent failure and recovery | partial | P0 · MC-P0 | Core | Heartbeats + run checkpoints | Missing heartbeat → interrupted; checkpoint preserved | TASK-05, adapters | Detection display only: held observations go STALE/UNKNOWN. No recovery. |
| PRD:AC-01 | Create a scoped task and assign an agent | not started | P0 · MC-P1 | Core | Task store | Task persists, executes within limits, links output | TASK-01 | — |
| PRD:AC-02 | Worker disconnects midway → interrupted/unknown, no false success | partial | P0 · MC-P0 | Core | Adapter events | Simulated disconnect yields interrupted/unknown | TASK-02 | Reducer and UI unit-tested with synthetic fixtures; no checkpoints; PC unverified. |
| PRD:AC-03 | Live change preview; changed payload invalidates approval | not started | P0 · MC-P1 | Core | Approval records | Old approval rejected after payload change | CTRL-02 | — |
| PRD:AC-04 | Child agent unpermitted tool denied and audited | not started | P0 · MC-P1 | Core | Policy + audit | Denial recorded without widening scope | CTRL-01, TASK-03 | — |
| PRD:AC-05 | Lost acknowledgement does not duplicate external write | not started | P0 · MC-P1 | Core | External IDs | Retry reconciles, no duplicate | TASK-05 | — |
| PRD:AC-06 | Spend/time cap stops new actions | not started | P0 · MC-P1 | Core | Usage + caps | Partial work and reason visible | OPS-02 | — |
| PRD:AC-07 | Duplicate trigger/event yields one logical action | not started | P0 · MC-P1 | Core | Event IDs | Duplicate recorded or ignored safely | Event store | `observations.ts` flags duplicate/out-of-order observations, but that is not action deduplication. |
| PRD:AC-08 | Connected metric becomes stale → labelled stale, not zero | partial | P0 · MC-P0 | Core | Source timestamps | Stopped refresh shows STALE with last refresh | Live sources | Agent board and evidence UI hold and age observations to STALE (unit-tested); evidence backend separate; PC unverified. |
| PRD:AC-09 | Telegram status/pause hits correct scope and returns actual status | not started | P0 · MC-P1 | Core | Telegram command handler | Verified account required; actual state returned | OPS-03, auth | — |
| PRD:AC-10 | Cross-client workspace access denied | not started | P0 · MC-P1 | Core | Workspace permissions | Unauthorized artifacts inaccessible | Auth, isolation | Same intent as BP:AC-08. |
| PRD:AC-11 | Restart keeps queued jobs; leases reconcile; no blind replay | not started | P0 · MC-P1 | Core | Durable queue | Restart test passes | Task store, leases | — |
| PRD:AC-12 | Inadequate output keeps task awaiting review/blocked | not started | P0 · MC-P1 | Core | Task definition of done | Task not closed without criteria | TASK-04 | — |

## Ledger — `BP` (Mission Control blueprint)

| ID | Requirement (summary) | Status | Phase | Focus | Source of truth | Acceptance check | Dependency | Clarification |
|---|---|---|---|---|---|---|---|---|
| BP:MC-01 | Portfolio/requirements registry with separate launch/merge/deploy/flag/acceptance fields | partial | P0 · MC-P0 | NGM + LH | Project records + this ledger | Each project row has a named source and checked-at | Owner confirms first-version portfolio | Project radar UI exists with **synthetic UNVERIFIED rows**; real NGM/Launchhost rows not loaded. |
| BP:MC-02 | Agent board (Hermes, Claude, Codex) with observed process/lease and staleness | partial | P0 · MC-P0 | Core | VPS exporter via `/api/mission-control/agents` | States never collapse; STALE/UNKNOWN on lost heartbeat | Exporter deployed on VPS; PC verification | Process observation only; no task/run IDs or leases; no assignment inference. PC setup unverified here. |
| BP:MC-03 | Owner inbox with exact target, before/after, age; payload-bound approval | partial | P0 · MC-P0 | NGM + LH | Approval/decision records | Real decisions listed oldest first with source | Decision source, auth for approval | UI with synthetic rows only; approval intentionally absent. |
| BP:MC-04 | Evidence shelf: Drive docs, PR heads, test runs, previews; review/CI/deploy kept distinct | partial | P0 · MC-P0 | LH | `/api/mission-control/evidence` (Hermes, GitHub, Drive) | Each source shows live/unavailable separately; PR state never shown as deploy | Evidence backend (separate worker), PC verification | **This branch:** Live evidence UI with client-side validation, safe links, held/STALE handling. Backend not in this branch; not linked to tasks. |
| BP:MC-05 | Safe read-only connectors with source/checked_at/stale_after per datum | partial | P0 · MC-P0 | Core | Same-origin read-only routes | Failed read keeps last success and goes stale | Backend connectors, credentials kept server-side | Agents route exists; evidence UI consumes a route built separately; coverage/confidence fields not in the evidence contract. |
| BP:MC-06 | Guardrails: owner login, private network, isolation, redaction, audit, deny-by-default | partial | P0 · MC-P0 | Core | Auth + policy layer | BP:AC-09 passes on a private test instance | Security foundation work | Only the local-only posture and the absence of controls on MC apply. **Security gate not passed.** Dispatch stays off while the coordinator is paused. |
| BP:MC-07 | One-minute mobile view, accessible, keyboard, high contrast | partial | P0 · MC-P0 | Core | Rendered page | BP:AC-01 on a phone | Live sources for real content | Layout, jump nav, text-labelled states and keyboard focus are unit-tested; not phone-tested on the PC. |
| BP:MC-08 | NGM funnel split by path with denominators/windows; duplicate-touch flags | not started | P1 · MC-P1 | NGM | iClosed + campaign reads | Each tile has a fresh source read | Read connectors, owner target | Same scope as ACR:SCORE-1/2 and ACR:MAP-1/2. |
| BP:MC-09 | Launchhost release-gate board; green CI ≠ deploy approval; scope-decision gates | not started | P1 · MC-P1 | LH | Release-readiness register + GitHub checks | BP:AC-04 | Register publication, owner scope decision | Evidence UI already labels PR/check state as not a deploy or release approval. |
| BP:MC-10 | Controlled delegation and recovery with locks, leases, idempotency | not started | P1 · MC-P1 | Core | Task/run store | BP:AC-03, BP:AC-07 | PRD:TASK-03/05 | Pausing future dispatch must not claim rollback. |
| BP:MC-11 | Connected approvals with narrow standing policies | not started | P1 · MC-P1 | Core | Policy store | BP:AC-06 | Auth, CTRL-02/03 | — |
| BP:AC-01 | Phone: identify decisions, active/paused agents, biggest blocker in a minute; source + timestamp on each | partial | P0 · MC-P0 | Core | Rendered page | Owner performs the check on a phone against live sources | Real inbox/radar sources | Every status has a source tag and timestamp (tested); content is still demo except agents/evidence. |
| BP:AC-02 | Pause coordinator → UI shows paused, no new dispatch, runs not falsely cancelled (simulator) | partial | P0 · MC-P0 | LH | Exporter coordinator schedule read | Simulator test only; never resume the production coordinator | Exporter coordinator config on VPS | Exporter can report a configured coordinator as paused (read-only). No dispatch or pause control; simulator test not run. |
| BP:AC-03 | Kill an observed process → run unknown/interrupted; prior assignment survives | partial | P0 · MC-P0 | Core | Adapter events + leases | Simulated kill yields unknown/interrupted | Leases, assignment records | Reducer handles lease expiry (unit-tested); process board has no assignments to preserve. |
| BP:AC-04 | PR with green CI but no merge/deploy → release gate stays blocked | not started | P1 · MC-P1 | LH | Release gates + GitHub | Gate remains blocked | BP:MC-09 | Evidence UI copy states a green check is not a release approval; no gate board. |
| BP:AC-05 | Expire connector/stop refresh → stale/unavailable, never zero or healthy | partial | P0 · MC-P0 | Core | Source timestamps | Stopped refresh on PC shows STALE/UNAVAILABLE | Live backends | Unit-tested for agent board and evidence (503, malformed, held, aging); PC unverified. |
| BP:AC-06 | Changed payload after review → old approval cannot execute | not started | P1 · MC-P1 | Core | Approval records | Old approval rejected | BP:MC-11 | — |
| BP:AC-07 | Retry uncertain write → no duplicate | not started | P1 · MC-P1 | Core | External IDs | Reconciliation prevents duplicate | BP:MC-10 | — |
| BP:AC-08 | Cross-client artifact access denied and audited | not started | P1 · MC-P1 | Core | Workspace permissions + audit | Denial recorded | Auth, isolation | Same intent as PRD:AC-10. |
| BP:AC-09 | On a private test instance, every state-changing route rejects unauthenticated requests; flags behave | not started | P0 · MC-P0 | Core | Route-by-route access tests | All write routes reject unauthenticated requests | Security foundation (separate branch, not in this base) | **Gate for any exposure.** A passing UI smoke test is not this proof. |

## Owner decisions still open

These come from the source documents and are not pre-filled as approved.

1. **Build base and preview location:** PatterStage is the working base and the PC-local preview is selected; any later private hosting needs a separate security decision.
2. **First-version portfolio:** NGM + Launchhost is the working focus. Is TherapySites.ai distinct from Launchhost?
3. **Policy and limits:**
   - Action/approval policy.
   - Cost ceiling.
   - Target cost per qualified booked call.
   - Whether client ad accounts appear in the hub.
5. **Draft reconciliation:** how ACR and PRD should be reconciled. Until the owner decides, both stay recorded here side by side.
