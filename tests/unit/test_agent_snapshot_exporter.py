"""Fixture-only tests: never read real /proc or Hermes cron."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('exporter', Path(__file__).resolve().parents[2] / 'scripts/mission-control/export-agent-snapshot.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class SnapshotTests(unittest.TestCase):
    def test_coordinator_id_is_only_read_from_local_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with patch.dict('os.environ', {}, clear=True):
                self.assertIsNone(exporter.configured_coordinator_id(home))
                config = home / '.config/mission-control/coordinator-id'
                config.parent.mkdir(parents=True)
                config.write_text('example-job-id\n')
                self.assertEqual(exporter.configured_coordinator_id(home), 'example-job-id')
                config.write_text('bad; command')
                self.assertIsNone(exporter.configured_coordinator_id(home))

    def test_complete_absence_and_missing_proc(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = exporter.snapshot(root, root / 'missing')
            self.assertEqual([a['availability'] for a in result['agents']], ['idle', 'idle'])
            result = exporter.snapshot(root / 'missing', root / 'missing')
            self.assertEqual([a['availability'] for a in result['agents']], ['unknown'] * 2)

    def test_process_redaction_partial_and_paused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proc = root / 'proc'
            proc.mkdir()
            entry = proc / '123'
            entry.mkdir()
            (entry / 'comm').write_text('node\n')
            (entry / 'exe').symlink_to('/private/node')
            (entry / 'cmdline').write_bytes(b'node\0/private/claude.js\0SECRET TASK\0')
            (entry / 'cwd').symlink_to(str(root / 'worktrees' / 'worktree'))
            (proc / '456').mkdir()  # unreadable identity -> partial
            jobs = root / 'jobs.json'
            job_id = 'example-job-id'
            jobs.write_text(json.dumps({'jobs': [{'id': job_id, 'enabled': False, 'prompt': 'SECRET CRON'}]}))
            result = exporter.snapshot(proc, jobs, job_id, root / 'worktrees')
            self.assertEqual([a['availability'] for a in result['agents']], ['running', 'unknown', 'paused'])
            raw = json.dumps(result)
            for secret in ['SECRET', '/private', '123', '456', 'prompt']:
                self.assertNotIn(secret, raw)
            self.assertIn('Observed worktree: worktree', raw)
            (entry / 'cwd').unlink()
            (entry / 'cwd').symlink_to('/private/user-name')
            self.assertNotIn('user-name', json.dumps(exporter.snapshot(proc, jobs, job_id, root / 'worktrees')))
            self.assertTrue(all(a['run'] is None for a in result['agents']))
            jobs.write_text('{invalid')
            self.assertEqual(exporter.coordinator(jobs, job_id), 'unknown')
            jobs.write_text(json.dumps({'jobs': [{'id': job_id, 'enabled': True}]}))
            self.assertEqual(exporter.coordinator(jobs, job_id), 'unknown')


if __name__ == '__main__':
    unittest.main()
