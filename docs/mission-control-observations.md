# Mission Control observation foundation

This slice is a pure TypeScript contract and reducer in `src/lib/mission-control/observations.ts`. It does not poll, read files, inspect processes, dispatch work, enforce permissions or expose HTTP. All tests use synthetic fixtures. Dated statuses in the requirements are historical evidence, not a seed of live agents.

## Contract and adapter example

A future adapter supplies one `AdapterObservation` per agent/source, including schema version, stable event ID, explicit evidence time, polling completion time, last successful refresh, freshness threshold and connector coverage/confidence. Callers supply `now` and the previous result for that same agent/runtime/source. Re-evaluate retained evidence even when polling is missed; time alone can make it stale.

```ts
import { normalizeObservation, type AdapterObservation } from '@/lib/mission-control/observations';

const synthetic: AdapterObservation = {
  schemaVersion: 1,
  eventId: 'synthetic-event-1',
  agentId: 'synthetic-codex-worker',
  runtime: 'codex',
  source: 'fixture:runtime-adapter',
  checkedAt: '2026-10-06T21:30:00Z',
  observedAt: '2026-10-06T21:30:00Z',
  lastSuccessfulAt: '2026-10-06T21:30:00Z',
  staleAfterMs: 60_000,
  evidenceRef: 'fixture:event-1',
  connector: { status: 'ok', coverage: 'complete', confidence: 'observed' },
  availability: 'running',
  runState: 'running',
  taskState: 'in_progress',
  assignment: {
    taskId: 'synthetic-task-1', runId: 'synthetic-run-1',
    provenance: {
      kind: 'lease', id: 'synthetic-lease-1',
      evidenceRef: 'fixture:lease-1',
      observedAt: '2026-10-06T21:30:00Z',
      expiresAt: '2026-10-06T21:31:00Z',
    },
  },
};
const observation = normalizeObservation(synthetic, '2026-10-06T21:30:10Z');
// observation.currentAssignment is evidence-backed; usage is null, not zero.
const expired = normalizeObservation(synthetic, '2026-10-06T21:31:00Z', observation);
// expired.availability === 'stale'; runState === 'unknown';
// currentAssignment === null; historicalAssignment retains the lease evidence.
```

The adapter is a trusted typed boundary, not an arbitrary JSON validator. Validate provider payloads, schema versions, identifiers and redaction before constructing this input. Evidence references are opaque identifiers, not permission to fetch or render URLs. Registry metadata and control capabilities belong to later contracts; unsupported controls must remain unavailable.

## State and freshness rules

| Dimension | Semantics |
| --- | --- |
| Availability | `running`, `idle`, `paused`, `offline`, `unknown`, `stale`; independent from task/run state |
| Run | `queued`, `running`, `waiting_for_approval`, `succeeded`, `failed`, `cancelled`, `interrupted`, `unknown` |
| Task | `backlog`, `ready`, `in_progress`, `awaiting_review`, `completed`, `blocked`, `cancelled`, `unknown` |
| Connector | `ok`, `partial`, `failed`, plus coverage, confidence and optional diagnostic |
| Evidence | source, checkedAt, lastSuccessfulAt, observedAt, optional expiresAt and evidenceRef |

Freshness is measured from the evidence's `observedAt`, never extended by merely checking an old record again. Expiry is inclusive. Invalid thresholds/expiry fail conservatively. Missing, malformed, future or inconsistent observation timestamps cannot establish current status. Input timestamps require explicit RFC3339 offsets; valid offsets normalize to UTC. `checkedAt` is the latest valid polling completion, while `lastSuccessfulAt` refers to the retained accepted evidence. Partial coverage may retain new evidence, but does not establish a current assignment or healthy availability. Failed polls cannot overwrite last accepted evidence. A partial successful read can advance lastSuccessfulAt without implying a complete healthy refresh.

Older and same-time events cannot overwrite accepted source evidence. Same-time duplicates/conflicts are flagged and retain the first accepted event; no claim of arbitrary-order conflict resolution or durable event deduplication is made. Callers must serialize events per source. Source changes require separate history. No cross-source fusion is performed.

When evidence expires or a connector fails, the current run/task projection becomes unknown, including previously terminal states; the original states remain in `lastKnown`. No missing poll becomes idle, completed or succeeded. An observed offline state remains offline while fresh, and cannot show a current assignment. Pause of availability does not imply run cancellation. The last validated run/lease assignment survives in `historicalAssignment` when it stops being current. Labels and branch names never generate assignments. Assignment evidence has its own freshness check; a run provenance ID must match the run ID. This module validates provenance shape but cannot independently verify a provider's assertion. Lease expiry removes current work and makes the projected run unknown.

Missing usage is null; invalid numbers are omitted, observed zero is preserved, currencies are explicit. Retained usage is historical source evidence when status is stale; consumers must show its freshness rather than present it as a current metric. No cost is estimated from elapsed time or model names.

