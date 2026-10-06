/** @jest-environment jsdom */

/**
 * Mission Control owner overview — labelling, freshness cues, state
 * separation, read-only guarantees and keyboard/mobile semantics.
 * Renders the pure component with a fixed clock; no network or disk access.
 */

import { render, screen, within } from "@testing-library/react";
import OwnerOverview from "@/components/mission-control/OwnerOverview";
import { buildDemoSnapshot } from "@/components/mission-control/demo-fixture";
import type { OwnerOverviewSnapshot } from "@/components/mission-control/types";

const NOW = Date.parse("2030-01-15T12:00:00.000Z");

function renderOverview(snapshot: OwnerOverviewSnapshot = buildDemoSnapshot(NOW)) {
  return render(<OwnerOverview snapshot={snapshot} nowMs={NOW} />);
}

function agentRow(id: string): HTMLElement {
  const row = screen.getAllByTestId("mc-agent-row").find((el) => el.dataset.agentId === id);
  if (!row) throw new Error(`agent row ${id} missing`);
  return row;
}

describe("OwnerOverview — demo labelling", () => {
  it("shows a persistent DEMO / NOT CONNECTED / NOT LIVE banner", () => {
    renderOverview();
    const banner = screen.getByRole("complementary", { name: "Data source notice" });
    expect(banner).toHaveTextContent("DEMO · NOT CONNECTED · NOT LIVE");
    expect(banner).toHaveTextContent(/read-only/i);
  });

  it("attaches a source tag to every inbox, agent and project row", () => {
    renderOverview();
    for (const testId of ["mc-inbox-item", "mc-agent-row", "mc-project-row"]) {
      for (const row of screen.getAllByTestId(testId)) {
        const tag = within(row).getByTestId("mc-source-tag");
        expect(tag.dataset.sourceKind).not.toBe("live");
        expect(tag).toHaveTextContent(/DEMO|NOT CONNECTED/);
      }
    }
  });

  it("labels demo timestamps as simulated", () => {
    renderOverview();
    const tag = within(agentRow("demo-agent-a")).getByTestId("mc-source-tag");
    expect(tag).toHaveTextContent("simulated check 2m ago");
    expect(tag).toHaveTextContent("2030-01-15 11:58 UTC");
  });

  it("lists only synthetic example projects as UNVERIFIED with no successful check", () => {
    renderOverview();
    const rows = screen.getAllByTestId("mc-project-row");
    const names = rows.map((r) => within(r).getByRole("heading", { level: 3 }).textContent);
    expect(names).toEqual([
      "Example project Alpha",
      "Example project Beta",
      "Example project Gamma",
      "Example project Delta",
      "Example ideas",
    ]);
    for (const r of rows) {
      expect(r).toHaveTextContent("UNVERIFIED");
      expect(within(r).getByTestId("mc-source-tag").dataset.freshness).toBe("unknown");
      expect(r).toHaveTextContent("No successful check on record");
    }
  });

  it("presents the example blocker as synthetic and unverified — not a current status", () => {
    renderOverview();
    const row = screen.getAllByTestId("mc-project-row").find((r) => r.dataset.projectId === "example-alpha")!;
    expect(row).toHaveTextContent("Recorded blocker");
    expect(row).toHaveTextContent(/synthetic, not a real status/);
    expect(screen.getByTestId("mc-summary-blocker")).toHaveTextContent("Example project Alpha — demo, unverified");
  });
});

