# Mission Control — owner register (manually maintained Google Sheet)

**Scope:** The dedicated `Mission Control — Owner Register` in the NGM Drive folder is the read-only source for the owner inbox and project radar. The earlier dated Agent Command Center Sheet remains a snapshot, not this register. The first register read was verified on October 7, 2026: `Decisions` had no records; `Projects` had two placeholder rows (`ngm`, `launchhost`) with `unknown` status and no owner review. No approval or release state is implied.

## Manual edit rules

The Sheet's `Guide` tab explains the exact fields, allowed statuses and data-handling limits. Only Brett's updates to these rows should be treated as manually recorded status; a successful source poll proves only that the register was read.

- **Decisions** columns: Decision ID, Project ID, Title, Exact target, Impact, Raised at UTC, Status (`open` or `closed`), Owner reviewed at UTC, Source URL. Use stable lowercase IDs and an existing Project ID. Enter UTC timestamps as `YYYY-MM-DDTHH:MM:SSZ`. Only `open` decisions appear in the read-only inbox; retain `closed` rows in the Sheet.
- **Projects** columns: Project ID, Name, Outcome, Recorded state (`active`, `paused`, `idea`, `unknown`), Position, Blocker, Next move, Owner reviewed at UTC, Source URL. Non-`unknown` states require a real owner-reviewed UTC timestamp. Seeded NGM and Launchhost rows intentionally have `unknown` and blank review fields until Brett fills them in.
- A blank owner-review time means **UNVERIFIED**, even if the Sheet read succeeds. A timestamp means owner-reviewed on that date, not independently verified by GitHub, Hermes, Drive or an external project tracker. Stale reviews remain dated.
- Do not put client names, health information, lead details or credentials in the Sheet. The UI can show the bounded fields to anyone who reaches this local application; keep it bound to localhost.
- Editing this Sheet is not an approval, dispatch, deployment, budget change or notification. None of those actions is wired to the register.

## Read-only bridge

`GET /api/mission-control/register` is a same-origin server route. It uses the existing `MC_EVIDENCE_SSH_TARGET` and a fixed remote command path; no browser input chooses the destination, script or spreadsheet. The dedicated WSL SSH key's forced-command dispatcher (`scripts/mission-control/ssh-dispatch.py`) allows this command in addition to the existing agent and evidence exporters; other commands remain denied. The dispatcher executes the root-owned exporter copy at `/usr/local/libexec/mission-control/export-owner-register.py`. Both installed root-owned files were compared against their repository sources and the forced command was exercised on the VPS. The app never contacts Google directly and has no Google credentials.

The VPS exporter reads a private 0600 sheet-ID selector and the existing private 0600 Composio connected-account selector. It checks that the account is `brett@newgrowthmedia.com` on every read and requests only bounded `Decisions` and `Projects` ranges through the Google Sheets API. Formulas, invalid rows, overflow, duplicate IDs, unreviewed non-unknown project states, wrong account or unavailable reads fail closed with no row data. Only approved HTTPS source-link shapes survive; raw API replies, tokens and connector errors do not cross SSH. The `Guide` tab is not exported.

A successful 200 has `{schemaVersion:1,checkedAt,sheetUrl,decisions,projects}`. `checkedAt` is source-read time, not owner-review time. An empty `decisions` array means *zero open decisions recorded in this Sheet at that read*—not zero required decisions across all systems. An unavailable route returns 503 with a generic error; the UI must show unknown/held/stale, never empty as a substitute. Existing evidence and agent routes are independent.

## Owner PC acceptance

After the branch is published, pull it in WSL and restart the existing localhost-only dev server in the same environment. No new SSH target or secret is needed. Test the fixed read-only command using the existing SSH host-key and key configuration, then check the localhost register route: 200, two `unknown` project rows, zero recorded open decisions, and a source timestamp. Confirm the browser shows the same bounded records and manual/unknown labels. A VPS-only test does **not** verify the PC-side route or render.

Keep `CH_DATA_DIR` and `CONTROL_HUB_DATA_DIR` on the existing isolated `~/.patterstage-preview/data-v2`; leave the older PC database and paused Launchhost coordinator untouched. Never expose this unauthenticated Control Hub port publicly.
