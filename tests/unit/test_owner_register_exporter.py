import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('owner_register_exporter', pathlib.Path(__file__).parents[2] / 'scripts/mission-control/export-owner-register.py')
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)
PAST = '2026-10-06T10:00:00Z'
PROJECTS = [e.HEADERS['Projects'], ['ngm', 'New Growth Media', '', 'unknown'], ['launchhost', 'Launchhost', '', 'unknown']]
DECISIONS = [e.HEADERS['Decisions']]


def snap(decisions=DECISIONS, projects=PROJECTS, email=e.ACCOUNT):
    with patch.object(e, 'connector_get', side_effect=[
        {'user': {'emailAddress': email}},
        {'valueRanges': [{'values': decisions}, {'values': projects}]}
    ]) as get:
        result = e.snapshot('selected-drive-account', '1YOKOBjrY-matyNcaSEg8-NFJAR7433ntas7UKG_jYzI')
    return result, get


class RegisterTests(unittest.TestCase):
    def test_empty_inbox_unknown_seeded_projects_and_narrow_read(self):
        result, get = snap()
        self.assertEqual(result['schemaVersion'], 1)
        self.assertEqual(result['decisions'], [])
        self.assertEqual([(row['id'], row['recordedState']) for row in result['projects']], [('ngm', 'unknown'), ('launchhost', 'unknown')])
        self.assertTrue(all('ownerReviewedAt' not in row for row in result['projects']))
        self.assertEqual(get.call_count, 2)
        self.assertIn('valueRenderOption=FORMULA', get.call_args.args[0])
        self.assertNotIn('I102', get.call_args.args[0])
        self.assertNotIn('I52', get.call_args.args[0])
        self.assertIn('1YOKOBjrY-matyNcaSEg8-NFJAR7433ntas7UKG_jYzI', get.call_args.args[0])
        self.assertNotIn('Guide', get.call_args.args[0])

    def test_only_open_validated_decisions_and_owner_reviewed_status(self):
        row = ['d-1', 'ngm', 'Pick a budget', 'Campaign budget', 'Spend changes', PAST, 'open', PAST]
        closed = ['d-2', 'ngm', 'Old decision', 'Old target', '', PAST, 'closed']
        active = [e.HEADERS['Projects'], ['ngm', 'New Growth Media', '', 'active', 'Planning', '', 'Owner update', PAST], PROJECTS[2]]
        result, _ = snap([e.HEADERS['Decisions'], row, closed], active)
        self.assertEqual([x['id'] for x in result['decisions']], ['d-1'])
        self.assertEqual(result['projects'][0]['recordedState'], 'active')
        self.assertEqual(result['projects'][0]['ownerReviewedAt'], '2026-10-06T10:00:00.000Z')

    def test_wrong_identity_does_not_read_sheet(self):
        with patch.object(e, 'connector_get', return_value={'user': {'emailAddress': 'wrong@example.com'}}) as get:
            with self.assertRaises(ValueError): e.snapshot('selected-drive-account', '1YOKOBjrY-matyNcaSEg8-NFJAR7433ntas7UKG_jYzI')
        self.assertEqual(get.call_count, 1)

    def test_unreviewed_claims_and_bad_content_fail_closed(self):
        for projects in [
            [e.HEADERS['Projects'], ['ngm', 'New Growth Media', '', 'active']],
            [e.HEADERS['Projects'], ['ngm', '=IMPORTDATA("url")', '', 'unknown']],
            [e.HEADERS['Projects'], ['ngm', 'secret sk-abcdefghijk', '', 'unknown']],
            [e.HEADERS['Projects'], ['ngm', 'Name', '', 'green']],
            [e.HEADERS['Projects'], ['ngm', 'Name', '', 'unknown'], ['ngm', 'duplicate', '', 'unknown']],
            [e.HEADERS['Projects'], ['ngm', 'Name', '', 'unknown', '', '', '', '', 'https://user:password@docs.google.com/spreadsheets/d/abc/edit']],
        ]:
            with self.subTest(projects=projects):
                with self.assertRaises(ValueError): snap(projects=projects)

    def test_decisions_require_exact_target_project_and_utc(self):
        for row in [
            ['d-1', 'missing', 'Title', 'Target', '', PAST, 'open'],
            ['d-1', 'ngm', 'Title', '', '', PAST, 'open'],
            ['d-1', 'ngm', 'Title', 'Target', '', '2099-01-01T00:00:00Z', 'open'],
            ['d-1', 'ngm', 'Title', 'Target', '', PAST, 'approved'],
            ['d-1', 'ngm', 'Title', 'Target', '', PAST, 'open', '', 'https://evil.example/'],
        ]:
            with self.subTest(row=row):
                with self.assertRaises(ValueError): snap(decisions=[e.HEADERS['Decisions'], row])

    def test_header_cap_and_duplicate_decision(self):
        with self.assertRaises(ValueError): snap(projects=[['different']])
        with self.assertRaises(ValueError): snap(projects=PROJECTS + [['x' + str(i), 'Name', '', 'unknown'] for i in range(50)])
        row = ['d-1', 'ngm', 'Title', 'Target', '', PAST, 'open']
        with self.assertRaises(ValueError): snap(decisions=[e.HEADERS['Decisions'], row, row])


if __name__ == '__main__': unittest.main()
