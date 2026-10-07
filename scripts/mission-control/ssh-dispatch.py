#!/usr/bin/python3
"""Forced command for the dedicated PatterStage Mission Control observation key.

Ignore client-provided shell commands except the three exact, read-only exporter
paths expected by the PC app. Execute root-owned copies without a shell.
"""
import os
import sys

COMMANDS = {
    '/home/brettjubinville/bin/export-agent-snapshot.py': '/usr/local/libexec/mission-control/export-agent-snapshot.py',
    '/home/brettjubinville/bin/export-mission-evidence.py': '/usr/local/libexec/mission-control/export-mission-evidence.py',
    '/home/brettjubinville/bin/export-owner-register.py': '/usr/local/libexec/mission-control/export-owner-register.py',
}
script = COMMANDS.get(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
if script is None:
    print('Mission Control command not permitted', file=sys.stderr)
    sys.exit(126)

# Use the observed account's HOME, but don't inherit client-provided values.
env = {
    'HOME': '/home/brettjubinville',
    'USER': 'brettjubinville',
    'LOGNAME': 'brettjubinville',
    'PATH': '/home/brettjubinville/.local/bin:/usr/bin:/bin',
    'LANG': 'C.UTF-8',
}
os.execve('/usr/bin/python3', ['python3', script], env)