All valid stored timestamps are canonical UTC; `lastKnown` retains malformed optional timestamp strings as diagnostic evidence. Consumers use the normalized projection for display. Owner display uses `formatOwnerTimestamp` with `America/Edmonton`, including daylight saving changes. This uses the configured owner's timezone rather than an unrelated planning draft's default. This module does not implement schedule recurrence or UTC-schedule warnings.

## Current API access boundary (risk note)

References describe the inspected source at base `7b9d6d6856386e6e3e39a30edb8cf6596a7f9417`; this is not a running-instance security audit and this change does not secure the app.

- [`src/lib/api-auth.ts:105`](../src/lib/api-auth.ts#L105): `requireAuth` ignores the request and delegates to `requireNotReadOnly`. Its explicit warning is at lines 90–103. [`requireNotReadOnly`, line 67](../src/lib/api-auth.ts#L67) checks `CH_READ_ONLY`; it does not verify identity or workspace authorization. Read-only mode is not a global authentication wall.
- [`requireSignedRequest`, lines 35–55](../src/lib/api-auth.ts#L35): optional HMAC is bypassed when `CH_REQUEST_SIGNING_SECRET` is absent. It signs method, pathname and timestamp, with a five-minute tolerance; it does not bind the request body or provide a replay ledger. The inspected call site is [`POST /api/update`, lines 262–273](../src/app/api/update/route.ts#L262), alongside read-only and deploy-enabled checks. This is specific-flow protection, not authentication for every route.
- [`GET /api/agents`, lines 15–64](../src/app/api/agents/route.ts#L15) has no auth guard and returns process identifiers, model and activity after starting the sync layer. It reads `last_seen_at` but omits it from its response. [`GET /api/monitor`, lines 53–55](../src/app/api/monitor/route.ts#L53) uses the read-only guard, and [lines 151–158](../src/app/api/monitor/route.ts#L151) specify public caching. Neither establishes owner identity.
- Sensitive routes require individual review: config [GET/PUT at lines 115/134](../src/app/api/config/route.ts#L115), credentials [GET/POST at lines 17/29](../src/app/api/credentials/route.ts#L17), behavior files [GET/PUT at lines 111/177](../src/app/api/agent/files/[key]/route.ts#L111), logs [GET/DELETE at lines 46/117](../src/app/api/logs/route.ts#L46), cron [GET/POST/PUT/DELETE at lines 149/182/347/466](../src/app/api/cron/route.ts#L149), missions [GET/POST at lines 131/166](../src/app/api/missions/route.ts#L131), and update [POST at line 262](../src/app/api/update/route.ts#L262). These examples use `requireAuth` and/or flow-specific flags, not a demonstrated global owner-access gate. This list is a review starting point, not an exhaustive route audit.

Before exposing process data, the owner must choose private hosting and authentication boundaries. Then implement and test identity/session protection, route-by-route authorization, workspace scoping, CSRF where applicable, response caching, secret/log redaction and deny-by-default writes. No HTTP endpoint or owner authentication scheme is included here.

## Requirements coverage and next steps

This supports the data semantics of MC-02/MC-05, TASK-02, AGENT-01/02/03 and OPS-01, and synthetic freshness/disconnection portions of blueprint AC-02/03/05. It does not satisfy end-to-end control or security acceptance: MC-06, AC-09, AGENT-04, CTRL-01/02 and REG/RUN/GUARD enforcement still require separate implementations. Registry purpose, permissions, dependency inventory, approval queues, action reconciliation and checkpoints remain future work. Historical assignments are evidence retention, not a durable checkpoint store.

Next: verify supported Hermes/Claude/Codex read interfaces in an explicitly scoped environment, define cadence and coverage per datum, map authoritative run/lease identity, and add a read-only adapter with redacted fixtures for disconnect/failure/reordering. Persist evidence and reconcile event identity before claiming live status. Keep dispatch disabled and preserve any existing coordinator pause. Complete the access-control gate and adversarial route tests before attaching an HTTP surface or production data.

## Local validation

- `npm ci` passed; npm reported 20 dependency vulnerabilities (2 low, 4 moderate, 13 high, 1 critical). Dependencies were not modified or remediated in this slice.
- Focused Jest: 27 synthetic tests passed.
- `npx tsc --noEmit -p tsconfig.json` passed.
- `npm run lint` passed with no warnings.
- Production build passed using `npm --ignore-scripts run build`, with `HERMES_HOME`/`AGENT_HOME` and `CH_DATA_DIR`/`CONTROL_HUB_DATA_DIR` explicitly pointed at synthetic `/tmp/patterstage-mc-synthetic-*` paths. Lifecycle hooks were intentionally skipped because ordinary `npm run build` invokes database/catalog seeding. An initial attempt without those path overrides was stopped during compilation and replaced with the isolated build.
- The build reported an existing Turbopack NFT tracing warning through `src/lib/hermes-profile-sync.ts` and `src/app/api/skills/[name]/route.ts`.

No network server, live adapter, authentication test instance or business-system integration was started. AC-09 is not tested or satisfied by this build.
