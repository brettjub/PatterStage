/** @jest-environment node */

import { existsSync } from "fs";
import { join, resolve } from "path";
import { homedir, tmpdir } from "os";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";

jest.mock("fs", () => ({
  ...jest.requireActual<typeof import("fs")>("fs"),
  existsSync: jest.fn(jest.requireActual<typeof import("fs")>("fs").existsSync),
}));
// The runtime's temp directory may live inside the real ~/.hermes tree.
// Use a distinct synthetic home so these fixtures exercise a non-native
// HERMES_HOME regardless of where CI or the agent puts temporary files.
jest.mock("os", () => {
  const actual = jest.requireActual<typeof import("os")>("os");
  return { ...actual, homedir: () => `${actual.homedir()}/patterstage-package-test-home` };
});

import {
  getHermesAgentPackageDir,
  resolveHermesAgentPackage,
  resolveHermesVenvPython,
} from "@/lib/hermes-package-path";

const existsSyncMock = existsSync as jest.MockedFunction<typeof existsSync>;

describe("hermes-package-path", () => {
  afterEach(() => {
    existsSyncMock.mockImplementation(jest.requireActual<typeof import("fs")>("fs").existsSync);
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_AGENT_ROOT;
    delete process.env.HERMES_AGENT_VENV_PYTHON;
  });

  it("resolves package under hermes home only", () => {
    const base = mkdtempSync(join(tmpdir(), "ch-hermes-pkg-"));
    const pkg = join(base, "hermes-agent");
    mkdirSync(join(pkg, "cron"), { recursive: true });
    writeFileSync(join(pkg, "cron", "jobs.py"), "# stub\n");

    existsSyncMock.mockImplementation((p) => {
      const s = String(p);
      if (s === join(pkg, "cron", "jobs.py")) return true;
      return jest.requireActual<typeof import("fs")>("fs").existsSync(p);
    });

    expect(getHermesAgentPackageDir(base)).toBe(resolve(pkg));
    expect(resolveHermesAgentPackage(base)).toBe(resolve(pkg));
  });

  it("does not consult ~/.local/share/hermes-agent", () => {
    const base = mkdtempSync(join(tmpdir(), "ch-hermes-missing-"));
    const legacyShare = join(homedir(), ".local", "share", "hermes-agent");

    existsSyncMock.mockImplementation((p) => {
      const s = String(p);
      if (s.startsWith(legacyShare)) return true;
      return false;
    });

    expect(resolveHermesAgentPackage(base)).toBeNull();
    const calls = existsSyncMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((p) => p.includes(".local/share/hermes-agent"))).toBe(false);
  });

  it("throws when venv python is missing", () => {
    const base = mkdtempSync(join(tmpdir(), "ch-hermes-no-venv-"));
    const pkg = join(base, "hermes-agent");
    mkdirSync(join(pkg, "cron"), { recursive: true });
    writeFileSync(join(pkg, "cron", "jobs.py"), "# stub\n");

    existsSyncMock.mockImplementation((p) => {
      const s = String(p);
      if (s === join(pkg, "cron", "jobs.py")) return true;
      if (s.includes("venv/bin/python3") || s.includes(".venv/bin/python3")) return false;
      return jest.requireActual<typeof import("fs")>("fs").existsSync(p);
    });

    expect(() => resolveHermesVenvPython(base)).toThrow(/venv Python not found/);
  });
});
