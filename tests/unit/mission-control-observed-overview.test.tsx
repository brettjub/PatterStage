/** @jest-environment jsdom */

/**
 * Mission Control — observed-only runtime overview. The `/mission-control`
 * client renders only what the same-origin agents and evidence routes
 * returned: no fixture rows, no fabricated inbox/project/approval/cost
 * data, NOT CONNECTED where no authoritative source exists, and an
 * "Observed artifacts" shelf for Drive/GitHub evidence. Mocked fetch,
 * fixed clock; no real network.
 */

import { readFileSync } from "fs";
import { act, render, screen, within } from "@testing-library/react";
import OwnerOverview from "@/components/mission-control/OwnerOverview";
import MissionControlClient from "@/components/mission-control/MissionControlClient";
import { buildObservedSnapshot } from "@/components/mission-control/observed-snapshot";
import {
  applyPollFailure,
  applyPollSuccess,
  INITIAL_LIVE_AGENTS_STATE,
  LIVE_AGENTS_ROUTE,
  mergeLiveAgents,
  parseLiveAgentsResponse,
  type LiveAgentsState,
} from "@/components/mission-control/live-agents";
import {
  applyEvidenceFailure,
  applyEvidenceSuccess,
  EVIDENCE_ROUTE,
  EVIDENCE_STALE_AFTER_MINUTES,
  INITIAL_LIVE_EVIDENCE_STATE,
  parseEvidenceResponse,
  withEvidenceMode,
  type LiveEvidenceState,
} from "@/components/mission-control/live-evidence";

jest.mock("@/components/mission-control/demo-fixture", () => ({
  buildDemoSnapshot: jest.fn(() => {
    throw new Error("buildDemoSnapshot must not be called at runtime");
  }),
}));

const NOW = Date.parse("2030-01-15T12:00:00.000Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const AGENT_SOURCE = "VPS process exporter (test)";
const DRIVE_MODIFIED = "2030-01-10T08:30:00Z";

function agentsBody(checkedAt = iso(NOW)) {
  return {
    schemaVersion: 1,
    checkedAt,
    source: AGENT_SOURCE,
    agents: [
      {
        id: "a1",
        name: "agent-a1",
        runtime: "hermes",
        availability: "running",
        run: null,
        stamp: { source: AGENT_SOURCE, kind: "live", checkedAt, staleAfterMinutes: 1 },
      },
    ],
  };
}

function driveDoc(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `drive-${n}`,
    kind: "document",
    title: `Observed file ${n}`,
    status: "modified",
    observedAt: DRIVE_MODIFIED,
    url: `https://drive.google.com/file/d/file${n}/view`,
    note: "application/pdf",
    ...extra,
  };
}

function githubPr(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `pr-${n}`,
    kind: "pull_request",
    title: `Observed PR ${n}`,
    status: "open · CI passing · deployment unverified",
    observedAt: iso(NOW),
    url: `https://github.com/brettjub/PatterStage/pull/${n}`,
    project: "PatterStage",
    ...extra,
  };
}

type SourceJson = { id: string; status: string; checkedAt: string | null; items: unknown[] };

function evidenceSources(
  overrides: Partial<Record<"hermes" | "github" | "drive", Partial<SourceJson>>> = {}
): SourceJson[] {
  return [
    { id: "hermes", status: "unavailable", checkedAt: null, items: [], ...overrides.hermes },
    { id: "github", status: "live", checkedAt: iso(NOW), items: [], ...overrides.github },
    { id: "drive", status: "live", checkedAt: iso(NOW), items: [1, 2, 3, 4, 5].map((n) => driveDoc(n)), ...overrides.drive },
  ];
}

function evidenceBody(src: unknown[] = evidenceSources()) {
  return { schemaVersion: 1, checkedAt: iso(NOW), sources: src };
}

function evidenceOk(src: unknown[] = evidenceSources()): LiveEvidenceState {
  const parsed = parseEvidenceResponse(evidenceBody(src));
  if (!parsed.ok) throw new Error(parsed.error);
  return applyEvidenceSuccess(INITIAL_LIVE_EVIDENCE_STATE, parsed.observation);
}

function agentsOk(): LiveAgentsState {
  const parsed = parseLiveAgentsResponse(agentsBody());
  if (!parsed.ok) throw new Error(parsed.error);
  return applyPollSuccess(INITIAL_LIVE_AGENTS_STATE, parsed.observation);
}

function renderObserved(live: LiveAgentsState, evidence: LiveEvidenceState, nowMs = NOW) {
  const snapshot = withEvidenceMode(mergeLiveAgents(buildObservedSnapshot(NOW), live), evidence);
  return render(<OwnerOverview snapshot={snapshot} nowMs={nowMs} live={live} evidence={evidence} />);
}

