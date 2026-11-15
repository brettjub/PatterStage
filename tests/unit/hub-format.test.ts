/** @jest-environment node */

import {
  addDays,
  buildTaskMissionInstruction,
  daysBetween,
  describeDue,
  percent,
  todayLocal,
} from "@/lib/hub/hub-format";

describe("dates", () => {
  it("formats local dates and counts days across month and year ends", () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2026-12-01")).toBe(-30);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it.each([
    ["2026-03-07", { label: "3d overdue", tone: "overdue" }],
    ["2026-03-10", { label: "Today", tone: "today" }],
    ["2026-03-11", { label: "Tomorrow", tone: "soon" }],
    ["2026-03-13", { label: "Fri", tone: "soon" }],
    ["2026-04-02", { label: "Apr 2", tone: "later" }],
    ["2027-01-15", { label: "Jan 15, 2027", tone: "later" }],
  ])("due %s relative to 2026-03-10 (a Tuesday)", (due, expected) => {
    expect(describeDue(due, "2026-03-10")).toEqual(expected);
  });
});

describe("buildTaskMissionInstruction", () => {
  it("includes project, due date and notes when present", () => {
    const text = buildTaskMissionInstruction({
      title: " Research hosting options ",
      notes: "Compare Render and Fly.\nBudget under $20/month.",
      projectName: "Website",
      dueDate: "2026-05-01",
    });
    expect(text).toBe(
      [
        "Task: Research hosting options",
        "Project: Website",
        "Due: 2026-05-01",
        "",
        "Details:",
        "Compare Render and Fly.\nBudget under $20/month.",
        "",
        "When you finish, summarise what you did and anything I still need to do.",
      ].join("\n"),
    );
  });

  it("omits empty parts", () => {
    expect(buildTaskMissionInstruction({ title: "Tidy", notes: "  ", projectName: null, dueDate: null })).toBe(
      "Task: Tidy\n\nWhen you finish, summarise what you did and anything I still need to do.",
    );
  });
});

describe("percent", () => {
  it("rounds and handles zero totals", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
  });
});