describe("OwnerOverview — agent states and freshness", () => {
  it("renders running, idle, paused, STALE and unknown as distinct text states", () => {
    renderOverview();
    const shown = (id: string) =>
      within(agentRow(id)).getByTestId("mc-agent-availability").querySelector("[data-state]")!;
    expect(shown("demo-agent-a")).toHaveTextContent("Running");
    expect(shown("demo-agent-b")).toHaveTextContent("Idle");
    expect(shown("demo-agent-c")).toHaveTextContent("STALE");
    expect(shown("demo-agent-d")).toHaveTextContent("Paused");
    expect(shown("demo-agent-e")).toHaveTextContent("Unknown");
  });

  it("does not show a stale heartbeat as idle; keeps the last reported state secondary", () => {
    renderOverview();
    const row = agentRow("demo-agent-c");
    const availability = within(row).getByTestId("mc-agent-availability");
    expect(availability.querySelector("[data-state]")).toHaveAttribute("data-state", "stale");
    expect(availability).toHaveTextContent("last reported: Idle");
    expect(within(row).getByTestId("mc-source-tag")).toHaveTextContent(/STALE — simulated last success 3h ago/);
  });

  it("keeps availability and run state in separate labelled fields", () => {
    renderOverview();
    const a = agentRow("demo-agent-a");
    expect(within(a).getByText("Availability")).toBeInTheDocument();
    expect(within(a).getByText("Run state")).toBeInTheDocument();
    expect(within(a).getByTestId("mc-agent-run")).toHaveTextContent("Running");

    // Availability unknown, run interrupted — the run is never reported as completed.
    const e = agentRow("demo-agent-e");
    expect(within(e).getByTestId("mc-agent-availability")).toHaveTextContent("Unknown");
    expect(within(e).getByTestId("mc-agent-run")).toHaveTextContent("Interrupted");

    expect(within(agentRow("demo-agent-b")).getByTestId("mc-agent-run")).toHaveTextContent("No run assigned");
  });

  it("flips a fresh agent to STALE when its heartbeat ages past the threshold", () => {
    const snap = buildDemoSnapshot(NOW);
    const later = NOW + 60 * 60_000; // demo-agent-a threshold is 15 minutes
    render(<OwnerOverview snapshot={snap} nowMs={later} />);
    const avail = within(agentRow("demo-agent-a")).getByTestId("mc-agent-availability");
    expect(avail.querySelector("[data-state]")).toHaveAttribute("data-state", "stale");
    expect(avail).toHaveTextContent("last reported: Running");
  });

  it("summarises freshness without claiming any live source", () => {
    renderOverview();
    expect(screen.getByTestId("mc-summary-freshness")).toHaveTextContent(/^0 live sources · \d+ stale or unchecked$/);
    expect(screen.getByTestId("mc-summary-agents")).toHaveTextContent("1 running · 1 paused · 1 idle · 1 STALE · 1 unknown");
  });

  it("shows deliverables as not connected and spend as unavailable, not zero", () => {
    renderOverview();
    const empty = screen.getByTestId("mc-deliverables-empty");
    expect(empty).toHaveTextContent("Not connected");
    expect(within(empty).getByTestId("mc-source-tag").dataset.sourceKind).toBe("not_connected");
    expect(screen.getByText(/Unknown is not \$0/)).toBeInTheDocument();
  });
});

describe("OwnerOverview — Owner inbox", () => {
  it("sorts items oldest first and flags items older than 3 days", () => {
    renderOverview();
    const items = screen.getAllByTestId("mc-inbox-item");
    expect(items[0]).toHaveTextContent("raised 6d ago");
    expect(items[0]).toHaveTextContent("Older than 3 days");
    expect(items[items.length - 1]).toHaveTextContent("raised 3h ago");
    expect(items[items.length - 1]).not.toHaveTextContent("Older than 3 days");
    expect(screen.getByTestId("mc-summary-needs")).toHaveTextContent("5 open · oldest 6d ago");
  });

  it("explains why approval is unavailable instead of rendering an approve control", () => {
    renderOverview();
    expect(screen.getByText(/Approve \/ reject unavailable/)).toBeInTheDocument();
  });
});

describe("OwnerOverview — read-only guarantees", () => {
  it("renders no enabled buttons, forms or inputs", () => {
    const { container } = renderOverview();
    const enabledButtons = screen.queryAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabledButtons).toHaveLength(0);
    expect(container.querySelector("form, input, textarea, select")).toBeNull();
  });

  it("only links to in-page anchors (no API or external targets)", () => {
    renderOverview();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^#/);
    }
  });
});

describe("OwnerOverview — keyboard and mobile semantics", () => {
  it("provides a labelled jump nav whose targets are focusable, labelled sections", () => {
    renderOverview();
    const nav = screen.getByRole("navigation", { name: "Owner overview sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Owner inbox",
      "Agents",
      "Projects",
      "Deliverables & risks",
    ]);
    for (const link of links) {
      const id = link.getAttribute("href")!.slice(1);
      const target = document.getElementById(id)!;
      expect(target.tagName).toBe("SECTION");
      expect(target).toHaveAttribute("tabindex", "-1");
      const heading = document.getElementById(target.getAttribute("aria-labelledby")!)!;
      expect(heading.tagName).toBe("H2");
      target.focus();
      expect(document.activeElement).toBe(target);
    }
  });

  it("puts the owner inbox before the agent board in reading/tab order", () => {
    renderOverview();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Owner inbox")).toBeLessThan(headings.indexOf("Agent board"));
    expect(headings.indexOf("Agent board")).toBeLessThan(headings.indexOf("Project radar"));
  });

  it("uses touch-sized jump links and single-column layout by default", () => {
    renderOverview();
    const nav = screen.getByRole("navigation", { name: "Owner overview sections" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
    }
    const agentList = screen.getByRole("list", { name: "Agents" });
    expect(agentList.className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
    expect(screen.getByRole("list", { name: "Projects" }).className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
  });

  it("never conveys state by colour alone — every state chip has text", () => {
    renderOverview();
    for (const chip of document.querySelectorAll("[data-state]")) {
      expect(chip.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});
