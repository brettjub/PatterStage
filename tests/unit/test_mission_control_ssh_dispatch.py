import os
import pathlib
import runpy
import unittest
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).parents[2] / 'scripts/mission-control/ssh-dispatch.py'
PREFIX = '/home/brettjubinville/bin/'


class DispatcherTests(unittest.TestCase):
    def test_all_three_read_only_exporters_are_exact_commands(self):
        for name in ['export-agent-snapshot.py', 'export-mission-evidence.py', 'export-owner-register.py']:
            with self.subTest(name=name), patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': PREFIX + name}), patch('os.execve') as execve:
                runpy.run_path(str(SCRIPT))
                execve.assert_called_once()
                executable, args, env = execve.call_args.args
                self.assertEqual(executable, '/usr/bin/python3')
                self.assertEqual(args[1], '/usr/local/libexec/mission-control/' + name)
                self.assertEqual(env['HOME'], '/home/brettjubinville')
                self.assertNotIn('SSH_ORIGINAL_COMMAND', env)

    def test_arbitrary_commands_are_denied(self):
        for command in ['', '/bin/bash', PREFIX + 'export-owner-register.py --extra', PREFIX + 'export-owner-register.py;id']:
            with self.subTest(command=command), patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': command}), patch('os.execve') as execve:
                with self.assertRaises(SystemExit) as failure:
                    runpy.run_path(str(SCRIPT))
                self.assertEqual(failure.exception.code, 126)
                execve.assert_not_called()


if __name__ == '__main__': unittest.main()
