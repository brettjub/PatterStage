import importlib.util
import pathlib
import io
import json
import os
import tempfile
from unittest.mock import MagicMock
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('exporter', pathlib.Path(__file__).parents[2] / 'scripts/mission-control/export-mission-evidence.py')
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)

class EvidenceTests(unittest.TestCase):
    def test_isolation(self):
        with patch.object(e, 'hermes', side_effect=RuntimeError('secret')), patch.object(e, 'github', side_effect=RuntimeError('secret')), patch.object(e, 'drive', return_value=[]):
            result = e.snapshot()
        self.assertEqual([s['status'] for s in result['sources']], ['unavailable', 'unavailable', 'live'])
        self.assertNotIn('secret', str(result))
        self.assertIsNone(result['sources'][0]['checkedAt'])

    def test_drive_pagination_scope_and_projection(self):
        record = {'id': 'file_1', 'name': 'Hello\nworld sk-abcdef', 'mimeType': 'text/plain', 'modifiedTime': '2026-01-01T00:00:00Z', 'content': 'secret'}
        with patch.object(e, 'connector_get', side_effect=[{'user': {'emailAddress': e.ACCOUNT}}, {'files': [record], 'nextPageToken': 'next'}, {'files': []}]) as get:
            items = e.drive()
        self.assertEqual(len(items), 1)
        self.assertNotIn('secret', str(items))
        self.assertNotIn('sk-abcdef', str(items))
        for call in get.call_args_list[1:]:
            self.assertIn(e.FOLDER, call.args[0])
            self.assertNotIn('content', call.args[0])
        self.assertIn('pageToken=next', get.call_args_list[2].args[0])
        with patch.object(e, 'connector_get', return_value={'user': {'emailAddress': 'wrong@example.com'}}) as get:
            self.assertRaises(ValueError, e.drive)
        self.assertEqual(get.call_count, 1)

    def test_caps_and_time(self):
        with patch.object(e, 'connector_get', side_effect=[{'user': {'emailAddress': e.ACCOUNT}}, {'files': [{}] * 101}]):
            self.assertRaises(ValueError, e.drive)
        for value in ['2099-01-01T00:00:00Z', 'not-a-date', '2026-02-30T00:00:00Z']:
            self.assertRaises(ValueError, e.timestamp, value)

    def test_connector_is_get_only_no_shell_and_bounded(self):
        process = MagicMock()
        process.__enter__.return_value = process
        process.stdout = io.BytesIO(b'{"files":[]}')
        process.wait.return_value = 0
        process.poll.return_value = 0
        selector = MagicMock()
        selector.select.return_value = [True]
        with patch.dict(os.environ, {'MC_EVIDENCE_DRIVE_ACCOUNT': 'test-selector'}), patch.object(e.subprocess, 'Popen', return_value=process) as spawn, patch.object(e.selectors, 'DefaultSelector', return_value=selector):
            self.assertEqual(e.connector_get('https://www.googleapis.com/drive/v3/files'), {'files': []})
        args = spawn.call_args.args[0]
        self.assertEqual(args[-2:], ['--method', 'GET'])
        self.assertEqual(args[args.index('--account') + 1], 'test-selector')
        self.assertFalse(spawn.call_args.kwargs['shell'])
        self.assertEqual(spawn.call_args.kwargs['stderr'], e.subprocess.DEVNULL)
        process.stdout = io.BytesIO(b'x' * (e.MAX_BYTES + 1))
        process.poll.return_value = None
        with patch.dict(os.environ, {'MC_EVIDENCE_DRIVE_ACCOUNT': 'test-selector'}), patch.object(e.subprocess, 'Popen', return_value=process), patch.object(e.selectors, 'DefaultSelector', return_value=selector):
            self.assertRaises(ValueError, e.connector_get, 'https://www.googleapis.com/drive/v3/files')
        process.kill.assert_called_once()

    def test_hermes_allowlisted_projection_never_emits_prompt_or_identifier(self):
        with tempfile.TemporaryDirectory() as root:
            selector = pathlib.Path(root) / 'selector'
            selector.write_text('private-job-id')
            selector.chmod(0o600)
            jobs = pathlib.Path(root) / 'jobs.json'
            jobs.write_text(json.dumps({'jobs': [
                {'id': 'other-job', 'enabled': True, 'prompt': 'other secret'},
                {'id': 'private-job-id', 'enabled': False, 'state': 'paused',
                 'prompt': 'never show this secret', 'origin': 'private@example.com',
                 'last_run_at': '2026-10-06T20:55:58.239178+00:00', 'last_status': 'ok'}]}))
            with patch.object(e, 'HERMES_SELECTOR', selector), patch.object(e, 'HERMES_JOBS', jobs):
                items = e.hermes()
            self.assertEqual([item['kind'] for item in items], ['task', 'run'])
            self.assertEqual(items[0]['status'], 'paused')
            self.assertNotIn('private-job-id', str(items))
            self.assertNotIn('secret', str(items))
            self.assertNotIn('private@example.com', str(items))
            selector.chmod(0o644)
            with patch.object(e, 'HERMES_SELECTOR', selector), patch.object(e, 'HERMES_JOBS', jobs):
                self.assertRaises(ValueError, e.hermes)

    def test_github_checks_are_not_deployment(self):
        pr = {'number': 1, 'head': {'sha': 'a' * 40}, 'title': 'PR', 'state': 'open', 'updated_at': '2026-01-01T00:00:00Z'}
        with patch.object(e, 'public_get', side_effect=[[pr], {'check_runs': [{'conclusion': 'success'}]}]) as get:
            items = e.github()
        self.assertIn('deployment unverified', items[0]['note'])
        self.assertEqual(get.call_count, 2)

if __name__ == '__main__':
    unittest.main()