function shelfSource(id: string): HTMLElement {
  const el = screen.getAllByTestId("mc-artifact-source").find((s) => s.dataset.sourceId === id);
  if (!el) throw new Error(`artifact source ${id} missing`);
  return el;
}

const FIXTURE_TEXT = /Example|Simulated|Demo agent|\bdemo\b|synthetic/i;
const FABRICATED_ZEROES = /\b0 open\b|none recorded|none reported|No run assigned|\$\s?\d/;

describe("observed snapshot", () => {
  it("is an explicit observed mode that carries no records of its own", () => {
    const snap = buildObservedSnapshot(NOW);
    expect(snap.mode).toBe("observed");
    expect(snap.inbox).toEqual([]);
    expect(snap.projects).toEqual([]);
    expect(snap.agents).toEqual([]);
    expect(snap.deliverables.items).toEqual([]);
    expect(snap.risks).toEqual([]);
  });

  it("stays observed when live agents or evidence arrive (never mixed, demo or live)", () => {
    const merged = withEvidenceMode(mergeLiveAgents(buildObservedSnapshot(NOW), agentsOk()), evidenceOk());
    expect(merged.mode).toBe("observed");
    expect(merged.agents).toHaveLength(1);
    expect(mergeLiveAgents(buildObservedSnapshot(NOW), INITIAL_LIVE_AGENTS_STATE).mode).toBe("observed");
  });
});

describe("OwnerOverview — observed mode, connected", () => {
  it("states partial coverage truthfully — not demo, not fully live", () => {
    renderObserved(agentsOk(), evidenceOk());
    const banner = screen.getByTestId("mc-source-banner");
    expect(banner.dataset.mode).toBe("observed");
    expect(banner.dataset.coverage).toBe("partial");
    expect(banner).toHaveTextContent("OBSERVED DATA ONLY · PARTIAL COVERAGE");
    expect(banner).toHaveTextContent("Owner inbox and project radar: NOT CONNECTED");
    expect(banner).toHaveTextContent("Agent processes: LIVE");
    expect(banner).toHaveTextContent("GitHub PRs: LIVE");
    expect(banner).toHaveTextContent("Drive files: LIVE");
    expect(banner).toHaveTextContent("Hermes schedule: UNAVAILABLE");
    expect(screen.queryByTestId("mc-demo-banner")).toBeNull();
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(
      /^3 of 4 observed sources live · 1 not currently live \(unknown, unavailable, held or stale\) · 2 panels not connected$/
    );
  });

  it("renders no fixture rows, no fabricated statuses and no zero placeholders", () => {
    const { container } = renderObserved(agentsOk(), evidenceOk());
    expect(container.textContent).not.toMatch(FIXTURE_TEXT);
    expect(container.textContent).not.toMatch(FABRICATED_ZEROES);
    expect(screen.queryAllByTestId("mc-inbox-item")).toHaveLength(0);
    expect(screen.queryAllByTestId("mc-project-row")).toHaveLength(0);
    expect(screen.queryByTestId("mc-deliverables-empty")).toBeNull();
    expect(screen.queryByText(/Approve \/ reject/)).toBeNull();
  });

  it("shows owner inbox and project radar as NOT CONNECTED / UNKNOWN with no records", () => {
    renderObserved(agentsOk(), evidenceOk());
    expect(screen.getByTestId("mc-inbox-not-connected")).toHaveTextContent(
      "NOT CONNECTED — no authoritative owner-inbox source exists yet"
    );
    expect(screen.getByTestId("mc-radar-not-connected")).toHaveTextContent(
      "NOT CONNECTED — no authoritative project source exists yet"
    );
    expect(screen.getByTestId("mc-summary-needs")).toHaveTextContent("NOT CONNECTED — unknown");
    expect(screen.getByTestId("mc-summary-blocker")).toHaveTextContent("UNKNOWN — no project source connected");
    expect(screen.getByTestId("mc-summary-agents")).toHaveTextContent("1 running");
  });

  it("lists the five Drive files as observed artifacts with source timestamps", () => {
    renderObserved(agentsOk(), evidenceOk());
    const shelf = document.getElementById("observed-artifacts")!;
    expect(shelf).toHaveTextContent("Observed artifacts");
    expect(shelf).toHaveTextContent("not completed deliverables");
    expect(shelf).toHaveTextContent("not linked to any task");
    const drive = shelfSource("drive");
    expect(drive.dataset.display).toBe("live");
    const items = within(drive).getAllByTestId("mc-evidence-item");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("5d ago (2030-01-10 08:30 UTC)");
    expect(items[0]).toHaveTextContent("application/pdf");
    expect(within(drive).getByTestId("mc-evidence-source-checked")).toHaveTextContent(
      "checked just now (2030-01-15 12:00 UTC)"
    );
    // Live evidence stays a separate, live section.
    expect(document.getElementById("live-evidence")).not.toBeNull();
    expect(screen.getByTestId("mc-evidence-connector").dataset.connector).toBe("connected");
  });

  it("orders jump links to sections that exist in observed mode", () => {
    renderObserved(agentsOk(), evidenceOk());
    const nav = screen.getByRole("navigation", { name: "Owner overview sections" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Owner inbox",
      "Agents",
      "Live evidence",
      "Projects",
      "Observed artifacts",
    ]);
    for (const link of within(nav).getAllByRole("link")) {
      expect(document.getElementById(link.getAttribute("href")!.slice(1))?.tagName).toBe("SECTION");
    }
  });
});

