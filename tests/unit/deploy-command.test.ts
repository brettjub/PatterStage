/** @jest-environment node */

import { execFileSync } from "child_process";

import { buildDeployCommand, nodeBinDir, quoteShellSingle } from "@/lib/deploy-command";

describe("buildDeployCommand", () => {
  it("puts the running server's Node directory first on PATH", () => {
    const cmd = buildDeployCommand("/home/u/hub/scripts/application/ch-deploy.sh", ["update", "--branch", "main"], "/home/u/.nvm/versions/node/v22.11.0/bin/node");
    expect(cmd).toBe(
      "export PATH='/home/u/.nvm/versions/node/v22.11.0/bin':\"$PATH\"; sleep 1; bash '/home/u/hub/scripts/application/ch-deploy.sh' 'update' '--branch' 'main'",
    );
  });

  it("omits the PATH prefix when the Node path has no directory", () => {
    expect(buildDeployCommand("/s.sh", ["restart"], "node")).toBe("sleep 1; bash '/s.sh' 'restart'");
  });

  it("quotes hostile input safely", () => {
    expect(quoteShellSingle("a'b; rm -rf /")).toBe("'a'\"'\"'b; rm -rf /'");
    expect(nodeBinDir("/usr/bin/node")).toBe("/usr/bin");
  });

  it("really resolves node from that directory in a bare shell", () => {
    const dir = nodeBinDir(process.execPath)!;
    const cmd = buildDeployCommand("/dev/null", []).replace(/sleep 1; bash .*$/, "command -v node");
    const resolved = execFileSync("env", ["-i", "PATH=/usr/bin:/bin", "bash", "-c", cmd], { encoding: "utf-8" }).trim();
    expect(resolved).toBe(dir + "/node");
  });
});
