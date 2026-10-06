/**
 * Mission Control — freshness rules, fixture honesty and nav wiring.
 * Pure logic; no filesystem, network or Hermes access.
 */

import {
  assessFreshness,
  displayedAgentState,
  formatAge,
  formatUtc,
} from "@/components/mission-control/freshness";
import { buildDemoSnapshot } from "@/components/mission-control/demo-fixture";
import { mainSections } from "@/components/layout/sidebar-config";
import type { SourceStamp } from "@/components/mission-control/types";
import { APP_NAV_ROUTES, APP_MATRIX_ROUTES } from "../e2e/app-routes";

const NOW = Date.parse("2030-01-15T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const stamp = (checkedAt: string | null, staleAfterMinutes = 30): SourceStamp => ({
  source: "test",
  kind: "demo",
  checkedAt,
  staleAfterMinutes,
});

describe("assessFreshness", () => {
  it("is fresh within the threshold", () => {
    expect(assessFreshness(stamp(minutesAgo(10)), NOW)).toEqual({ state: "fresh", ageMinutes: 10 });
  });

  it("is fresh exactly at the threshold and stale just past it", () => {
    expect(assessFreshness(stamp(minutesAgo(30)), NOW).state).toBe("fresh");
    expect(assessFreshness(stamp(minutesAgo(31)), NOW).state).toBe("stale");
  });

  it("is unknown (never fresh) for missing, invalid or future timestamps", () => {
    expect(assessFreshness(stamp(null), NOW)).toEqual({ state: "unknown", ageMinutes: null });
    expect(assessFreshness(stamp("not-a-date"), NOW).state).toBe("unknown");
    expect(assessFreshness(stamp(new Date(NOW + 60_000).toISOString()), NOW).state).toBe("unknown");
  });

  it("tolerates a remote clock a few seconds ahead as age 0", () => {
    expect(assessFreshness(stamp(new Date(NOW + 5_000).toISOString(), 1), NOW)).toEqual({
      state: "fresh",
      ageMinutes: 0,
    });
    expect(assessFreshness(stamp(new Date(NOW + 31_000).toISOString(), 1), NOW).state).toBe("unknown");
  });
});

describe("displayedAgentState", () => {
  it("never shows a stale heartbeat as idle", () => {
    expect(displayedAgentState("idle", { state: "stale", ageMinutes: 200 })).toBe("stale");
  });

  it("shows unknown when no heartbeat exists, even if a state was reported", () => {
    expect(displayedAgentState("running", { state: "unknown", ageMinutes: null })).toBe("unknown");
  });

  it("passes through each availability when fresh", () => {
    for (const a of ["running", "idle", "paused", "blocked", "offline", "unknown"] as const) {
      expect(displayedAgentState(a, { state: "fresh", ageMinutes: 1 })).toBe(a);
    }
  });
});

describe("formatters", () => {
  it("formats ages and UTC deterministically", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(5)).toBe("5m ago");
    expect(formatAge(180)).toBe("3h ago");
    expect(formatAge(6 * 24 * 60)).toBe("6d ago");
    expect(formatUtc("2030-01-15T12:00:00.000Z")).toBe("2030-01-15 12:00 UTC");
  });
});

describe("demo fixture honesty", () => {
  const snap = buildDemoSnapshot(NOW);

  it("is demo mode and never claims a live source", () => {
    expect(snap.mode).toBe("demo");
    const kinds = [
      ...snap.inbox.map((i) => i.stamp.kind),
      ...snap.agents.map((a) => a.stamp.kind),
      ...snap.projects.map((p) => p.stamp.kind),
      snap.deliverables.stamp.kind,
      ...snap.risks.map((r) => r.stamp.kind),
    ];
    expect(kinds).not.toContain("live");
  });

  it("marks every project unverified with no successful check on record", () => {
    for (const p of snap.projects) {
      expect(p.verification).toBe("unverified");
      expect(p.stamp.checkedAt).toBeNull();
    }
  });

  it("names agents as demo agents, not real runtime observations", () => {
    for (const a of snap.agents) expect(a.name).toMatch(/^Demo /);
  });

  it("uses only generic synthetic project and inbox entries", () => {
    for (const p of snap.projects) {
      expect(p.name).toMatch(/^Example /);
      expect(p.outcome).toMatch(/^Synthetic example/);
    }
    for (const i of snap.inbox) {
      expect(i.title).toMatch(/^(Example|Simulated) /);
      expect(i.project).toMatch(/^Example /);
    }
    for (const a of snap.agents) expect(a.runtime).toMatch(/^Example /);
  });

  it("contains no currency figures or historical KPI counts", () => {
    const text = JSON.stringify(snap);
    // "$0" only appears in "Unknown is not $0"; any non-zero amount would be a reproduced price/spend.
    expect(text).not.toMatch(/\$[1-9]/);
    expect(text).not.toMatch(/\b\d+\s+leads\b/i);
  });
});

describe("navigation wiring", () => {
  it("adds a Mission Control sidebar link without replacing the dashboard", () => {
    const links = mainSections.flatMap((s) => s.links);
    expect(links.find((l) => l.href === "/")?.label).toBe("Dashboard");
    expect(links.find((l) => l.href === "/mission-control")?.label).toBe("Mission Control");
  });

  it("e2e nav matrix includes /mission-control", () => {
    expect(APP_NAV_ROUTES).toContain("/mission-control");
    expect(APP_MATRIX_ROUTES).toContain("/mission-control");
  });
});
