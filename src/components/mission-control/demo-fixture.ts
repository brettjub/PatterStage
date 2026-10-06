// ═══════════════════════════════════════════════════════════════
// Mission Control — DEMO fixture (synthetic, not connected, not live)
// ═══════════════════════════════════════════════════════════════
// Every row is a generic synthetic example that exercises a display
// state. None describes a real project, person, decision or process.
// No KPIs, prices, counts or connector states appear here.
// The fixture agents are only for rendering the pure component; the
// page replaces them with the live process observation (or nothing).

import type { OwnerOverviewSnapshot, SourceStamp } from "./types";

const MINUTE_MS = 60_000;

const FIXTURE_SOURCE = "Demo fixture (src/components/mission-control/demo-fixture.ts)";
const SYNTHETIC_SOURCE = "Synthetic example — no source connected";

/** Simulated timestamps are generated relative to `nowMs` so every freshness state is visible. */
export function buildDemoSnapshot(nowMs: number): OwnerOverviewSnapshot {
  const ago = (minutes: number) => new Date(nowMs - minutes * MINUTE_MS).toISOString();
  const simulated = (minutesAgo: number, staleAfterMinutes: number): SourceStamp => ({
    source: FIXTURE_SOURCE,
    kind: "demo",
    checkedAt: ago(minutesAgo),
    staleAfterMinutes,
  });
  const neverChecked = (source: string): SourceStamp => ({
    source,
    kind: "demo",
    checkedAt: null,
    staleAfterMinutes: 24 * 60,
  });
  const notConnected = (source: string): SourceStamp => ({
    source,
    kind: "not_connected",
    checkedAt: null,
    staleAfterMinutes: 24 * 60,
  });

  return {
    mode: "demo",
    generatedAt: ago(0),
    inbox: [
      {
        id: "demo-inbox-scope",
        kind: "decision",
        title: "Example decision: settle the release scope for Example project Alpha",
        project: "Example project Alpha",
        target: "Example scope register (synthetic)",
        impact: "Example only — shows a decision that blocks evaluating release gates.",
        createdAt: ago(6 * 24 * 60),
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
      {
        id: "demo-inbox-budget",
        kind: "decision",
        title: "Example decision: approve or defer an infrastructure budget",
        project: "Example project Alpha",
        target: "Example budget line (synthetic, no amount)",
        impact: "Example only — no spend or release is implied.",
        createdAt: ago(4 * 24 * 60),
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
      {
        id: "demo-inbox-backlogs",
        kind: "decision",
        title: "Example decision: merge two overlapping backlogs or keep them separate",
        project: "Example project Beta",
        target: "Example backlog registry (synthetic)",
        impact: "Example only — backlogs stay separate until decided.",
        createdAt: ago(2 * 24 * 60),
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
      {
        id: "demo-inbox-integration",
        kind: "decision",
        title: "Example decision: confirm an integration map before enabling automation",
        project: "Example project Gamma",
        target: "Example integration map (synthetic, not connected)",
        impact: "Example only — duplicate automated touches cannot be ruled out until mapped.",
        createdAt: ago(26 * 60),
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
      {
        id: "demo-inbox-sim-approval",
        kind: "approval",
        title: "Simulated approval request (example row only)",
        project: "Example project Beta",
        target: "Example payload — no real change is attached",
        impact: "Shows how an approval would be listed. Approving is not possible here.",
        createdAt: ago(3 * 60),
        stamp: simulated(3 * 60, 24 * 60),
      },
    ],
    agents: [
      {
        id: "demo-agent-a",
        name: "Demo agent A",
        runtime: "Example runtime",
        availability: "running",
        run: {
          taskLabel: "Simulated task: draft weekly brief",
          runState: "running",
          project: "Example project Beta",
          worktree: "demo/worktree-a",
        },
        stamp: simulated(2, 15),
      },
      {
        id: "demo-agent-b",
        name: "Demo agent B",
        runtime: "Example runtime",
        availability: "idle",
        run: null,
        stamp: simulated(4, 15),
      },
      {
        id: "demo-agent-c",
        name: "Demo agent C",
        runtime: "Example runtime",
        availability: "idle",
        run: {
          taskLabel: "Simulated task: lint fix",
          runState: "succeeded",
          project: "Example project Alpha",
        },
        note: "Heartbeat older than its threshold — last reported idle is no longer trusted.",
        stamp: simulated(3 * 60, 30),
      },
      {
        id: "demo-agent-d",
        name: "Demo dispatcher",
        runtime: "Example coordinator",
        availability: "paused",
        run: null,
        note: "Future dispatch paused. Pausing does not cancel or roll back in-flight work.",
        stamp: simulated(6, 60),
      },
      {
        id: "demo-agent-e",
        name: "Demo agent E",
        runtime: "Example subagent",
        availability: "unknown",
        run: {
          taskLabel: "Simulated task: research notes",
          runState: "interrupted",
          project: "Example project Beta",
        },
        note: "No heartbeat on record — run shown as interrupted, not completed.",
        stamp: neverChecked(FIXTURE_SOURCE),
      },
    ],
    projects: [
      {
        id: "example-alpha",
        name: "Example project Alpha",
        outcome: "Synthetic example: ship a customer-facing release",
        recordedState: "active",
        position: "Synthetic row illustrating a project with a recorded blocker.",
        blocker: "Example blocker: release gates are not yet defined (synthetic, not a real status).",
        nextMove: "Example: owner defines release gates. Nothing here authorizes a merge or deploy.",
        verification: "unverified",
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
      {
        id: "example-beta",
        name: "Example project Beta",
        outcome: "Synthetic example: internal tooling improvement",
        recordedState: "active",
        position: "Synthetic row illustrating an active project without a blocker.",
        nextMove: "Example: review the next draft deliverable.",
        verification: "unverified",
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
      {
        id: "example-gamma",
        name: "Example project Gamma",
        outcome: "Synthetic example: automation pilot",
        recordedState: "paused",
        position: "Synthetic row illustrating a paused project.",
        nextMove: "Example: resume only after the integration map decision.",
        verification: "unverified",
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
      {
        id: "example-delta",
        name: "Example project Delta",
        outcome: "Synthetic example: project whose state was never recorded",
        recordedState: "unknown",
        position: "Synthetic row illustrating an unknown state.",
        nextMove: "Example: confirm whether this is active or paused.",
        verification: "unverified",
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
      {
        id: "example-ideas",
        name: "Example ideas",
        outcome: "Synthetic example: parked concepts",
        recordedState: "idea",
        position: "Ideas, not commitments.",
        nextMove: "Example: stay parked unless promoted with a success test.",
        verification: "unverified",
        stamp: neverChecked(SYNTHETIC_SOURCE),
      },
    ],
    deliverables: {
      stamp: notConnected("Evidence shelf (not connected)"),
      items: [],
    },
    risks: [
      {
        id: "risk-demo-panels",
        label: "Business panels are demo only",
        detail:
          "Owner inbox, projects and deliverables are synthetic fixture data. At most the agent board shows a live process observation, and only while its connector is up.",
        severity: "warning",
        stamp: simulated(0, 24 * 60),
      },
      {
        id: "risk-spend-unknown",
        label: "Agent spend unavailable",
        detail: "Usage and cost are not reported by any source. Unknown is not $0.",
        severity: "info",
        stamp: notConnected("Cost / usage source"),
      },
    ],
  };
}