describe("OwnerOverview — observed mode, empty live GitHub", () => {
  it("says GitHub returned 0 pull requests while live — not none, not unknown", () => {
    renderObserved(agentsOk(), evidenceOk());
    const gh = shelfSource("github");
    expect(gh.dataset.display).toBe("live");
    expect(within(gh).queryAllByTestId("mc-evidence-item")).toHaveLength(0);
    expect(within(gh).getByTestId("mc-artifact-source-empty")).toHaveTextContent(
      "Source live — this bounded query returned 0 items."
    );
  });

  it("lists GitHub PRs with their state when the source returns some", () => {
    renderObserved(agentsOk(), evidenceOk(evidenceSources({ github: { items: [githubPr(7)] } })));
    const item = within(shelfSource("github")).getByTestId("mc-evidence-item");
    expect(item).toHaveTextContent("Observed PR 7");
    expect(item).toHaveTextContent("deployment unverified");
  });
});

describe("OwnerOverview — observed mode, not connected", () => {
  it("shows NOT CONNECTED / UNKNOWN when both connectors fail — never demo", () => {
    const { container } = renderObserved(
      applyPollFailure(INITIAL_LIVE_AGENTS_STATE, "HTTP 503"),
      applyEvidenceFailure(INITIAL_LIVE_EVIDENCE_STATE, "HTTP 503")
    );
    const banner = screen.getByTestId("mc-source-banner");
    expect(banner.dataset.coverage).toBe("none");
    expect(banner).toHaveTextContent("NOT CONNECTED · STATE UNKNOWN");
    expect(container.textContent).not.toMatch(FIXTURE_TEXT);
    expect(container.textContent).not.toMatch(FABRICATED_ZEROES);
    expect(screen.queryAllByTestId("mc-agent-row")).toHaveLength(0);
    expect(screen.queryAllByTestId("mc-evidence-item")).toHaveLength(0);
    expect(screen.queryByText(/returned 0 items/)).toBeNull();
    for (const s of screen.getAllByTestId("mc-artifact-source")) {
      expect(s.dataset.display).toBe("unknown");
      expect(within(s).getByTestId("mc-artifact-source-empty")).toHaveTextContent("Not connected — state unknown.");
    }
    expect(screen.getByTestId("mc-summary-agents")).toHaveTextContent("NOT CONNECTED — state unknown");
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(/^0 of 4 observed sources live/);
  });

  it("shows CONNECTING (unknown) before the first poll settles", () => {
    renderObserved(INITIAL_LIVE_AGENTS_STATE, INITIAL_LIVE_EVIDENCE_STATE);
    const banner = screen.getByTestId("mc-source-banner");
    expect(banner.dataset.coverage).toBe("none");
    expect(banner).toHaveTextContent("CONNECTING · STATE UNKNOWN");
  });

  it("reports an unavailable source as unavailable, not zero", () => {
    renderObserved(agentsOk(), evidenceOk(evidenceSources({ drive: { status: "unavailable", checkedAt: null, items: [] } })));
    const drive = shelfSource("drive");
    expect(drive.dataset.display).toBe("unavailable");
    expect(within(drive).getByTestId("mc-artifact-source-empty")).toHaveTextContent("not zero");
    expect(screen.getByTestId("mc-source-banner")).toHaveTextContent("Drive files: UNAVAILABLE");
  });
});

