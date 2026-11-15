/** @jest-environment node */

import { buildHermesSyncPrompt, HUB_SYNC_SCHEDULES, HUB_SYNC_SOURCES } from "@/lib/hub/hermes-sync";
import { parseSchedule } from "@/lib/schedule/parse-schedule";

describe("buildHermesSyncPrompt", () => {
  it("includes only the chosen sources, the endpoint, and the read-only rule", () => {
    const text = buildHermesSyncPrompt("http://127.0.0.1:3000/api/hub/import", ["gmail", "github"]);
    expect(text).toContain("Gmail: threads");
    expect(text).toContain("GitHub (use GITHUB_TOKEN)");
    expect(text).not.toContain("Google Calendar:");
    expect(text).toContain("curl -s -X POST http://127.0.0.1:3000/api/hub/import");
    expect(text).toMatch(/Read only\. Never send/);
  });

  it("every source has a unique id", () => {
    const ids = HUB_SYNC_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("HUB_SYNC_SCHEDULES", () => {
  it.each(HUB_SYNC_SCHEDULES.map((s) => [s.label, s.value]))("%s (%s) is a schedule Hermes accepts", (_label, value) => {
    expect(parseSchedule(value).kind).not.toBe("invalid");
  });
});
