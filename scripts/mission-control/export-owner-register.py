#!/usr/bin/env python3
"""Bounded read-only projection of one owner-maintained Google Sheet.

No credentials, formulas, raw responses, or connector errors are emitted. The
selector grants access only to the approved NGM account and private sheet ID.
"""
import datetime as dt
import json
import os
import pathlib
import re
import selectors
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ACCOUNT = 'brett@newgrowthmedia.com'
SELECTOR_FILE = pathlib.Path.home() / '.config/mission-control/drive-account'
SHEET_ID_FILE = pathlib.Path.home() / '.config/mission-control/register-sheet-id'
COMPOSIO = str(pathlib.Path.home() / '.local/bin/composio')
MAX_BYTES = 131072
DEADLINE = time.monotonic() + 14
HEADERS = {
    'Decisions': ['Decision ID', 'Project ID', 'Title', 'Exact target', 'Impact', 'Raised at UTC', 'Status', 'Owner reviewed at UTC', 'Source URL'],
    'Projects': ['Project ID', 'Name', 'Outcome', 'Recorded state', 'Position', 'Blocker', 'Next move', 'Owner reviewed at UTC', 'Source URL'],
}
IDENTIFIER = re.compile(r'[a-z][a-z0-9_-]{0,63}\Z')
SHEET_ID = re.compile(r'[A-Za-z0-9_-]{20,100}\Z')
UTC = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z\Z')
SECRET = re.compile(r'(?i)(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{8,}|Bearer\s+\S+')


def private_selector(path, pattern):
    meta = path.stat()
    if meta.st_mode & 0o077 or meta.st_size > 100 or meta.st_size < 1 or not path.is_file():
        raise ValueError('Private selector unavailable')
    value = path.read_text().strip()
    if not pattern.fullmatch(value):
        raise ValueError('Invalid selector')
    return value


def connector_get(url, account):
    args = [COMPOSIO, 'proxy', url, '--toolkit', 'googledrive', '--account', account, '--method', 'GET']
    with subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, shell=False) as process:
        output = process.stdout
        if output is None:
            raise ValueError('Connector unavailable')
        poller = selectors.DefaultSelector()
        poller.register(output, selectors.EVENT_READ)
        data = bytearray()
        try:
            while True:
                budget = min(9, DEADLINE - time.monotonic())
                if budget <= 0 or not poller.select(budget):
                    raise TimeoutError('Connector timeout')
                chunk = os.read(output.fileno(), 8192)
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise ValueError('Connector response too large')
            if process.wait(timeout=max(0.01, DEADLINE - time.monotonic())) != 0:
                raise ValueError('Connector unavailable')
            payload = json.loads(data)
            if not isinstance(payload, dict):
                raise ValueError('Invalid connector response')
            result = payload.get('data', payload)
            if not isinstance(result, dict):
                raise ValueError('Invalid connector response')
            return result
        finally:
            poller.close()
            if process.poll() is None:
                process.kill()
                process.wait()


def utc(value):
    if not UTC.fullmatch(value):
        raise ValueError('Invalid UTC timestamp')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.timestamp() < 0 or parsed.timestamp() > time.time() + 60:
        raise ValueError('Future timestamp')
    return parsed.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or re.search(r'[\x00-\x1f\x7f]', value) or SECRET.search(value) or value.lstrip().startswith('='):
        raise ValueError('Invalid sheet cell')
    value = value.strip()
    if required and not value:
        raise ValueError('Missing sheet cell')
    return value


def safe_url(value):
    if not value:
        return None
    value = text(value, 512, True)
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment:
        raise ValueError('Invalid source URL')
    if parsed.hostname == 'docs.google.com' and re.fullmatch(r'/(?:document|spreadsheets)/d/[A-Za-z0-9_-]+/edit', parsed.path):
        return value
    if parsed.hostname == 'drive.google.com' and re.fullmatch(r'/file/d/[A-Za-z0-9_-]+/view', parsed.path):
        return value
    if parsed.hostname == 'github.com' and re.fullmatch(r'/brettjub/PatterStage/(?:issues|pull)/[1-9][0-9]*', parsed.path):
        return value
    raise ValueError('Invalid source URL')


def cell(row, index, limit, required=False):
    return text(row[index] if len(row) > index else '', limit, required)