describe("OwnerOverview — observed mode, held and stale", () => {
  it("qualifies a held agent count as last reported, not currently running", () => {
    renderObserved(applyPollFailure(agentsOk(), "connector disabled"), evidenceOk(), NOW + 30_000);
    expect(screen.getByTestId("mc-summary-agents")).toHaveTextContent("HELD — last reported: 1 running");
  });

  it("keeps held artifacts with their timestamps and never shows them as LIVE or zero", () => {
    const held = applyEvidenceFailure(evidenceOk(), "evidence bridge disabled");
    const heldAgents = applyPollFailure(agentsOk(), "connector disabled");
    renderObserved(heldAgents, held, NOW + 2 * MIN);
    const banner = screen.getByTestId("mc-source-banner");
    expect(banner.dataset.coverage).toBe("held");
    expect(banner).toHaveTextContent("NO CURRENT SOURCE");
    expect(banner).not.toHaveTextContent(/: LIVE/);
    const drive = shelfSource("drive");
    expect(drive.dataset.display).toBe("held");
    expect(within(drive).getAllByTestId("mc-evidence-item")).toHaveLength(5);
    expect(within(drive).getByTestId("mc-evidence-source-state")).toHaveTextContent("HELD — LAST POLL FAILED");
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(/^0 of 4 observed sources live/);
    // GitHub was live with 0 items; held must not restate that as a current zero.
    expect(within(shelfSource("github")).getByTestId("mc-artifact-source-empty")).toHaveTextContent(
      "The last successful check returned 0 items."
    );
  });

  it("turns held artifacts STALE as the clock moves", () => {
    const held = applyEvidenceFailure(evidenceOk(), "evidence bridge disabled");
    renderObserved(agentsOk(), held, NOW + (EVIDENCE_STALE_AFTER_MINUTES + 5) * MIN);
    const drive = shelfSource("drive");
    expect(drive.dataset.display).toBe("stale");
    expect(within(drive).getByTestId("mc-evidence-source-checked")).toHaveTextContent(
      "STALE — last success 15m ago (2030-01-15 12:00 UTC)"
    );
    expect(within(drive).getAllByTestId("mc-evidence-item")).toHaveLength(5);
    expect(screen.getByTestId("mc-source-banner")).toHaveTextContent("Drive files: STALE");
  });
});

describe("OwnerOverview — observed mode, links and safety", () => {
  it("links only prevalidated https evidence hosts, opened safely; withholds unsafe URLs", () => {
    const evidence = evidenceOk(
      evidenceSources({
        github: { items: [githubPr(1), githubPr(2, { url: "https://evil.example/pull/2" })] },
        drive: { items: [driveDoc(1), driveDoc(2, { url: "javascript:alert(1)" })] },
      })
    );
    const { container } = renderObserved(agentsOk(), evidence);
    const shelf = document.getElementById("observed-artifacts")!;
    const links = within(shelf).getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      const url = new URL(link.getAttribute("href")!);
      expect(url.protocol).toBe("https:");
      expect(["github.com", "drive.google.com", "docs.google.com"]).toContain(url.hostname);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAttribute("target", "_blank");
    }
    expect(within(shelf).getAllByTestId("mc-evidence-link-withheld")).toHaveLength(2);
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href")!;
      if (href.startsWith("#")) continue;
      expect(href).not.toMatch(/^\/|^http:|javascript:/);
    }
    expect(container.querySelector("form, input, textarea, select, button")).toBeNull();
  });
});

describe("MissionControlClient — observed runtime", () => {
  const realFetch = global.fetch;
  let agentsMock: jest.Mock;
  let evidenceMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    agentsMock = jest.fn();
    evidenceMock = jest.fn();
    global.fetch = ((url: string, init: RequestInit) =>
      url === EVIDENCE_ROUTE ? evidenceMock(url, init) : agentsMock(url, init)) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  const flush = () => act(async () => {});
  const json = (status: number, payload: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as unknown as Response;

  it("renders only route data and never builds the demo fixture", async () => {
    agentsMock.mockResolvedValue(json(200, agentsBody()));
    evidenceMock.mockResolvedValue(json(200, evidenceBody()));
    const { container } = render(<MissionControlClient />);
    await flush();
    const { buildDemoSnapshot } = jest.requireMock("@/components/mission-control/demo-fixture");
    expect(buildDemoSnapshot).not.toHaveBeenCalled();
    expect(agentsMock.mock.calls[0][0]).toBe(LIVE_AGENTS_ROUTE);
    expect(screen.getByTestId("mc-source-banner").dataset.coverage).toBe("partial");
    expect(within(shelfSource("drive")).getAllByTestId("mc-evidence-item")).toHaveLength(5);
    expect(container.textContent).not.toMatch(FIXTURE_TEXT);
  });

  it("shows NOT CONNECTED / UNKNOWN when both routes fail", async () => {
    agentsMock.mockResolvedValue(json(503, { error: "agents disabled" }));
    evidenceMock.mockResolvedValue(json(503, { error: "evidence disabled" }));
    const { container } = render(<MissionControlClient />);
    await flush();
    expect(screen.getByTestId("mc-source-banner")).toHaveTextContent("NOT CONNECTED · STATE UNKNOWN");
    expect(container.textContent).not.toMatch(FIXTURE_TEXT);
    expect(container.textContent).not.toMatch(FABRICATED_ZEROES);
  });

  it("does not import the demo fixture in the runtime client or route", () => {
    for (const file of ["src/components/mission-control/MissionControlClient.tsx", "src/app/mission-control/page.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/demo-fixture|buildDemoSnapshot/);
      expect(src).not.toMatch(/DEMO/);
    }
  });
});
