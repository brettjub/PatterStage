/** @jest-environment jsdom */

/**
 * Mission Control — owner register (Google Sheet) UI integration. The
 * browser only polls the same-origin register route; the parser is strict,
 * a successful read verifies the READ (not the recorded project status),
 * unreviewed rows stay UNVERIFIED, and an outage holds the last read
 * instead of claiming zero or healthy state. Mocked fetch, fixed clock.
 */

import { readFileSync } from "fs";
import { act, render, screen, within } from "@testing-library/react";
import OwnerOverview from "@/components/mission-control/OwnerOverview";
import MissionControlClient from "@/components/mission-control/MissionControlClient";
import { buildObservedSnapshot } from "@/components/mission-control/observed-snapshot";
import {
  applyPollSuccess,
  INITIAL_LIVE_AGENTS_STATE,
  LIVE_AGENTS_ROUTE,
  mergeLiveAgents,
  parseLiveAgentsResponse,
  type LiveAgentsState,
} from "@/components/mission-control/live-agents";
import {
  applyEvidenceSuccess,
  EVIDENCE_ROUTE,
  INITIAL_LIVE_EVIDENCE_STATE,
  parseEvidenceResponse,
  withEvidenceMode,
  type LiveEvidenceState,
} from "@/components/mission-control/live-evidence";
import {
  applyRegisterFailure,
  applyRegisterSuccess,
  fetchOwnerRegister,
  INITIAL_REGISTER_STATE,
  ownerReviewStatus,
  OWNER_REVIEW_STALE_AFTER_DAYS,
  parseRegisterResponse,
  REGISTER_POLL_MS,
  REGISTER_REQUEST_TIMEOUT_MS,
  REGISTER_ROUTE,
  REGISTER_STALE_AFTER_MINUTES,
  registerSourceDisplay,
  safeRegisterSourceUrl,
  safeSheetUrl,
  type RegisterState,
} from "@/components/mission-control/live-register";

const NOW = Date.parse("2030-01-15T12:00:00.000Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const SHEET = "https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit";

/** The two seeded rows: no owner review, unknown state. */
const SEEDED_PROJECTS = [
  {
    id: "ngm",
    name: "NGM",
    outcome: "Outcome as recorded for NGM",
    recordedState: "unknown",
    position: "Not yet reviewed by owner",
    nextMove: "Owner to record current state",
  },
  {
    id: "launchhost",
    name: "Launchhost",
    outcome: "Outcome as recorded for Launchhost",
    recordedState: "unknown",
    position: "Not yet reviewed by owner",
    nextMove: "Owner to record current state",
  },
];

function decision(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `decision-${n}`,
    projectId: "ngm",
    title: `Choose hosting plan ${n}`,
    target: "NGM production hosting",
    impact: "Blocks launch rehearsal",
    raisedAt: iso(NOW - 4 * DAY),
    ...extra,
  };
}

function registerBody(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    checkedAt: iso(NOW),
    sheetUrl: SHEET,
    decisions: [],
    projects: SEEDED_PROJECTS,
    ...over,
  };
}

function registerOk(over: Record<string, unknown> = {}): RegisterState {
  const parsed = parseRegisterResponse(registerBody(over));
  if (!parsed.ok) throw new Error(parsed.error);
  return applyRegisterSuccess(INITIAL_REGISTER_STATE, parsed.observation);
}

