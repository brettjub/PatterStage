/** @jest-environment jsdom */

/**
 * Mission Control — live agent process observation: response validation,
 * poll-state transitions, freshness of held observations, panel labelling
 * and the polling client (mocked fetch, fake timers). No real network.
 */

import { act, render, screen, within } from "@testing-library/react";
import OwnerOverview from "@/components/mission-control/OwnerOverview";
import MissionControlClient from "@/components/mission-control/MissionControlClient";
import { buildDemoSnapshot } from "@/components/mission-control/demo-fixture";
import {
  applyPollFailure,
  applyPollSuccess,
  describeFailure,
  fetchLiveAgents,
  INITIAL_LIVE_AGENTS_STATE,
  LIVE_AGENTS_POLL_MS,
  LIVE_AGENTS_REQUEST_TIMEOUT_MS,
  LIVE_AGENTS_ROUTE,
  mergeLiveAgents,
  parseLiveAgentsResponse,
  type LiveAgentsState,
} from "@/components/mission-control/live-agents";
import { EVIDENCE_ROUTE } from "@/components/mission-control/live-evidence";
import { REGISTER_ROUTE } from "@/components/mission-control/live-register";

const NOW = Date.parse("2030-01-15T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const SOURCE = "VPS process exporter (test)";

function agentJson(id: string, availability = "running", checkedAt = iso(NOW)) {
  return {
    id,
    name: `agent-${id}`,
    runtime: "hermes",
    availability,
    run: null,
    stamp: { source: SOURCE, kind: "live", checkedAt, staleAfterMinutes: 1 },
  };
}

function body(checkedAt = iso(NOW), agents: unknown[] = [agentJson("a1"), agentJson("a2", "idle", checkedAt)]) {
  return { schemaVersion: 1, checkedAt, source: SOURCE, agents };
}

function okState(checkedAtMs = NOW): LiveAgentsState {
  const parsed = parseLiveAgentsResponse(body(iso(checkedAtMs), [agentJson("a1", "running", iso(checkedAtMs))]));
  if (!parsed.ok) throw new Error(parsed.error);
  return applyPollSuccess(INITIAL_LIVE_AGENTS_STATE, parsed.observation);
}

function renderLive(live: LiveAgentsState, nowMs = NOW) {
  const snapshot = mergeLiveAgents(buildDemoSnapshot(NOW), live);
  return render(<OwnerOverview snapshot={snapshot} nowMs={nowMs} live={live} />);
}

function jsonResponse(status: number, payload: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as unknown as Response;
}

describe("parseLiveAgentsResponse", () => {
  it("accepts the contract shape", () => {
    const r = parseLiveAgentsResponse(body());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.observation.source).toBe(SOURCE);
      expect(r.observation.agents.map((a) => a.id)).toEqual(["a1", "a2"]);
      expect(r.observation.agents.every((a) => a.stamp.kind === "live" && a.run === null)).toBe(true);
    }
  });

  it("accepts an empty agent list", () => {
    expect(parseLiveAgentsResponse(body(iso(NOW), [])).ok).toBe(true);
  });

  it.each([
    ["non-object", null],
    ["wrong schemaVersion", { ...body(), schemaVersion: 2 }],
    ["bad checkedAt", { ...body(), checkedAt: "yesterday" }],
    ["missing source", { ...body(), source: "" }],
    ["agents not array", { ...body(), agents: {} }],
    ["unknown availability", body(iso(NOW), [agentJson("a1", "sleeping")])],
    ["run claimed", body(iso(NOW), [{ ...agentJson("a1"), run: { taskLabel: "x", runState: "running", project: "p" } }])],
    ["non-live stamp", body(iso(NOW), [{ ...agentJson("a1"), stamp: { ...agentJson("a1").stamp, kind: "demo" } }])],
    ["bad stamp time", body(iso(NOW), [agentJson("a1", "running", "nope")])],
    ["duplicate ids", body(iso(NOW), [agentJson("a1"), agentJson("a1")])],
    ["missing name", body(iso(NOW), [{ ...agentJson("a1"), name: undefined }])],
  ])("rejects %s", (_label, input) => {
    expect(parseLiveAgentsResponse(input).ok).toBe(false);
  });
});

