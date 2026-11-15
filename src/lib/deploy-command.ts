// ═══════════════════════════════════════════════════════════════
// deploy-command.ts — Shell command that runs ch-deploy.sh in the background
// ═══════════════════════════════════════════════════════════════
//
// The deploy runs under `systemd-run --user` (or nohup), which starts from
// the user service manager's minimal environment: `node` there is usually
// the system Node (e.g. Ubuntu's 18.x), not the one serving Control Hub
// (often nvm's). Building with a different Node than node_modules was
// installed with fails at once (better-sqlite3 NODE_MODULE_VERSION
// mismatch). So the command puts this server's own Node directory first on
// PATH; ch-deploy.sh then resolves `node` and `npm` from there.

/** Quote one argument for a POSIX shell. */
export function quoteShellSingle(arg: string): string {
  return "'" + arg.replace(/'/g, "'\"'\"'") + "'";
}

/** Directory of a Node binary path ("/home/u/.nvm/versions/node/v22/bin/node" → ".../bin"). */
export function nodeBinDir(execPath: string): string | null {
  const i = execPath.lastIndexOf("/");
  return i > 0 ? execPath.slice(0, i) : null;
}

export function buildDeployCommand(
  scriptPath: string,
  deployArgs: readonly string[],
  execPath: string = process.execPath,
): string {
  const dir = nodeBinDir(execPath);
  const pathPrefix = dir ? `export PATH=${quoteShellSingle(dir)}:"$PATH"; ` : "";
  return `${pathPrefix}sleep 1; bash ${quoteShellSingle(scriptPath)} ${deployArgs.map(quoteShellSingle).join(" ")}`.trimEnd();
}
