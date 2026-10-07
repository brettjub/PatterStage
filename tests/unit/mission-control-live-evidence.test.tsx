/** @jest-environment jsdom */

/**
 * Mission Control — live evidence section: response validation, URL safety,
 * poll-state transitions, freshness of held observations, truthful labelling,
 * keyboard/accessibility semantics and the independent polling loop
 * (mocked fetch, fake timers). No real network.
 */

import { act, render, screen, within } from "@testing-library/react";
import OwnerOverview from "@/components/mission-control/OwnerOverview";
import MissionControlClient from "@/components/mission-control/MissionControlClient";
import { buildDemoSnapshot } from "@/components/mission-control/demo-fixture";
import { LIVE_AGENTS_ROUTE, mergeLiveAgents, INITIAL_LIVE_AGENTS_STATE } from "@/components/mission-control/live-agents";
import {
  applyEvidenceFailure,
  applyEvidenceSuccess,
  EVIDENCE_POLL_MS,
  EVIDENCE_REQUEST_TIMEOUT_MS,
  EVIDENCE_ROUTE,
  EVIDENCE_STALE_AFTER_MINUTES,
  evidenceSourceDisplay,
  fetchLiveEvidence,
  INITIAL_LIVE_EVIDENCE_STATE,
  isIsoUtc,
  liveEvidenceSourceIds,
  parseEvidenceResponse,
  safeEvidenceUrl,
  withEvidenceMode,
  type LiveEvidenceState,
} from "@/components/mission-control/live-evidence";

const NOW = Date.parse("2030-01-15T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

function pr(id = "pr-1", extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "pull_request",
    title: `Example PR ${id}`,
    status: "open · checks passing",
    observedAt: iso(NOW),
    url: `https://github.com/example/repo/pull/${id.replace(/\D/g, "") || "1"}`,
    project: "example-repo",
    ...extra,
  };
}

function doc(id = "doc-1", extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "document",
    title: `Example document ${id}`,
    status: "modified",
    observedAt: iso(NOW),
    url: "https://docs.google.com/document/d/example/edit",
    ...extra,
  };
}

function hermesRun(id = "run-1", extra: Record<string, unknown> = {}) {
  return { id, kind: "run", title: `Example run ${id}`, status: "succeeded", observedAt: iso(NOW), ...extra };
}

type SourceJson = { id: string; status: string; checkedAt: string | null; items: unknown[] };

function sources(overrides: Partial<Record<"hermes" | "github" | "drive", Partial<SourceJson>>> = {}): SourceJson[] {
  return [
    { id: "hermes", status: "live", checkedAt: iso(NOW), items: [hermesRun()], ...overrides.hermes },
    { id: "github", status: "live", checkedAt: iso(NOW), items: [pr()], ...overrides.github },
    { id: "drive", status: "unavailable", checkedAt: null, items: [], ...overrides.drive },
  ];
}

function body(src: unknown[] = sources(), checkedAt = iso(NOW)) {
  return { schemaVersion: 1, checkedAt, sources: src };
}

function okState(src: unknown[] = sources()): LiveEvidenceState {
  const parsed = parseEvidenceResponse(body(src));
  if (!parsed.ok) throw new Error(parsed.error);
  return applyEvidenceSuccess(INITIAL_LIVE_EVIDENCE_STATE, parsed.observation);
}

function renderEvidence(evidence: LiveEvidenceState, nowMs = NOW) {
  const live = INITIAL_LIVE_AGENTS_STATE;
  const snapshot = withEvidenceMode(mergeLiveAgents(buildDemoSnapshot(NOW), live), evidence);
  return render(<OwnerOverview snapshot={snapshot} nowMs={nowMs} live={live} evidence={evidence} />);
}

function sourceCard(id: string): HTMLElement {
  const card = screen.getAllByTestId("mc-evidence-source").find((el) => el.dataset.sourceId === id);
  if (!card) throw new Error(`source card ${id} missing`);
  return card;
}

function jsonResponse(status: number, payload: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as unknown as Response;
}