describe("poll state transitions", () => {
  it("replaces the observation on success", () => {
    const s = okState();
    expect(s.connector).toBe("connected");
    expect(s.observation?.checkedAt).toBe(iso(NOW));
  });

  it("keeps the prior observation and its checkedAt on failure", () => {
    const prior = okState();
    const failed = applyPollFailure(prior, "exporter disabled");
    expect(failed.connector).toBe("unavailable");
    expect(failed.lastError).toBe("exporter disabled");
    expect(failed.observation).toBe(prior.observation);
    expect(failed.observation?.checkedAt).toBe(iso(NOW));
  });

  it("reports unavailable with no observation when nothing ever succeeded", () => {
    const s = applyPollFailure(INITIAL_LIVE_AGENTS_STATE, "HTTP 503");
    expect(s.observation).toBeNull();
    expect(s.connector).toBe("unavailable");
  });

  it("describes 503 bodies with their error text, truncated", () => {
    expect(describeFailure(503, { error: "connector disabled" })).toBe("connector disabled");
    expect(describeFailure(500, {})).toBe("HTTP 500");
    expect(describeFailure(503, { error: "x".repeat(500) }).length).toBe(200);
  });
});

describe("mergeLiveAgents", () => {
  const fixture = buildDemoSnapshot(NOW);

  it("replaces only agents and marks the snapshot mixed, never live", () => {
    const merged = mergeLiveAgents(fixture, okState());
    expect(merged.mode).toBe("mixed");
    expect(merged.agents.map((a) => a.id)).toEqual(["a1"]);
    expect(merged.projects).toBe(fixture.projects);
    expect(merged.inbox).toBe(fixture.inbox);
    expect(merged.deliverables).toBe(fixture.deliverables);
    expect(merged.projects.every((p) => p.stamp.kind !== "live" && p.verification === "unverified")).toBe(true);
  });

  it("shows no fixture agents before any successful poll", () => {
    const merged = mergeLiveAgents(fixture, applyPollFailure(INITIAL_LIVE_AGENTS_STATE, "down"));
    expect(merged.mode).toBe("demo");
    expect(merged.agents).toEqual([]);
  });
});

