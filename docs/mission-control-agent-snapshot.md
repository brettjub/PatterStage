# Read-only live agent bridge

This optional GET `/api/mission-control/agents` route returns the snapshot directly
(`schemaVersion`, `checkedAt`, `source`, `agents`), without a `data` wrapper. It
is disabled unless both `MC_AGENT_SSH_TARGET` and `MC_AGENT_SSH_REMOTE_SCRIPT`
are explicitly set in the PC-local server environment. No query or request body
selects a host or command. Failures return sanitized HTTP 503 `{error:string}`;
all responses are `Cache-Control: no-store`. There is no cached success fallback.

## Operator setup (not performed by this change)

Copy `scripts/mission-control/export-agent-snapshot.py` to a trusted, absolute
path on the Linux VPS, preserving executable permission and the filename. Use
an unprivileged SSH account with the process visibility needed for observation.
The exporter requires Python 3 and the standard library only. Configure a local
SSH alias/key and independently verify the VPS host key before adding it to
`known_hosts`. Unknown or changed host keys fail closed; the bridge never accepts
keys automatically. Keep private keys outside the repository. Configure:

```text
MC_AGENT_SSH_TARGET=observer@vps-alias
MC_AGENT_SSH_REMOTE_SCRIPT=/opt/mission-control/export-agent-snapshot.py
```

These are placeholders, not a provisioned account or hostname. Target syntax is
restricted to a hostname/SSH alias with optional username; the script path permits
only literal safe segments and the fixed exporter filename. SSH uses an argument
array, no local shell, batch mode, strict host-key verification, no forwarding,
a five-second connection timeout, an eight-second total timeout and a 32 KiB
combined stdout/stderr limit. No remote output is logged. Treat the remote script
and SSH config as trusted operator configuration; a dedicated restricted key or
forced command can further limit remote access.

**Keep the PC app bound to `127.0.0.1` until real authentication is implemented.**
For example, run `npm run dev -- -H 127.0.0.1` locally. Loopback binding is a
network boundary, not authentication. This route does not provide authentication;
do not expose it through network bind, reverse proxy, tunnel, or public VPS HTTP.
No VPS HTTP server is needed.

## Evidence and limits

The source stamp expires after one minute. The route rejects timestamps more than 30 seconds ahead, malformed,
or already expired snapshots, unexpected fields, invalid enums, duplicate IDs,
and excessive cardinality. Clients must also stop treating a retained snapshot
as current after one minute and show an error/unknown state after a failed poll.

The exporter aggregates visible Claude Code and Codex executable identities,
including recognized Node wrapper filenames. It never emits command arguments,
prompts, environment, absolute cwd, usernames, PIDs, raw cron contents, usage or
cost. An optional sanitized worktree basename is observation only: assignment
is always unknown and `run` is always null. Other wrappers or renamed executables
may not be recognized. Idle means only that a complete scan of visible `/proc`
found no recognized executable for that runtime, not system-wide absence. Hidden
processes due to procfs mount policy cannot be established from this scan.
Read failures or scan limits make absence unknown; observed running processes
remain running with a partial coverage note. Non-Linux execution exits clearly.

If `MC_COORDINATOR_JOB_ID` is set in the VPS exporter's environment, or a job ID
is stored in `~/.config/mission-control/coordinator-id` (mode 0600), only that
ID is selected from `~/.hermes/cron/jobs.json`; otherwise no coordinator row
is returned. Keep the real ID in this local protected file or a forced SSH
command, not in this public repository. Disabled means paused; enabled,
missing, malformed, or unreadable means unknown because scheduling does not
establish process activity.
The exporter writes no state, and the route does not use the DB sync layer,
settings, dispatch or cron mutation APIs. The existing pure observations module
is preserved; its strict timestamp parser is reused by the adapter.