describe("parseEvidenceResponse", () => {
  it("accepts the contract and orders sources hermes, github, drive", () => {
    const r = parseEvidenceResponse(body([...sources()].reverse()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.observation.sources.map((s) => s.id)).toEqual(["hermes", "github", "drive"]);
      expect(r.observation.sources[1].items[0].url).toBe("https://github.com/example/repo/pull/1");
    }
  });

  it("accepts a live source with zero items and +00:00 UTC offsets", () => {
    const r = parseEvidenceResponse(
      body(sources({ hermes: { items: [], checkedAt: "2030-01-15T12:00:00+00:00" } }), "2030-01-15T12:00:00.123456Z")
    );
    expect(r.ok).toBe(true);
  });

  it.each([
    ["non-object", null],
    ["wrong schemaVersion", { ...body(), schemaVersion: 2 }],
    ["non-UTC checkedAt", body(sources(), "2030-01-15T05:00:00-07:00")],
    ["date-only checkedAt", body(sources(), "2030-01-15")],
    ["two sources", body(sources().slice(0, 2))],
    ["four sources", body([...sources(), { id: "slack", status: "live", checkedAt: iso(NOW), items: [] }])],
    ["duplicate source", body([sources()[0], sources()[0], sources()[2]])],
    ["unknown source id", body([sources()[0], sources()[1], { ...sources()[2], id: "dropbox" }])],
    ["unknown status", body(sources({ github: { status: "idle" } }))],
    ["live without checkedAt", body(sources({ github: { checkedAt: null } }))],
    ["unavailable carrying items", body(sources({ drive: { items: [doc()] } }))],
    ["items not array", body(sources({ github: { items: {} as unknown as unknown[] } }))],
    ["github reporting a task", body(sources({ github: { items: [{ ...pr(), kind: "task" }] } }))],
    ["hermes reporting a document", body(sources({ hermes: { items: [doc()] } }))],
    ["missing title", body(sources({ github: { items: [{ ...pr(), title: "" }] } }))],
    ["bad observedAt", body(sources({ github: { items: [pr("pr-1", { observedAt: "yesterday" })] } }))],
    ["non-string url", body(sources({ github: { items: [pr("pr-1", { url: 42 })] } }))],
    ["duplicate item ids", body(sources({ github: { items: [pr("pr-1"), pr("pr-1")] } }))],
    ["too many items", body(sources({ github: { items: Array.from({ length: 101 }, (_, i) => pr(`pr-${i}`)) } }))],
  ])("rejects %s", (_label, input) => {
    expect(parseEvidenceResponse(input).ok).toBe(false);
  });
});

describe("isIsoUtc", () => {
  it("accepts only UTC ISO date-times", () => {
    expect(isIsoUtc("2030-01-15T12:00:00Z")).toBe(true);
    expect(isIsoUtc("2030-01-15T12:00:00.000Z")).toBe(true);
    expect(isIsoUtc("2030-01-15T12:00:00+00:00")).toBe(true);
    expect(isIsoUtc("2030-01-15T12:00:00")).toBe(false);
    expect(isIsoUtc("2030-01-15T12:00:00+01:00")).toBe(false);
    expect(isIsoUtc(1_700_000_000)).toBe(false);
  });
});