describe("fetchLiveAgents", () => {
  it("requests the same-origin route with no-store and parses success", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, body()));
    const r = await fetchLiveAgents(new AbortController().signal, fetchImpl);
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(LIVE_AGENTS_ROUTE, expect.objectContaining({ cache: "no-store" }));
  });

  it("turns 503 { error } into a failure", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, { error: "connector disabled" }));
    expect(await fetchLiveAgents(new AbortController().signal, fetchImpl)).toEqual({
      ok: false,
      error: "connector disabled",
    });
  });

  it("treats invalid JSON and network errors as failures", async () => {
    const badJson = { ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } } as unknown as Response;
    expect((await fetchLiveAgents(new AbortController().signal, jest.fn().mockResolvedValue(badJson))).ok).toBe(false);
    const r = await fetchLiveAgents(new AbortController().signal, jest.fn().mockRejectedValue(new TypeError("net")));
    expect(r).toEqual({ ok: false, error: "Route unreachable" });
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
      const pending = fetchLiveAgents(new AbortController().signal, fetchImpl as unknown as typeof fetch);
      jest.advanceTimersByTime(LIVE_AGENTS_REQUEST_TIMEOUT_MS);
      expect(await pending).toEqual({ ok: false, error: "Request timed out" });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("AgentBoard — live process observation display", () => {
  it("labels the panel as a live VPS process observation with source and checked-at", () => {
    renderLive(okState());
    const connector = screen.getByTestId("mc-agent-connector");
    expect(connector).toHaveTextContent("LIVE VPS AGENT PROCESS OBSERVATION");
    expect(connector).toHaveTextContent(SOURCE);
    expect(connector).toHaveTextContent("2030-01-15 12:00 UTC");
    expect(connector).toHaveTextContent(/Task assignments, run state and projects are not known/);
    expect(connector.dataset.connector).toBe("connected");
  });

  it("never claims an assignment for live rows", () => {
    renderLive(okState());
    const row = screen.getByTestId("mc-agent-row");
    expect(within(row).getByTestId("mc-agent-run")).toHaveTextContent("Not observed");
    expect(row).not.toHaveTextContent("No run assigned");
    expect(within(row).getByTestId("mc-source-tag").dataset.sourceKind).toBe("live");
  });

  it("keeps business panels demo and the page mixed, not live", () => {
    renderLive(okState());
    const banner = screen.getByTestId("mc-demo-banner");
    expect(banner.dataset.mode).toBe("mixed");
    expect(banner).toHaveTextContent(/PAGE NOT LIVE/);
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(/^1 live source · \d+ stale or unchecked$/);
    for (const r of screen.getAllByTestId("mc-project-row")) {
      expect(within(r).getByTestId("mc-source-tag").dataset.sourceKind).toBe("demo");
    }
  });

  it("on failure holds the prior observation with its age, then marks it STALE as the clock moves", () => {
    const held = applyPollFailure(okState(), "connector disabled");
    const { rerender } = renderLive(held, NOW + 30_000);
    const status = screen.getByTestId("mc-agent-connector-status");
    expect(status).toHaveTextContent("CONNECTOR UNAVAILABLE (connector disabled)");
    expect(screen.getByTestId("mc-agent-row")).toHaveTextContent("Running");
    expect(within(screen.getByTestId("mc-agent-connector")).getByTestId("mc-source-tag")).toHaveTextContent(
      "check just now (2030-01-15 12:00 UTC)"
    );

    const later = NOW + 3 * 60_000;
    rerender(
      <OwnerOverview snapshot={mergeLiveAgents(buildDemoSnapshot(NOW), held)} nowMs={later} live={held} />
    );
    const avail = within(screen.getByTestId("mc-agent-row")).getByTestId("mc-agent-availability");
    expect(avail.querySelector("[data-state]")).toHaveAttribute("data-state", "stale");
    expect(avail).toHaveTextContent("last reported: Running");
    expect(within(screen.getByTestId("mc-agent-connector")).getByTestId("mc-source-tag")).toHaveTextContent(
      "STALE — last success 3m ago (2030-01-15 12:00 UTC)"
    );
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(/^0 live sources/);
  });

  it("with no successful poll shows not connected / unknown and no fictional process states", () => {
    renderLive(applyPollFailure(INITIAL_LIVE_AGENTS_STATE, "HTTP 503"));
    expect(screen.getByTestId("mc-agent-connector-status")).toHaveTextContent("NOT CONNECTED");
    expect(screen.queryAllByTestId("mc-agent-row")).toHaveLength(0);
    expect(screen.getByTestId("mc-agents-empty")).toHaveTextContent("agent states unknown");
    expect(screen.getByTestId("mc-summary-agents")).toHaveTextContent("not connected — unknown");
    expect(screen.getByTestId("mc-demo-banner").dataset.mode).toBe("demo");
  });
});

describe("MissionControlClient polling", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    fetchMock = jest.fn();
    // Evidence and the owner register poll their own routes; keep them out of the agent-route call counts.
    global.fetch = ((url: string, init: RequestInit) =>
      url === EVIDENCE_ROUTE || url === REGISTER_ROUTE
        ? Promise.resolve(jsonResponse(503, { error: "source disabled" }))
        : fetchMock(url, init)) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  const flush = () => act(async () => {});

  it("polls, keeps the observation through a failure, goes STALE on clock ticks, and stops on unmount", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, body(iso(NOW), [agentJson("a1", "running", iso(NOW))])))
      .mockResolvedValue(jsonResponse(503, { error: "connector disabled" }));

    const { unmount } = render(<MissionControlClient />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(LIVE_AGENTS_ROUTE);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(screen.getByTestId("mc-agent-connector").dataset.connector).toBe("connected");
    expect(screen.getAllByTestId("mc-agent-row")).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(LIVE_AGENTS_POLL_MS);
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("mc-agent-connector").dataset.connector).toBe("unavailable");
    expect(screen.getAllByTestId("mc-agent-row")).toHaveLength(1);
    expect(screen.getByTestId("mc-agent-connector")).toHaveTextContent("2030-01-15 12:00 UTC");

    // Failing polls + clock ticks: the held observation ages into STALE.
    await act(async () => {
      jest.advanceTimersByTime(3 * 60_000);
    });
    await flush();
    const avail = within(screen.getByTestId("mc-agent-row")).getByTestId("mc-agent-availability");
    expect(avail.querySelector("[data-state]")).toHaveAttribute("data-state", "stale");

    const calls = fetchMock.mock.calls.length;
    unmount();
    await act(async () => {
      jest.advanceTimersByTime(5 * LIVE_AGENTS_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("aborts an in-flight request on unmount", async () => {
    let seen: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      seen = init.signal ?? undefined;
      return new Promise(() => {});
    });
    const { unmount } = render(<MissionControlClient />);
    await flush();
    expect(seen?.aborted).toBe(false);
    unmount();
    expect(seen?.aborted).toBe(true);
  });

  it("shows not connected when the first poll fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: "connector disabled" }));
    render(<MissionControlClient />);
    await flush();
    expect(screen.getByTestId("mc-agent-connector-status")).toHaveTextContent("NOT CONNECTED");
    expect(screen.queryAllByTestId("mc-agent-row")).toHaveLength(0);
  });
});