function agentsOk(): LiveAgentsState {
  const checkedAt = iso(NOW);
  const parsed = parseLiveAgentsResponse({
    schemaVersion: 1,
    checkedAt,
    source: "exporter (test)",
    agents: [
      {
        id: "a1",
        name: "agent-a1",
        runtime: "hermes",
        availability: "running",
        run: null,
        stamp: { source: "exporter (test)", kind: "live", checkedAt, staleAfterMinutes: 1 },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return applyPollSuccess(INITIAL_LIVE_AGENTS_STATE, parsed.observation);
}

function evidenceBody() {
  return {
    schemaVersion: 1,
    checkedAt: iso(NOW),
    sources: [
      { id: "hermes", status: "unavailable", checkedAt: null, items: [] },
      { id: "github", status: "live", checkedAt: iso(NOW), items: [] },
      { id: "drive", status: "live", checkedAt: iso(NOW), items: [] },
    ],
  };
}

function evidenceOk(): LiveEvidenceState {
  const parsed = parseEvidenceResponse(evidenceBody());
  if (!parsed.ok) throw new Error(parsed.error);
  return applyEvidenceSuccess(INITIAL_LIVE_EVIDENCE_STATE, parsed.observation);
}

function renderWith(register: RegisterState, nowMs = NOW) {
  const live = agentsOk();
  const evidence = evidenceOk();
  const snapshot = withEvidenceMode(mergeLiveAgents(buildObservedSnapshot(NOW), live), evidence);
  return render(
    <OwnerOverview snapshot={snapshot} nowMs={nowMs} live={live} evidence={evidence} register={register} />
  );
}

const inboxSection = () => document.getElementById("owner-inbox")!;
const radarSection = () => document.getElementById("project-radar")!;
const projectRow = (id: string) =>
  screen.getAllByTestId("mc-project-row").find((r) => r.dataset.projectId === id)!;

// ─── Parser ──────────────────────────────────────────────────────

describe("parseRegisterResponse — strict contract", () => {
  it("accepts the agreed shape and keeps checkedAt and ownerReviewedAt separate", () => {
    const reviewed = iso(NOW - 2 * DAY);
    const parsed = parseRegisterResponse(
      registerBody({
        decisions: [decision(1, { ownerReviewedAt: reviewed })],
        projects: [...SEEDED_PROJECTS, { ...SEEDED_PROJECTS[0], id: "patterstage", name: "PatterStage", recordedState: "active", ownerReviewedAt: reviewed }],
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.observation.checkedAt).toBe(iso(NOW));
    expect(parsed.observation.decisions[0].ownerReviewedAt).toBe(reviewed);
    expect(parsed.observation.projects[0].ownerReviewedAt).toBeUndefined();
    expect(parsed.observation.projects[2].ownerReviewedAt).toBe(reviewed);
    expect(parsed.observation.sheetUrl).toBe(SHEET);
  });

  it.each([
    ["not an object", []],
    ["wrong schemaVersion", registerBody({ schemaVersion: 2 })],
    ["non-UTC checkedAt", registerBody({ checkedAt: "2030-01-15T12:00:00+02:00" })],
    ["missing sheetUrl", registerBody({ sheetUrl: undefined })],
    ["decisions not an array", registerBody({ decisions: null })],
    ["projects not an array", registerBody({ projects: {} })],
    ["unknown top-level field", registerBody({ approvals: [] })],
    ["non-slug decision id", registerBody({ decisions: [decision(1, { id: "Decision 1" })] })],
    ["non-slug projectId", registerBody({ decisions: [decision(1, { projectId: "../ngm" })] })],
    ["blank decision title", registerBody({ decisions: [decision(1, { title: "  " })] })],
    ["local-time raisedAt", registerBody({ decisions: [decision(1, { raisedAt: "2030-01-10T08:00:00" })] })],
    ["bad ownerReviewedAt", registerBody({ decisions: [decision(1, { ownerReviewedAt: "yesterday" })] })],
    ["extra decision field (e.g. a status)", registerBody({ decisions: [decision(1, { status: "approved" })] })],
    ["duplicate decision id", registerBody({ decisions: [decision(1), decision(1)] })],
    ["invalid recordedState", registerBody({ projects: [{ ...SEEDED_PROJECTS[0], recordedState: "healthy" }] })],
    ["missing nextMove", registerBody({ projects: [{ ...SEEDED_PROJECTS[0], nextMove: undefined }] })],
    ["duplicate project id", registerBody({ projects: [SEEDED_PROJECTS[0], SEEDED_PROJECTS[0]] })],
    ["non-string sourceUrl", registerBody({ projects: [{ ...SEEDED_PROJECTS[0], sourceUrl: 42 }] })],
  ])("rejects the whole response: %s", (_label, body) => {
    const parsed = parseRegisterResponse(body);
    expect(parsed.ok).toBe(false);
  });

  it("keeps a row with an unsafe source link but withholds the link", () => {
    const parsed = parseRegisterResponse(
      registerBody({
        decisions: [decision(1, { sourceUrl: "javascript:alert(1)" })],
        projects: [{ ...SEEDED_PROJECTS[0], sourceUrl: "https://evil.example/doc" }],
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.observation.decisions[0].sourceUrl).toBeUndefined();
    expect(parsed.observation.decisions[0].sourceUrlWithheld).toBe(true);
    expect(parsed.observation.projects[0].sourceUrl).toBeUndefined();
    expect(parsed.observation.projects[0].sourceUrlWithheld).toBe(true);
  });

  it("withholds an unsafe sheet URL without discarding the read", () => {
    const parsed = parseRegisterResponse(registerBody({ sheetUrl: "https://evil.example/spreadsheets/d/x/edit" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.observation.sheetUrl).toBeNull();
    expect(parsed.observation.sheetUrlWithheld).toBe(true);
  });
});

describe("URL allowlists", () => {
  it("allows only https docs.google.com/spreadsheets/d/<id>/edit as the sheet link", () => {
    expect(safeSheetUrl(SHEET)).toBe(SHEET);
    expect(safeSheetUrl(`${SHEET}#gid=0`)).toBe(`${SHEET}#gid=0`);
    for (const bad of [
      "http://docs.google.com/spreadsheets/d/abc/edit",
      "https://user:pw@docs.google.com/spreadsheets/d/abc/edit",
      "https://docs.google.com:8443/spreadsheets/d/abc/edit",
      "https://docs.google.com/spreadsheets/d/abc/export?format=csv",
      "https://docs.google.com/spreadsheets/d/abc/edit?usp=sharing",
      "https://docs.google.com/document/d/abc/edit",
      "https://drive.google.com/spreadsheets/d/abc/edit",
      "https://docs.google.com.evil.example/spreadsheets/d/abc/edit",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(safeSheetUrl(bad)).toBeNull();
    }
  });

  it("allows only https Google Drive/Docs and GitHub row sources without credentials or port", () => {
    expect(safeRegisterSourceUrl("https://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/1");
    expect(safeRegisterSourceUrl("https://drive.google.com/file/d/x/view")).toBe("https://drive.google.com/file/d/x/view");
    expect(safeRegisterSourceUrl("https://docs.google.com/document/d/x/edit")).toBe("https://docs.google.com/document/d/x/edit");
    for (const bad of [
      "http://github.com/o/r",
      "https://tok@github.com/o/r",
      "https://github.com:444/o/r",
      "https://gist.github.com/x",
      "https://evil.example/",
      "data:text/html,hi",
    ]) {
      expect(safeRegisterSourceUrl(bad)).toBeNull();
    }
  });
});

// ─── Pure state ──────────────────────────────────────────────────

describe("register state and freshness", () => {
  it("polls every 60s with a 20s request timeout", () => {
    expect(REGISTER_POLL_MS).toBe(60_000);
    expect(REGISTER_REQUEST_TIMEOUT_MS).toBe(20_000);
  });

  it("moves connecting → live → held → stale, and unavailable before any success", () => {
    expect(registerSourceDisplay(INITIAL_REGISTER_STATE, NOW)).toBe("connecting");
    expect(registerSourceDisplay(applyRegisterFailure(INITIAL_REGISTER_STATE, "x"), NOW)).toBe("unavailable");
    const ok = registerOk();
    expect(registerSourceDisplay(ok, NOW)).toBe("live");
    const held = applyRegisterFailure(ok, "Owner register unavailable");
    expect(held.observation).toBe(ok.observation);
    expect(registerSourceDisplay(held, NOW + MIN)).toBe("held");
    expect(registerSourceDisplay(held, NOW + (REGISTER_STALE_AFTER_MINUTES + 1) * MIN)).toBe("stale");
    // A successful poll whose source time is old is still stale, never live.
    expect(registerSourceDisplay(ok, NOW + (REGISTER_STALE_AFTER_MINUTES + 1) * MIN)).toBe("stale");
  });

  it("classifies owner review: none/future = unverified, old = review stale", () => {
    expect(ownerReviewStatus(undefined, NOW).state).toBe("unverified");
    expect(ownerReviewStatus(iso(NOW + DAY), NOW).state).toBe("unverified");
    expect(ownerReviewStatus(iso(NOW - DAY), NOW).state).toBe("reviewed");
    expect(ownerReviewStatus(iso(NOW - (OWNER_REVIEW_STALE_AFTER_DAYS + 1) * DAY), NOW).state).toBe("review_stale");
  });
});

// ─── Rendering ───────────────────────────────────────────────────

describe("OwnerOverview — empty successful register", () => {
  it("says 0 open decisions recorded in register, with read provenance", () => {
    renderWith(registerOk());
    expect(screen.queryByTestId("mc-inbox-not-connected")).toBeNull();
    expect(screen.queryAllByTestId("mc-inbox-item")).toHaveLength(0);
    expect(within(inboxSection()).getByTestId("mc-inbox-empty")).toHaveTextContent(
      "0 open decisions recorded in register"
    );
    expect(within(inboxSection()).getByTestId("mc-register-state")).toHaveTextContent("LIVE READ");
    expect(within(inboxSection()).getByTestId("mc-register-read")).toHaveTextContent(
      "read just now (2030-01-15 12:00 UTC)"
    );
    const needs = screen.getByTestId("mc-summary-needs");
    expect(needs).toHaveTextContent("0 open decisions recorded in register");
    expect(needs).toHaveTextContent("owner register · read just now");
  });
});

describe("OwnerOverview — seeded unknown projects", () => {
  it("shows NGM and Launchhost as UNVERIFIED with unknown recorded state, never active", () => {
    renderWith(registerOk());
    expect(screen.queryByTestId("mc-radar-not-connected")).toBeNull();
    const rows = screen.getAllByTestId("mc-project-row");
    expect(rows.map((r) => r.dataset.projectId)).toEqual(["ngm", "launchhost"]);
    for (const row of rows) {
      expect(row.dataset.review).toBe("unverified");
      expect(row).toHaveTextContent("UNVERIFIED");
      expect(row).toHaveTextContent("Recorded state");
      expect(row).toHaveTextContent("Unknown");
      expect(row).not.toHaveTextContent(/\bActive\b/);
      expect(row).toHaveTextContent("No owner review recorded");
      expect(row).toHaveTextContent("Owner register · read just now");
    }
    expect(radarSection()).toHaveTextContent("a successful read is not verification");
    expect(screen.getByTestId("mc-summary-blocker")).toHaveTextContent("No blocker recorded in register");
  });

  it("shows owner-reviewed freshness separately from the register read time", () => {
    const reviewed = iso(NOW - 2 * DAY);
    const oldReview = iso(NOW - (OWNER_REVIEW_STALE_AFTER_DAYS + 3) * DAY);
    renderWith(
      registerOk({
        projects: [
          { ...SEEDED_PROJECTS[0], recordedState: "active", ownerReviewedAt: reviewed, blocker: "Waiting on DNS" },
          { ...SEEDED_PROJECTS[1], recordedState: "paused", ownerReviewedAt: oldReview },
        ],
      })
    );
    const ngm = projectRow("ngm");
    expect(ngm.dataset.review).toBe("reviewed");
    expect(ngm).toHaveTextContent("Owner reviewed 2d ago (2030-01-13 12:00 UTC)");
    expect(ngm).toHaveTextContent("Owner register · read just now (2030-01-15 12:00 UTC)");
    expect(ngm).toHaveTextContent("Recorded blocker");
    const lh = projectRow("launchhost");
    expect(lh.dataset.review).toBe("review_stale");
    expect(lh).toHaveTextContent("OWNER REVIEW STALE");
    expect(screen.getByTestId("mc-summary-blocker")).toHaveTextContent("NGM — Waiting on DNS");
    expect(screen.getByTestId("mc-summary-blocker")).toHaveTextContent("recorded in register, not verified");
  });
});

describe("OwnerOverview — nonempty decisions", () => {
  it("lists recorded decisions oldest first with project, target, impact and age — no controls", () => {
    const { container } = renderWith(
      registerOk({
        decisions: [
          decision(2, { raisedAt: iso(NOW - 1 * DAY), sourceUrl: "https://github.com/o/r/issues/2" }),
          decision(1, { raisedAt: iso(NOW - 4 * DAY), ownerReviewedAt: iso(NOW - DAY) }),
        ],
      })
    );
    const items = screen.getAllByTestId("mc-inbox-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Choose hosting plan 1");
    expect(items[0]).toHaveTextContent("NGM");
    expect(items[0]).toHaveTextContent("NGM production hosting");
    expect(items[0]).toHaveTextContent("Blocks launch rehearsal");
    expect(items[0]).toHaveTextContent("raised 4d ago");
    expect(items[0]).toHaveTextContent("Older than 3 days");
    expect(items[0]).toHaveTextContent("Owner reviewed 24h ago");
    expect(items[1]).toHaveTextContent("No owner review recorded");
    const link = within(items[1]).getByRole("link", { name: /Source/ });
    expect(link).toHaveAttribute("href", "https://github.com/o/r/issues/2");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByTestId("mc-summary-needs")).toHaveTextContent(
      "2 open decisions recorded in register · oldest raised 4d ago"
    );
    expect(container.querySelector("form, input, textarea, select, button")).toBeNull();
    expect(container.textContent).not.toMatch(/Approve|Reject|Save|Send|Deploy/);
  });
});

describe("OwnerOverview — unsafe links", () => {
  it("withholds unsafe row links and an unsafe sheet link", () => {
    renderWith(
      registerOk({
        sheetUrl: "https://evil.example/spreadsheets/d/x/edit",
        decisions: [decision(1, { sourceUrl: "javascript:alert(1)" })],
        projects: [{ ...SEEDED_PROJECTS[0], sourceUrl: "http://github.com/o/r" }],
      })
    );
    expect(screen.queryByRole("link", { name: /Edit source register/ })).toBeNull();
    expect(screen.getByTestId("mc-register-sheet-withheld")).toBeInTheDocument();
    expect(screen.getAllByTestId("mc-register-link-withheld")).toHaveLength(2);
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href")!;
      if (href.startsWith("#")) continue;
      expect(href).toMatch(/^https:\/\/(github\.com|drive\.google\.com|docs\.google\.com)\//);
    }
  });

  it("links an allowed sheet once, read-only, as 'Edit source register'", () => {
    renderWith(registerOk());
    const link = screen.getByRole("link", { name: /Edit source register/ });
    expect(link).toHaveAttribute("href", SHEET);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("OwnerOverview — outage after success and stale age", () => {
  const withDecision = () => registerOk({ decisions: [decision(1)] });

  it("holds the last read as HELD, not current, without claiming zero or healthy", () => {
    const held = applyRegisterFailure(withDecision(), "Owner register unavailable");
    renderWith(held, NOW + 2 * MIN);
    expect(screen.getAllByTestId("mc-inbox-item")).toHaveLength(1);
    expect(within(inboxSection()).getByTestId("mc-register-state")).toHaveTextContent("HELD — LAST READ FAILED");
    expect(within(inboxSection()).getByTestId("mc-register-read")).toHaveTextContent(
      "last successful read 2m ago (2030-01-15 12:00 UTC)"
    );
    expect(within(inboxSection()).getByTestId("mc-register-error")).toHaveTextContent("Owner register unavailable");
    expect(screen.getByTestId("mc-summary-needs")).toHaveTextContent(
      "HELD — last read recorded 1 open decision; current count unknown"
    );
    expect(screen.getAllByTestId("mc-project-row")).toHaveLength(2);
    expect(screen.getByTestId("mc-summary-blocker")).toHaveTextContent(/^HELD — /);
    expect(screen.getByTestId("mc-source-banner")).toHaveTextContent("Owner register: HELD");
    expect(screen.getByTestId("mc-source-banner")).not.toHaveTextContent("Owner register: LIVE");
  });

  it("does not restate a held empty register as a current zero", () => {
    const held = applyRegisterFailure(registerOk(), "Owner register unavailable");
    renderWith(held, NOW + MIN);
    expect(within(inboxSection()).getByTestId("mc-inbox-empty")).toHaveTextContent(
      "The last successful read recorded 0 open decisions; the current count is unknown."
    );
    expect(screen.getByTestId("mc-summary-needs")).not.toHaveTextContent(/^0 open/);
  });

  it("turns a held read STALE as the clock moves", () => {
    const held = applyRegisterFailure(withDecision(), "Owner register unavailable");
    renderWith(held, NOW + (REGISTER_STALE_AFTER_MINUTES + 5) * MIN);
    expect(within(inboxSection()).getByTestId("mc-register-state")).toHaveTextContent("STALE");
    expect(within(radarSection()).getByTestId("mc-register-read")).toHaveTextContent(
      `STALE — last successful read ${REGISTER_STALE_AFTER_MINUTES + 5}m ago`
    );
    expect(screen.getByTestId("mc-summary-needs")).toHaveTextContent(/^STALE — /);
    expect(screen.getByTestId("mc-source-banner")).toHaveTextContent("Owner register: STALE");
  });

  it("shows UNAVAILABLE / unknown when the register was never read", () => {
    const { container } = renderWith(applyRegisterFailure(INITIAL_REGISTER_STATE, "Owner register unavailable"));
    expect(screen.queryAllByTestId("mc-inbox-item")).toHaveLength(0);
    expect(screen.queryAllByTestId("mc-project-row")).toHaveLength(0);
    expect(within(inboxSection()).getByTestId("mc-inbox-empty")).toHaveTextContent("not zero");
    expect(within(radarSection()).getByTestId("mc-radar-empty")).toHaveTextContent("unknown");
    expect(screen.getByTestId("mc-summary-needs")).toHaveTextContent("UNAVAILABLE — unknown");
    expect(screen.getByTestId("mc-summary-blocker")).toHaveTextContent("UNAVAILABLE — unknown");
    expect(container.textContent).not.toMatch(/\b0 open\b|none recorded|No blocker recorded/);
    expect(screen.queryByRole("link", { name: /Edit source register/ })).toBeNull();
  });
});

describe("OwnerOverview — source banner and summary provenance", () => {
  it("names the owner register in the banner and counts it as an observed source", () => {
    renderWith(registerOk());
    const banner = screen.getByTestId("mc-source-banner");
    expect(banner.dataset.mode).toBe("observed");
    expect(banner.dataset.coverage).toBe("partial");
    expect(banner).toHaveTextContent("PARTIAL COVERAGE · PAGE NOT FULLY CONNECTED");
    expect(banner).toHaveTextContent("Owner register: LIVE READ");
    expect(banner).toHaveTextContent("manually maintained");
    expect(banner).not.toHaveTextContent("Owner inbox and project radar: NOT CONNECTED");
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(
      /^4 of 5 observed sources live · 1 not currently live \(unknown, unavailable, held or stale\)$/
    );
  });

  it("shows CONNECTING in the panels before the first register read settles", () => {
    renderWith(INITIAL_REGISTER_STATE);
    expect(within(inboxSection()).getByTestId("mc-inbox-empty")).toHaveTextContent("CONNECTING");
    expect(screen.getByTestId("mc-summary-needs")).toHaveTextContent("CONNECTING — unknown");
    expect(screen.getByTestId("mc-source-banner")).toHaveTextContent("Owner register: CONNECTING");
  });

  it("keeps the runtime snapshot in observed mode", () => {
    const snapshot = withEvidenceMode(mergeLiveAgents(buildObservedSnapshot(NOW), agentsOk()), evidenceOk());
    expect(snapshot.mode).toBe("observed");
  });
});

// ─── Fetch + client ──────────────────────────────────────────────

const json = (status: number, payload: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as unknown as Response;

describe("fetchOwnerRegister", () => {
  it("GETs only the same-origin route and maps 503 to the backend error", async () => {
    const f = jest.fn().mockResolvedValue(json(503, { error: "Owner register unavailable" }));
    const res = await fetchOwnerRegister(new AbortController().signal, f as unknown as typeof fetch);
    expect(f.mock.calls[0][0]).toBe(REGISTER_ROUTE);
    expect(f.mock.calls[0][1].method ?? "GET").toBe("GET");
    expect(res).toEqual({ ok: false, error: "Owner register unavailable" });
  });

  it("times out a hung request after 20s", async () => {
    jest.useFakeTimers();
    try {
      const f = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })
      );
      const pending = fetchOwnerRegister(new AbortController().signal, f as unknown as typeof fetch);
      jest.advanceTimersByTime(REGISTER_REQUEST_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ ok: false, error: "Request timed out" });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("MissionControlClient — register poll", () => {
  const realFetch = global.fetch;
  let registerMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    registerMock = jest.fn();
    global.fetch = ((url: string, init: RequestInit) => {
      if (url === REGISTER_ROUTE) return registerMock(url, init);
      if (url === EVIDENCE_ROUTE) return Promise.resolve(json(200, evidenceBody()));
      if (url === LIVE_AGENTS_ROUTE) return Promise.resolve(json(503, { error: "agents disabled" }));
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  const flush = () => act(async () => {});

  it("polls the register independently and sequentially, holding the last read on outage", async () => {
    registerMock
      .mockResolvedValueOnce(json(200, registerBody({ decisions: [decision(1)] })))
      .mockResolvedValueOnce(json(503, { error: "Owner register unavailable" }));
    render(<MissionControlClient />);
    await flush();
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("mc-inbox-item")).toHaveLength(1);
    expect(within(inboxSection()).getByTestId("mc-register-state")).toHaveTextContent("LIVE READ");

    await act(async () => {
      jest.advanceTimersByTime(REGISTER_POLL_MS - 1);
    });
    expect(registerMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await flush();
    expect(registerMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("mc-inbox-item")).toHaveLength(1);
    expect(within(inboxSection()).getByTestId("mc-register-state")).toHaveTextContent("HELD");
  });

  it("shows UNAVAILABLE rather than zero when the first read fails", async () => {
    registerMock.mockResolvedValue(json(503, { error: "Owner register unavailable" }));
    const { container } = render(<MissionControlClient />);
    await flush();
    expect(screen.getByTestId("mc-summary-needs")).toHaveTextContent("UNAVAILABLE — unknown");
    expect(container.textContent).not.toMatch(/\b0 open\b/);
  });

  it("never imports backend, demo fixture or write paths in the register client", () => {
    const src = readFileSync("src/components/mission-control/live-register.ts", "utf8");
    expect(src).not.toMatch(/demo-fixture|@\/lib\/|@\/app\/|googleapis|method:\s*"(POST|PUT|PATCH|DELETE)"/);
  });
});
