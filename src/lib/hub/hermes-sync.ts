// ═══════════════════════════════════════════════════════════════
// hermes-sync.ts — Instructions for the scheduled Hermes job that keeps
// My Hub current (client-safe: no server imports)
// ═══════════════════════════════════════════════════════════════

export const HUB_SYNC_MISSION_NAME = "My Hub sync";

export const HUB_SYNC_SOURCES = [
  {
    id: "calendar",
    label: "Google Calendar",
    instruction:
      "Google Calendar: events from today through the next 30 days that need preparation or follow-up become tasks due on (or the day before) the event. Key: gcal:<eventId>. Skip routine personal blocks.",
  },
  {
    id: "gmail",
    label: "Gmail",
    instruction:
      "Gmail: threads from the last 7 days where someone is waiting on me (starred, important and unread, or the latest message is not mine). Skip newsletters, receipts and notifications. Key: gmail:<threadId>. Notes: sender and subject only, never message bodies. If I have since replied to a thread you imported before, send it again with status \"done\".",
  },
  {
    id: "drive",
    label: "Google Drive",
    instruction:
      "Google Drive: docs and sheets changed in the last 7 days that are plans, briefs, to-do lists or meeting notes; open action items for me become tasks. Key: drive:<fileId>:<short-slug>. Skip anything that looks like patient or customer personal data.",
  },
  {
    id: "github",
    label: "GitHub",
    instruction:
      "GitHub (use GITHUB_TOKEN): repositories I pushed to in the last 90 days go in repos (owner/name). Pull requests waiting for my review and failing default-branch CI become tasks. Key: github:<owner>/<repo>:<pr-or-run-id>.",
  },
  {
    id: "hosting",
    label: "Render, Replit, Supabase",
    instruction:
      "Hosting (Render, Replit, Supabase, whichever you have credentials for): public URLs of live web apps go in sites (key: <provider>:<id>). A failed deploy, suspended service or paused database becomes a task (key: <provider>:<id>:<problem>).",
  },
  {
    id: "ads",
    label: "Ad accounts & clients",
    instruction:
      "Ad accounts and client reporting (Meta Ads, Google Ads, AgencyAnalytics, whichever you can reach): each active client is a project (key: client:<slug>). Campaigns that stopped delivering or accounts with billing or connection problems become tasks. Never change campaigns or budgets.",
  },
] as const;

export type HubSyncSourceId = (typeof HUB_SYNC_SOURCES)[number]["id"];

export const HUB_SYNC_SCHEDULES = [
  { value: "0 7 * * *", label: "Every morning at 7:00" },
  { value: "0 7,13 * * *", label: "Twice a day (7:00 and 13:00)" },
  { value: "every 6h", label: "Every 6 hours" },
] as const;

const FORMAT = `{
  "projects": [{"key": "...", "name": "...", "description": "one line", "color": "cyan|purple|green|pink|orange", "status": "active|paused|done"}],
  "tasks": [{"key": "...", "title": "imperative, under 80 characters", "notes": "at most 2 short lines", "project": "<project key or name, or null>", "priority": "low|normal|high", "dueDate": "YYYY-MM-DD or null", "status": "todo|doing|done (optional)"}],
  "sites": [{"key": "...", "name": "...", "url": "https://...", "project": "<project key or name, or null>"}],
  "repos": [{"fullName": "owner/name", "project": "<project key or name, or null>"}]
}`;

/** The mission prompt for the sync job. */
export function buildHermesSyncPrompt(endpoint: string, sources: readonly HubSyncSourceId[]): string {
  const chosen = HUB_SYNC_SOURCES.filter((s) => sources.includes(s.id));
  const lines = [
    "Keep my Control Hub \"My Hub\" up to date with what I have going on.",
    "",
    "1. Read these sources with whatever tools, skills and credentials you have. If you cannot reach one, skip it and say so in your summary; do not ask me for credentials.",
    ...chosen.map((s) => "   - " + s.instruction),
    "",
    "2. Read only. Never send, reply, draft, archive, edit, delete, deploy, pause, launch or spend anything in any of these accounts.",
    "",
    "3. Write the results to /tmp/my-hub-sync.json in this format (omit empty arrays):",
    FORMAT,
    "   Keys must be stable ids from the source so re-running updates items instead of duplicating them. Group related tasks under a project (a client, product or event) and reuse the same project keys every run. Only include real, open actions; don't invent work. Never include passwords, tokens, codes, account numbers or links containing tokens.",
    "",
    "4. Preview, then import, on this machine:",
    `   curl -s -X POST ${endpoint} -H 'content-type: application/json' --data "$(jq '. + {dryRun: true}' /tmp/my-hub-sync.json)"`,
    `   curl -s -X POST ${endpoint} -H 'content-type: application/json' --data @/tmp/my-hub-sync.json`,
    "   If jq is missing, skip the preview. If the response has an \"error\", fix the JSON it names and post again.",
    "",
    "5. Reply with a short summary: how many projects, tasks, sites and repos were created, updated or unchanged (from the response's \"counts\"), and which sources you skipped and why. My Hub keeps my own edits and never reopens tasks I finished, so always send the full current picture.",
  ];
  return lines.join("\n");
}
