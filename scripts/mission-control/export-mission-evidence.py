#!/usr/bin/env python3
"""Read-only, allowlisted metadata exporter. Never emits prompts or credentials."""
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import re
import selectors
import subprocess
import time
import threading
import urllib.parse
import urllib.request

CAP = 100
MAX_BYTES = 262144
FOLDER = '1MIPer0gFI39WsjbzygHT3JpzE0C66Cmq'
ACCOUNT = 'brett@newgrowthmedia.com'
HERMES_SELECTOR = pathlib.Path.home() / '.config/mission-control/coordinator-id'
HERMES_JOBS = pathlib.Path.home() / '.hermes/cron/jobs.json'
DRIVE_SELECTOR = pathlib.Path.home() / '.config/mission-control/drive-account'
COMPOSIO_BIN = str(pathlib.Path.home() / '.local/bin/composio') if (pathlib.Path.home() / '.local/bin/composio').is_file() else 'composio'
BUDGET = threading.local()


def remaining():
    seconds = getattr(BUDGET, 'deadline', time.monotonic() + 18) - time.monotonic()
    if seconds <= 0:
        raise TimeoutError()
    return min(8, seconds)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def title(value):
    if not isinstance(value, str):
        raise ValueError('Invalid title')
    # Remove controls and redact common credentials embedded in names.
    value = re.sub(r'[\x00-\x1f\x7f]', ' ', value)
    value = re.sub(r'(?i)(?:sk-|gh[pousr]_)[A-Za-z0-9_-]+|Bearer\s+\S+', '[redacted]', value)
    return value.strip()[:160] or 'Untitled'


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value):
        raise ValueError('Invalid timestamp')
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.timestamp() < 0 or parsed.timestamp() > time.time() + 60:
        raise ValueError('Invalid timestamp')
    return parsed.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def public_get(path):
    request = urllib.request.Request('https://api.github.com/repos/brettjub/PatterStage/' + path,
                                     headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'mission-evidence'})
    # No credentials; disallow redirects so the allowlisted host cannot change.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=remaining()) as response:
        data = bytearray()
        while len(data) <= MAX_BYTES:
            remaining()
            chunk = response.read1(min(8192, MAX_BYTES + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
    if len(data) > MAX_BYTES:
        raise ValueError('Response too large')
    return json.loads(data)


def github():
    records = public_get('pulls?state=all&per_page=100')
    if not isinstance(records, list) or len(records) > CAP:
        raise ValueError('Invalid PR list')
    items = []
    # Checks are intentionally bounded to the most recent ten PRs.
    for record in records[:10]:
        number = record['number']
        sha = record['head']['sha']
        if type(number) is not int or number < 1 or not re.fullmatch('[a-f0-9]{40}', sha):
            raise ValueError('Invalid PR')
        note = 'CI unavailable; deployment unverified'
        try:
            checks = public_get('commits/' + sha + '/check-runs?per_page=100')
            runs = checks['check_runs']
            if not isinstance(runs, list) or len(runs) > CAP:
                raise ValueError('Invalid checks')
            conclusions = {'success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale'}
            counts = {}
            for run in runs:
                state = run.get('conclusion') or run.get('status')
                if state not in conclusions | {'queued', 'in_progress', 'completed', 'waiting', 'pending'}:
                    raise ValueError('Invalid check status')
                counts[state] = counts.get(state, 0) + 1
            note = ('CI: ' + ', '.join(f'{key}={counts[key]}' for key in sorted(counts)) if runs else 'CI: no checks returned') + '; deployment unverified'
        except Exception:
            pass  # Never emit remote exceptions or raw responses.
        status = 'merged' if record.get('merged_at') else record['state']
        if status not in {'open', 'closed', 'merged'}:
            raise ValueError('Invalid PR state')
        items.append({'id': f'github-pr-{number}', 'kind': 'pull_request', 'title': title(record['title']),
                      'status': status, 'observedAt': timestamp(record['updated_at']),
                      'url': f'https://github.com/brettjub/PatterStage/pull/{number}', 'project': 'PatterStage', 'note': note[:200]})
    return items


def connector_get(url):
    # Read existing CLI connection only. No login/link/auth setup and no token access.
    selector = os.environ.get('MC_EVIDENCE_DRIVE_ACCOUNT', '')
    if not selector:
        if DRIVE_SELECTOR.stat().st_mode & 0o077 or DRIVE_SELECTOR.stat().st_size > 100:
            raise ValueError('Private Drive selector unavailable')
        selector = DRIVE_SELECTOR.read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', selector):
        raise ValueError('Drive account selector unavailable')
    args = [COMPOSIO_BIN, 'proxy', url, '--toolkit', 'googledrive', '--account', selector, '--method', 'GET']
    with subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          shell=False) as process:
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        data = bytearray()
        deadline = time.monotonic() + remaining()
        try:
            while True:
                wait_seconds = deadline - time.monotonic()
                if wait_seconds <= 0:
                    raise TimeoutError()
                if not selector.select(wait_seconds):
                    raise TimeoutError()
                chunk = process.stdout.read1(8192)
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise ValueError('Response too large')
            if process.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:
                raise ValueError('Connector unavailable')
            result = json.loads(data)
            if not isinstance(result, dict):
                raise ValueError('Invalid connector result')
            # Supported CLI proxy responses: direct body or explicit data wrapper.
            return result.get('data', result)
        finally:
            selector.close()
            if process.poll() is None:
                process.kill()
                process.wait()


def drive():
    # The CLI selector is not an email address. Verify its actual identity on
    # every read so a changed connection cannot silently expose another Drive.
    about = connector_get('https://www.googleapis.com/drive/v3/about?fields=user%28emailAddress%29')
    if about.get('user', {}).get('emailAddress') != ACCOUNT:
        raise ValueError('Wrong Drive account')
    items, token, seen = [], None, set()
    for _ in range(10):
        query = {'q': f"'{FOLDER}' in parents and trashed = false", 'pageSize': '100',
                 'fields': 'nextPageToken,files(id,name,mimeType,modifiedTime)', 'spaces': 'drive'}
        if token:
            query['pageToken'] = token
        result = connector_get('https://www.googleapis.com/drive/v3/files?' + urllib.parse.urlencode(query))
        files = result['files']
        if not isinstance(files, list) or len(items) + len(files) > CAP:
            raise ValueError('Folder exceeds cap')
        for record in files:
            identifier = record['id']
            if not isinstance(identifier, str) or not re.fullmatch('[A-Za-z0-9_-]{1,100}', identifier) or identifier in seen:
                raise ValueError('Invalid file ID')
            seen.add(identifier)
            mime = record['mimeType']
            if not isinstance(mime, str) or not re.fullmatch('[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+', mime) or len(mime) > 140:
                raise ValueError('Invalid MIME')
            items.append({'id': 'drive-' + identifier, 'kind': 'document', 'title': title(record['name']),
                          'status': 'available', 'observedAt': timestamp(record['modifiedTime']),
                          'url': 'https://drive.google.com/file/d/' + identifier + '/view', 'note': 'mimeType: ' + mime})
        next_token = result.get('nextPageToken')
        if not next_token:
            return items
        if not isinstance(next_token, str) or len(next_token) > 2048 or next_token == token:
            raise ValueError('Invalid pagination')
        token = next_token
    raise ValueError('Pagination cap exceeded')


def hermes():
    # Select exactly one explicitly allowlisted job. jobs.json contains prompts,
    # destinations and private identifiers: project only these primitive fields.
    if HERMES_SELECTOR.stat().st_mode & 0o077 or HERMES_SELECTOR.stat().st_size > 128:
        raise ValueError('Missing private selector')
    job_id = HERMES_SELECTOR.read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', job_id) or HERMES_JOBS.stat().st_size > 1048576:
        raise ValueError('Invalid selector or job store')
    data = json.loads(HERMES_JOBS.read_text())
    jobs = data.get('jobs')
    if not isinstance(jobs, list) or len(jobs) > 1000:
        raise ValueError('Invalid job store')
    selected = [job for job in jobs if isinstance(job, dict) and job.get('id') == job_id]
    if len(selected) != 1 or type(selected[0].get('enabled')) is not bool:
        raise ValueError('Selected job unavailable')
    job = selected[0]
    digest = hashlib.sha256(job_id.encode()).hexdigest()[:16]
    observed = now()
    state = 'paused' if not job['enabled'] else 'scheduled (not a process observation)'
    items = [{'id': 'hermes-job-' + digest, 'kind': 'task', 'title': 'Configured Hermes schedule',
              'status': state, 'observedAt': observed,
              'note': 'Schedule state only; no assignment or dispatch inferred'}]
    last = job.get('last_run_at')
    result = job.get('last_status')
    if isinstance(last, str) and isinstance(result, str) and result in {'ok', 'failed', 'error', 'missed', 'skipped'}:
        # Hermes stores UTC timestamps with offsets; convert before validating.
        date = datetime.datetime.fromisoformat(last.replace('Z', '+00:00'))
        if date.utcoffset() is None:
            raise ValueError('Unzoned run timestamp')
        run_at = timestamp(date.astimezone(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))
        items.append({'id': 'hermes-run-' + digest, 'kind': 'run', 'title': 'Last recorded Hermes run',
                      'status': result, 'observedAt': run_at, 'note': 'Recorded result; not a live process'})
    return items


def source(identifier, reader):
    BUDGET.deadline = time.monotonic() + 18
    try:
        items = reader()
        return {'id': identifier, 'status': 'live', 'checkedAt': now(), 'items': items}
    except Exception:
        return {'id': identifier, 'status': 'unavailable', 'checkedAt': None, 'items': []}


def snapshot():
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(source, key, reader) for key, reader in [('hermes', hermes), ('github', github), ('drive', drive)]]
        sources = [future.result() for future in futures]
    return {'schemaVersion': 1, 'checkedAt': now(), 'sources': sources}


if __name__ == '__main__':
    print(json.dumps(snapshot(), separators=(',', ':')))