describe("safeEvidenceUrl", () => {
  it("allows https links on each source's own hosts", () => {
    expect(safeEvidenceUrl("github", "https://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/1");
    expect(safeEvidenceUrl("drive", "https://drive.google.com/file/d/x/view")).not.toBeNull();
    expect(safeEvidenceUrl("drive", "https://docs.google.com/document/d/x")).not.toBeNull();
  });

  it.each([
    ["github", "http://github.com/o/r/pull/1"],
    ["github", "javascript:alert(1)"],
    ["github", "data:text/html,hi"],
    ["github", "https://user:pass@github.com/o/r"],
    ["github", "https://github.com:8443/o/r"],
    ["github", "https://github.com.evil.example/o/r"],
    ["github", "https://evil.example/?u=https://github.com"],
    ["github", "https://docs.google.com/document/d/x"],
    ["drive", "https://github.com/o/r"],
    ["hermes", "https://github.com/o/r"],
    ["hermes", "http://localhost:3000/missions/1"],
    ["github", "/relative/path"],
  ] as const)("withholds %s link %s", (source, url) => {
    expect(safeEvidenceUrl(source, url)).toBeNull();
  });

  it("keeps the item but drops an unsafe URL", () => {
    const r = parseEvidenceResponse(body(sources({ github: { items: [pr("pr-1", { url: "javascript:alert(1)" })] } })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const item = r.observation.sources[1].items[0];
      expect(item.url).toBeUndefined();
      expect(item.urlWithheld).toBe(true);
    }
  });
});

describe("evidence poll state and freshness", () => {
  it("keeps the prior observation and its timestamps on failure", () => {
    const prior = okState();
    const failed = applyEvidenceFailure(prior, "HTTP 503");
    expect(failed.connector).toBe("unavailable");
    expect(failed.lastError).toBe("HTTP 503");
    expect(failed.observation).toBe(prior.observation);
  });

  it("distinguishes live, held, stale, unavailable and unknown", () => {
    const ok = okState();
    const github = ok.observation!.sources[1];
    const drive = ok.observation!.sources[2];
    expect(evidenceSourceDisplay(github, "connected", NOW)).toBe("live");
    expect(evidenceSourceDisplay(github, "unavailable", NOW)).toBe("held");
    expect(evidenceSourceDisplay(github, "unavailable", NOW + (EVIDENCE_STALE_AFTER_MINUTES + 1) * MIN)).toBe("stale");
    expect(evidenceSourceDisplay(github, "connected", NOW + (EVIDENCE_STALE_AFTER_MINUTES + 1) * MIN)).toBe("stale");
    expect(evidenceSourceDisplay(drive, "connected", NOW)).toBe("unavailable");
    expect(evidenceSourceDisplay(undefined, "connecting", NOW)).toBe("unknown");
    expect(evidenceSourceDisplay({ ...github, checkedAt: iso(NOW + 5 * MIN) }, "connected", NOW)).toBe("unknown");
  });

  it("never counts a source as live after a failed poll", () => {
    expect(liveEvidenceSourceIds(okState(), NOW)).toEqual(["hermes", "github"]);
    expect(liveEvidenceSourceIds(applyEvidenceFailure(okState(), "down"), NOW)).toEqual([]);
    expect(liveEvidenceSourceIds(applyEvidenceFailure(INITIAL_LIVE_EVIDENCE_STATE, "down"), NOW)).toEqual([]);
  });

  it("raises the page to mixed (never live) and leaves demo panels untouched", () => {
    const fixture = buildDemoSnapshot(NOW);
    const merged = withEvidenceMode(fixture, okState());
    expect(merged.mode).toBe("mixed");
    expect(merged.projects).toBe(fixture.projects);
    expect(merged.inbox).toBe(fixture.inbox);
    expect(merged.deliverables).toBe(fixture.deliverables);
    const allUnavailable = okState(
      sources({
        hermes: { status: "unavailable", checkedAt: null, items: [] },
        github: { status: "unavailable", checkedAt: null, items: [] },
      })
    );
    expect(withEvidenceMode(fixture, allUnavailable).mode).toBe("demo");
    expect(withEvidenceMode(fixture, INITIAL_LIVE_EVIDENCE_STATE).mode).toBe("demo");
  });
});

describe("fetchLiveEvidence", () => {
  it("requests the same-origin route with no-store and parses success", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, body()));
    const r = await fetchLiveEvidence(new AbortController().signal, fetchImpl);
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(EVIDENCE_ROUTE, expect.objectContaining({ cache: "no-store" }));
  });

  it("turns 503 { error } into a failure", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, { error: "evidence bridge disabled" }));
    expect(await fetchLiveEvidence(new AbortController().signal, fetchImpl)).toEqual({
      ok: false,
      error: "evidence bridge disabled",
    });
  });

  it("treats malformed schema, invalid JSON and network errors as failures", async () => {
    const malformed = jest.fn().mockResolvedValue(jsonResponse(200, { schemaVersion: 1, checkedAt: iso(NOW), sources: [] }));
    expect((await fetchLiveEvidence(new AbortController().signal, malformed)).ok).toBe(false);
    const badJson = { ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } } as unknown as Response;
    expect(await fetchLiveEvidence(new AbortController().signal, jest.fn().mockResolvedValue(badJson))).toEqual({
      ok: false,
      error: "Invalid response: not JSON",
    });
    expect(await fetchLiveEvidence(new AbortController().signal, jest.fn().mockRejectedValue(new TypeError("net")))).toEqual({
      ok: false,
      error: "Route unreachable",
    });
  });

  it("times out a hung request", async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          })
      );
      const pending = fetchLiveEvidence(new AbortController().signal, fetchImpl as unknown as typeof fetch);
      jest.advanceTimersByTime(EVIDENCE_REQUEST_TIMEOUT_MS);
      expect(await pending).toEqual({ ok: false, error: "Request timed out" });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("LiveEvidence — display", () => {
  it("shows each source with its own status; unavailable is not zero or idle", () => {
    renderEvidence(okState());
    const drive = sourceCard("drive");
    expect(drive.dataset.display).toBe("unavailable");
    expect(within(drive).getByTestId("mc-evidence-source-state")).toHaveTextContent("UNAVAILABLE");
    expect(within(drive).getByTestId("mc-evidence-source-empty")).toHaveTextContent("not zero and not idle");
    expect(sourceCard("github").dataset.display).toBe("live");
    expect(within(sourceCard("github")).getAllByTestId("mc-evidence-item")).toHaveLength(1);
  });

  it("says a live source returned zero items rather than showing nothing", () => {
    renderEvidence(okState(sources({ hermes: { items: [] } })));
    expect(within(sourceCard("hermes")).getByTestId("mc-evidence-source-empty")).toHaveTextContent(
      "Source live — returned 0 items."
    );
  });

  it("scopes each source truthfully: PR state ≠ deploy, Drive metadata only, Hermes records only", () => {
    renderEvidence(okState());
    expect(sourceCard("github")).toHaveTextContent("not a merge, deploy or release approval");
    expect(sourceCard("drive")).toHaveTextContent("Document contents are not read");
    expect(sourceCard("hermes")).toHaveTextContent("Only task and run records the Hermes route actually returned");
    expect(within(sourceCard("github")).getByTestId("mc-evidence-item-status")).toHaveTextContent(
      "open · checks passing"
    );
  });

  it("keeps the page mixed with demo business panels and says evidence does not make projects live", () => {
    renderEvidence(okState());
    const banner = screen.getByTestId("mc-demo-banner");
    expect(banner.dataset.mode).toBe("mixed");
    expect(banner).toHaveTextContent("PAGE NOT LIVE");
    expect(banner).toHaveTextContent("evidence does not make any project live");
    expect(banner).not.toHaveTextContent("Only the agent board reflects");
    for (const r of screen.getAllByTestId("mc-project-row")) {
      expect(within(r).getByTestId("mc-source-tag").dataset.sourceKind).toBe("demo");
      expect(r).toHaveTextContent("UNVERIFIED");
    }
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(/^2 live sources · \d+ stale or unchecked$/);
  });

  it("on a failed poll holds the last observation with an error and stale age — never LIVE", () => {
    const held = applyEvidenceFailure(okState(), "evidence bridge disabled");
    const { rerender } = renderEvidence(held, NOW + 2 * MIN);
    const connector = screen.getByTestId("mc-evidence-connector");
    expect(connector).toHaveAttribute("role", "status");
    expect(connector).toHaveTextContent("EVIDENCE ROUTE UNAVAILABLE (evidence bridge disabled)");
    expect(connector).toHaveTextContent("from 2m ago (2030-01-15 12:00 UTC)");
    expect(sourceCard("github").dataset.display).toBe("held");
    expect(within(sourceCard("github")).getAllByTestId("mc-evidence-item")).toHaveLength(1);
    for (const chip of screen.getAllByTestId("mc-evidence-source-state")) {
      expect(chip).not.toHaveTextContent(/^LIVE$/);
    }
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(/^0 live sources/);

    const later = NOW + (EVIDENCE_STALE_AFTER_MINUTES + 5) * MIN;
    const snapshot = withEvidenceMode(mergeLiveAgents(buildDemoSnapshot(NOW), INITIAL_LIVE_AGENTS_STATE), held);
    rerender(<OwnerOverview snapshot={snapshot} nowMs={later} live={INITIAL_LIVE_AGENTS_STATE} evidence={held} />);
    expect(sourceCard("github").dataset.display).toBe("stale");
    expect(within(sourceCard("github")).getByTestId("mc-evidence-source-checked")).toHaveTextContent(
      "STALE — last success 15m ago (2030-01-15 12:00 UTC)"
    );
  });

  it("with no successful poll shows NOT CONNECTED and every source unknown", () => {
    renderEvidence(applyEvidenceFailure(INITIAL_LIVE_EVIDENCE_STATE, "HTTP 503"));
    expect(screen.getByTestId("mc-evidence-connector")).toHaveTextContent("NOT CONNECTED");
    for (const card of screen.getAllByTestId("mc-evidence-source")) {
      expect(card.dataset.display).toBe("unknown");
      expect(within(card).getByTestId("mc-evidence-source-state")).toHaveTextContent("UNKNOWN");
    }
    expect(screen.queryAllByTestId("mc-evidence-item")).toHaveLength(0);
    expect(screen.getByTestId("mc-demo-banner").dataset.mode).toBe("demo");
  });

  it("renders unsafe URLs as plain text with a withheld note", () => {
    renderEvidence(okState(sources({ github: { items: [pr("pr-1", { url: "javascript:alert(1)" })] } })));
    const item = within(sourceCard("github")).getByTestId("mc-evidence-item");
    expect(within(item).queryByRole("link")).toBeNull();
    expect(within(item).getByTestId("mc-evidence-link-withheld")).toBeInTheDocument();
  });
});

