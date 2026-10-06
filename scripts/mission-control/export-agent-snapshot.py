#!/usr/bin/env python3
"""Read-only Linux process/coordinator observation; no arguments or environment output."""
import datetime
import json
import os
import re
import sys
from pathlib import Path

SOURCE = 'vps-agent-snapshot'
MAX_PROCESSES = 32768


def configured_coordinator_id(home):
    value = os.environ.get('MC_COORDINATOR_JOB_ID')
    if value is None:
        try:
            with (home / '.config/mission-control/coordinator-id').open('rb') as handle:
                raw = handle.read(65)
            value = raw.decode('ascii').strip()
        except (OSError, UnicodeError):
            return None
    return value if re.fullmatch(r'[A-Za-z0-9_-]{6,64}', value) else None


def scan_processes(proc, worktree_root=None):
    worktree_root = worktree_root or Path.home() / 'worktrees'
    found = {'claude': [], 'codex': []}
    complete = True
    try:
        entries = [p for p in proc.iterdir() if p.name.isdecimal()]
    except OSError:
        return found, False
    if len(entries) > MAX_PROCESSES:
        complete = False
    for entry in entries[:MAX_PROCESSES]:
        try:
            # Inspect executable identity; command arguments are never emitted.
            comm = (entry / 'comm').read_text()[:128].strip()
            exe = os.path.basename(os.readlink(entry / 'exe'))
            runtime = next((r for r in found if comm == r or exe == r), None)
            if runtime is None and exe in ('node', 'nodejs'):
                # Node wrappers: only argv[1]'s basename is used as identity.
                with (entry / 'cmdline').open('rb') as handle:
                    prefix = handle.read(4096).split(b'\0', 2)
                if len(prefix) < 3:
                    complete = False
                else:
                    script = os.path.basename(os.fsdecode(prefix[1]))
                    if script in ('claude', 'claude.js'):
                        runtime = 'claude'
                    elif script in ('codex', 'codex.js'):
                        runtime = 'codex'
            if runtime:
                basename = None
                try:
                    cwd = Path(os.readlink(entry / 'cwd'))
                    candidate = cwd.name
                    if cwd != worktree_root and cwd.is_relative_to(worktree_root) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', candidate):
                        basename = candidate
                except OSError:
                    pass
                found[runtime].append(basename)
        except FileNotFoundError:
            # A process may exit while scanning. A still-present entry is incomplete.
            if entry.exists():
                complete = False
        except (OSError, UnicodeError):
            complete = False
    return found, complete


def coordinator(path, coordinator_id):
    if not coordinator_id or not re.fullmatch(r'[A-Za-z0-9_-]{6,64}', coordinator_id):
        return 'unknown'
    try:
        with path.open('rb') as handle:
            raw = handle.read(1048577)
        if len(raw) > 1048576:
            return 'unknown'
        data = json.loads(raw)
        jobs = data if isinstance(data, list) else data.get('jobs', []) if isinstance(data, dict) else []
        if not isinstance(jobs, list):
            return 'unknown'
        matches = [job for job in jobs if isinstance(job, dict) and job.get('id') == coordinator_id]
        if len(matches) == 1 and matches[0].get('enabled') is False:
            return 'paused'
        # Enabled is scheduling evidence, not evidence of a running coordinator.
        return 'unknown'
    except (OSError, ValueError, TypeError):
        return 'unknown'


def snapshot(proc, jobs, coordinator_id=None, worktree_root=None):
    checked = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    found, complete = scan_processes(proc, worktree_root)
    agents = []

    def add(identifier, name, runtime, availability, note):
        agents.append(dict(id=identifier, name=name, runtime=runtime, availability=availability,
                           run=None, note=note, stamp=dict(source=SOURCE, kind='live', checkedAt=checked, staleAfterMinutes=1)))

    for runtime, names in found.items():
        coverage = 'Complete scan of visible /proc executable identities only' if complete else 'Partial or unavailable /proc scan; absence is not idle'
        note = coverage + '; assignment unknown.'
        # Aggregate per runtime to bound cardinality, without leaking PIDs or identities.
        if names and names[0]:
            note += ' Observed worktree: ' + names[0] + '.'
        add(runtime, 'Claude Code' if runtime == 'claude' else 'Codex', runtime,
            'running' if names else 'idle' if complete else 'unknown', note)
    if coordinator_id and re.fullmatch(r'[A-Za-z0-9_-]{6,64}', coordinator_id):
        add('configured-coordinator', 'Configured coordinator', 'hermes', coordinator(jobs, coordinator_id),
            'Configured coordinator schedule only; enabled does not establish process activity or assignment.')
    return dict(schemaVersion=1, checkedAt=checked, source=SOURCE, agents=agents)


if __name__ == '__main__':
    if sys.platform != 'linux':
        sys.stderr.write('Agent snapshot requires Linux /proc.\n')
        sys.exit(1)
    home = Path.home()
    print(json.dumps(snapshot(Path('/proc'), home / '.hermes/cron/jobs.json',
                              configured_coordinator_id(home)), separators=(',', ':')))