def checked_rows(value_range, tab, cap):
    if not isinstance(value_range, dict):
        raise ValueError('Missing tab')
    rows = value_range.get('values', [])
    if not isinstance(rows, list) or not rows or len(rows) > cap + 1 or rows[0] != HEADERS[tab]:
        raise ValueError('Invalid tab header or cap')
    for row in rows[1:]:
        if not isinstance(row, list) or len(row) > 9:
            raise ValueError('Invalid row')
        if all(value == '' for value in row):
            continue
        if any(not isinstance(value, str) for value in row):
            raise ValueError('Invalid cell type')
        yield row


def project(row):
    identifier = cell(row, 0, 64, True)
    if not IDENTIFIER.fullmatch(identifier):
        raise ValueError('Invalid project ID')
    state = cell(row, 3, 16, True)
    if state not in ('active', 'paused', 'idea', 'unknown'):
        raise ValueError('Invalid project state')
    reviewed = cell(row, 7, 40)
    if state != 'unknown' and not reviewed:
        raise ValueError('Status not owner-reviewed')
    result = {'id': identifier, 'name': cell(row, 1, 160, True), 'outcome': cell(row, 2, 200),
              'recordedState': state, 'position': cell(row, 4, 200), 'blocker': cell(row, 5, 200),
              'nextMove': cell(row, 6, 200)}
    if reviewed:
        result['ownerReviewedAt'] = utc(reviewed)
    source = safe_url(cell(row, 8, 512))
    if source:
        result['sourceUrl'] = source
    return result


def decision(row):
    identifier = cell(row, 0, 64, True)
    project_id = cell(row, 1, 64, True)
    if not IDENTIFIER.fullmatch(identifier) or not IDENTIFIER.fullmatch(project_id):
        raise ValueError('Invalid decision ID')
    status = cell(row, 6, 16, True)
    if status not in ('open', 'closed'):
        raise ValueError('Invalid decision status')
    result = {'id': identifier, 'projectId': project_id, 'title': cell(row, 2, 160, True),
              'target': cell(row, 3, 200, True), 'impact': cell(row, 4, 200),
              'raisedAt': utc(cell(row, 5, 40, True))}
    reviewed = cell(row, 7, 40)
    if reviewed:
        result['ownerReviewedAt'] = utc(reviewed)
    source = safe_url(cell(row, 8, 512))
    if source:
        result['sourceUrl'] = source
    return status, result


def snapshot(account=None, sheet_id=None):
    account = account or private_selector(SELECTOR_FILE, re.compile(r'[A-Za-z0-9_-]{1,100}\Z'))
    sheet_id = sheet_id or private_selector(SHEET_ID_FILE, SHEET_ID)
    if not SHEET_ID.fullmatch(sheet_id):
        raise ValueError('Invalid sheet ID')
    about = connector_get('https://www.googleapis.com/drive/v3/about?fields=user%28emailAddress%29', account)
    if about.get('user', {}).get('emailAddress') != ACCOUNT:
        raise ValueError('Wrong Drive account')
    # Read all populated rows in only these nine columns so an out-of-cap row
    # cannot hide past a fixed range. The CLI byte/time cap fails closed.
    query = urllib.parse.urlencode([('ranges', "'Decisions'!A:I"), ('ranges', "'Projects'!A:I"), ('valueRenderOption', 'FORMULA')])
    response = connector_get(f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values:batchGet?{query}', account)
    ranges = response.get('valueRanges')
    if not isinstance(ranges, list) or len(ranges) != 2:
        raise ValueError('Missing tab values')
    projects = [project(row) for row in checked_rows(ranges[1], 'Projects', 50)]
    if len({r['id'] for r in projects}) != len(projects):
        raise ValueError('Duplicate project ID')
    decisions = [decision(row) for row in checked_rows(ranges[0], 'Decisions', 100)]
    if len({r['id'] for _, r in decisions}) != len(decisions) or any(r['projectId'] not in {p['id'] for p in projects} for _, r in decisions):
        raise ValueError('Duplicate or missing decision relation')
    observed = dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return {'schemaVersion': 1, 'checkedAt': observed,
            'sheetUrl': f'https://docs.google.com/spreadsheets/d/{sheet_id}/edit',
            'decisions': [r for status, r in decisions if status == 'open'], 'projects': projects}


if __name__ == '__main__':
    try:
        print(json.dumps(snapshot(), separators=(',', ':')))
    except Exception:
        print('Owner register unavailable', file=sys.stderr)
        sys.exit(1)