describe("LiveEvidence — read-only, keyboard and accessibility", () => {
  it("renders no buttons, forms or inputs", () => {
    const { container } = renderEvidence(okState(sources({ drive: { status: "live", checkedAt: iso(NOW), items: [doc()] } })));
    const section = container.querySelector("#live-evidence")!;
    expect(within(section as HTMLElement).queryAllByRole("button")).toHaveLength(0);
    expect(section.querySelector("form, input, textarea, select, button")).toBeNull();
    expect(container.querySelector("form, input, textarea, select")).toBeNull();
  });

  it("links only to in-page anchors or allowed https evidence hosts, opened safely", () => {
    renderEvidence(okState(sources({ drive: { status: "live", checkedAt: iso(NOW), items: [doc()] } })));
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href")!;
      if (href.startsWith("#")) continue;
      expect(new URL(href).protocol).toBe("https:");
      expect(["github.com", "docs.google.com", "drive.google.com"]).toContain(new URL(href).hostname);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveTextContent("(opens in a new tab)");
    }
    const evidenceLinks = within(document.getElementById("live-evidence")!).getAllByRole("link");
    expect(evidenceLinks).toHaveLength(2);
  });

  it("is reachable from the jump nav as a focusable, labelled section after the agent board", () => {
    renderEvidence(okState());
    const nav = screen.getByRole("navigation", { name: "Owner overview sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Owner inbox",
      "Agents",
      "Live evidence",
      "Projects",
      "Deliverables & risks",
    ]);
    const target = document.getElementById("live-evidence")!;
    expect(target.tagName).toBe("SECTION");
    expect(target).toHaveAttribute("tabindex", "-1");
    expect(document.getElementById(target.getAttribute("aria-labelledby")!)).toHaveTextContent("Live evidence");
    target.focus();
    expect(document.activeElement).toBe(target);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Agent board")).toBeLessThan(headings.indexOf("Live evidence"));
    expect(headings.indexOf("Live evidence")).toBeLessThan(headings.indexOf("Project radar"));
  });

  it("labels every source card and state chip with text and stacks to one column on mobile", () => {
    renderEvidence(okState());
    const list = screen.getByRole("list", { name: "Evidence sources" });
    expect(list.className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
    for (const card of screen.getAllByTestId("mc-evidence-source")) {
      const heading = document.getElementById(card.getAttribute("aria-labelledby")!)!;
      expect(heading.tagName).toBe("H3");
      expect(within(card).getByTestId("mc-evidence-source-state").textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("omits the section and its jump link when no evidence state is supplied", () => {
    render(<OwnerOverview snapshot={buildDemoSnapshot(NOW)} nowMs={NOW} />);
    expect(document.getElementById("live-evidence")).toBeNull();
    expect(screen.queryByRole("link", { name: "Live evidence" })).toBeNull();
  });
});

describe("MissionControlClient — independent evidence polling", () => {
  const realFetch = global.fetch;
  let agentsMock: jest.Mock;
  let evidenceMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    agentsMock = jest.fn().mockResolvedValue(jsonResponse(503, { error: "agents disabled" }));
    evidenceMock = jest.fn();
    global.fetch = ((url: string, init: RequestInit) =>
      url === EVIDENCE_ROUTE ? evidenceMock(url, init) : agentsMock(url, init)) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  const flush = () => act(async () => {});

  it("polls the evidence route with no-store, holds on failure, ages to STALE and stops on unmount", async () => {
    evidenceMock
      .mockResolvedValueOnce(jsonResponse(200, body()))
      .mockResolvedValue(jsonResponse(503, { error: "evidence bridge disabled" }));

    const { unmount } = render(<MissionControlClient />);
    await flush();
    expect(evidenceMock).toHaveBeenCalledTimes(1);
    expect(evidenceMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(agentsMock.mock.calls[0][0]).toBe(LIVE_AGENTS_ROUTE);
    expect(screen.getByTestId("mc-evidence-connector").dataset.connector).toBe("connected");
    expect(sourceCard("github").dataset.display).toBe("live");
    // A failing agent connector does not affect evidence, and evidence makes the page mixed.
    expect(screen.getByTestId("mc-agent-connector-status")).toHaveTextContent("NOT CONNECTED");
    expect(screen.getByTestId("mc-demo-banner").dataset.mode).toBe("mixed");

    await act(async () => {
      jest.advanceTimersByTime(EVIDENCE_POLL_MS);
    });
    await flush();
    expect(evidenceMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("mc-evidence-connector")).toHaveTextContent("EVIDENCE ROUTE UNAVAILABLE");
    expect(sourceCard("github").dataset.display).toBe("held");
    expect(within(sourceCard("github")).getAllByTestId("mc-evidence-item")).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(EVIDENCE_STALE_AFTER_MINUTES * MIN);
    });
    await flush();
    expect(sourceCard("github").dataset.display).toBe("stale");

    const calls = evidenceMock.mock.calls.length;
    unmount();
    await act(async () => {
      jest.advanceTimersByTime(5 * EVIDENCE_POLL_MS);
    });
    expect(evidenceMock).toHaveBeenCalledTimes(calls);
  });

  it("aborts an in-flight evidence request on unmount", async () => {
    let seen: AbortSignal | undefined;
    evidenceMock.mockImplementation((_url: string, init: RequestInit) => {
      seen = init.signal ?? undefined;
      return new Promise(() => {});
    });
    const { unmount } = render(<MissionControlClient />);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(EVIDENCE_REQUEST_TIMEOUT_MS - 1_000);
    });
    expect(seen?.aborted).toBe(false);
    unmount();
    expect(seen?.aborted).toBe(true);
  });

  it("polls sequentially: never starts a second request while the first has not settled", async () => {
    evidenceMock.mockImplementation(() => new Promise(() => {}));
    render(<MissionControlClient />);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(5 * EVIDENCE_POLL_MS);
    });
    expect(evidenceMock).toHaveBeenCalledTimes(1);
  });

  it("shows NOT CONNECTED (not zero) when the first evidence poll returns 503", async () => {
    evidenceMock.mockResolvedValue(jsonResponse(503, { error: "evidence bridge disabled" }));
    render(<MissionControlClient />);
    await flush();
    expect(screen.getByTestId("mc-evidence-connector")).toHaveTextContent(
      "NOT CONNECTED — evidence route unavailable (evidence bridge disabled)"
    );
    expect(screen.queryAllByTestId("mc-evidence-item")).toHaveLength(0);
    expect(screen.queryByText(/returned 0 items/)).toBeNull();
  });

  it("treats a malformed 200 body as a failed poll", async () => {
    evidenceMock.mockResolvedValue(jsonResponse(200, { schemaVersion: 1, checkedAt: iso(NOW), sources: sources().slice(0, 2) }));
    render(<MissionControlClient />);
    await flush();
    expect(screen.getByTestId("mc-evidence-connector").dataset.connector).toBe("unavailable");
    expect(screen.getByTestId("mc-evidence-connector")).toHaveTextContent("expected exactly three sources");
    for (const card of screen.getAllByTestId("mc-evidence-source")) expect(card.dataset.display).toBe("unknown");
  });
});
