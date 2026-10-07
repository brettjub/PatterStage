/**
 * Mission Control requirements ledger — coverage and hygiene.
 * Reads docs/mission-control-requirements-ledger.md. When the local source
 * snapshots exist (owner machine only), also extracts every defined ID from
 * them and checks the ledger matches exactly; otherwise that check is skipped.
 */

import fs from "fs";
import os from "os";

const LEDGER = fs.readFileSync(process.cwd() + "/docs/mission-control-requirements-ledger.md", "utf8");
const SNAPSHOT_DIR = os.homedir() + "/.hermes/cache/scratch/agent-command-center-source/";

const range = (prefix: string, n: number, pad: boolean) =>
  Array.from({ length: n }, (_, i) => `${prefix}-${pad ? String(i + 1).padStart(2, "0") : i + 1}`);

const EXPECTED: Record<"ACR" | "PRD" | "BP", string[]> = {
  ACR: [
    ...range("REG", 6, false),
    ...range("RUN", 7, false),
    ...range("APPR", 5, false),
    ...range("GUARD", 5, false),
    ...range("DEP", 5, false),
    ...range("MAP", 3, false),
    ...range("FIND", 3, false),
    ...range("SCORE", 5, false),
    ...range("ALERT", 3, false),
    ...range("REF", 3, false),
    ...range("COST", 2, false),
  ],
  PRD: [
    ...range("TASK", 5, true),
    ...range("AGENT", 4, true),
    ...range("CTRL", 3, true),
    ...range("KNOW", 2, true),
    ...range("FILE", 2, true),
    ...range("AUTO", 1, true),
    ...range("OPS", 3, true),
    ...range("WF", 6, true),
    ...range("AC", 12, true),
  ],
  BP: [...range("MC", 11, true), ...range("AC", 9, true)],
};

const STATUSES = new Set(["implemented", "partial", "not started"]);

/** Ledger rows: `| NS:ID | summary | status | ...`. */
function ledgerRows(): { id: string; status: string }[] {
  return LEDGER.split("\n")
    .filter((l) => /^\| (ACR|PRD|BP):[A-Z]+-\d+ \|/.test(l))
    .map((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return { id: cells[1], status: cells[3] };
    });
}

/** IDs as defined (not merely referenced) in each snapshot. */
function extractFromSnapshots(): Record<"ACR" | "PRD" | "BP", string[]> {
  const read = (f: string) => fs.readFileSync(SNAPSHOT_DIR + f, "utf8");
  const all = (text: string, re: RegExp) => Array.from(text.matchAll(re), (m) => m[1]);
  const acr = read("latest_claude.md");
  const prd = read("existing_markdown.md");
  const bp = read("mission-control-blueprint.md");
  return {
    ACR: all(acr, /\*\*((?:REG|RUN|APPR|GUARD|DEP|MAP|FIND|SCORE|ALERT|REF|COST)-\d+) ·/g),
    PRD: [
      ...all(prd, /\*\*((?:TASK|AGENT|CTRL|KNOW|FILE|AUTO|OPS)-\d+) —/g),
      ...all(prd, /^### (WF-\d+):/gm),
      ...all(prd, /^\| (AC-\d+) \|/gm),
    ],
    BP: [...all(bp, /\*\*(MC-\d+) /g), ...all(bp, /\*\*(AC-\d+):\*\*/g)],
  };
}

describe("requirements ledger", () => {
  const rows = ledgerRows();

  it("has exactly one row per expected namespaced ID (105 total)", () => {
    const expected = Object.entries(EXPECTED).flatMap(([ns, ids]) => ids.map((id) => `${ns}:${id}`));
    expect(expected).toHaveLength(105);
    expect(rows.map((r) => r.id).sort()).toEqual([...expected].sort());
  });

  it("uses only the three allowed statuses and claims nothing implemented", () => {
    for (const r of rows) expect(STATUSES.has(r.status)).toBe(true);
    expect(rows.filter((r) => r.status === "implemented")).toEqual([]);
  });

  it("records the owner timezone default and scope exclusions", () => {
    expect(LEDGER).toMatch(/Owner timezone — America\/Edmonton default/);
    expect(LEDGER).toContain("America/Edmonton");
    expect(LEDGER).toContain("America/Denver");
    expect(LEDGER).toMatch(/brokerage/i);
    expect(LEDGER).toMatch(/clinical/i);
    expect(LEDGER).toMatch(/Launchhost coordinator paused/);
    expect(LEDGER).toMatch(/Local-only security gate/);
  });

  it("copies no currency amounts or credential-like strings", () => {
    expect(LEDGER).not.toMatch(/\$\s?\d/);
    expect(LEDGER).not.toMatch(/\b(sk-|ghp_|github_pat_|AKIA|xox[bp]-)/);
    expect(LEDGER).not.toMatch(/@[a-z0-9-]+\.(com|ai|net)\b/i);
  });

  (fs.existsSync(SNAPSHOT_DIR) ? it : it.skip)("matches every ID defined in the local source snapshots", () => {
    const found = extractFromSnapshots();
    for (const ns of ["ACR", "PRD", "BP"] as const) {
      expect([...found[ns]].sort()).toEqual([...EXPECTED[ns]].sort());
    }
  });
});
