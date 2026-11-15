# My Hub

My Hub is the personal side of Control Hub: the projects you have going on, the tasks inside them, and the code and websites behind them. It sits next to the Hermes pages, and a task can be handed to Hermes as a mission with one click.

Sidebar: **My Hub → Projects · Tasks · Code & Sites · Import & Sync**. The dashboard shows a summary at the top.

## Dashboard

- **Stat row**: open tasks (and how many are due today), overdue tasks, active projects, websites up/down.
- **Up next**: the six most urgent open tasks: overdue and due today first, then in progress, then high priority, then by due date. Typing in the box adds a task **due today**. Tick a task to finish it; the robot icon hands it to Hermes.
- **Projects**: active projects with progress (done / total tasks) and their next due date or overdue count.
- **Code & sites**: website health and, for watched GitHub repositories, open PRs and CI status.

The panel refreshes every minute.

## Projects (`/hub/projects`)

A project has a name, description, colour and status (**active**, **paused**, **done**). Cards show progress, open/done/overdue counts, the next due date, and how many sites and repositories are linked to it. **Open tasks →** opens the task list filtered to that project.

Deleting a project never deletes its tasks, websites or repositories; they stay, without a project.

## Tasks (`/hub/tasks`)

Tasks have a title, notes, optional project, status (**to do**, **in progress**, **done**), priority and optional due date.

- Filter by status tabs, by project (including **No project**), and search titles, notes and project names.
- The top row adds a task quickly (into the filtered project, if any). **New task** opens the full form.
- Row actions (shown on hover on desktop): start/pause, hand to Hermes, edit, delete (click twice to confirm).

### Handing a task to Hermes

The robot icon turns the task into a Hermes mission. The instruction is built from the task's title, project, due date and notes, and asks Hermes to summarise what it did and what is left for you.

- **Save as draft mission** creates the mission without running it, so you can review it under **Orchestration → Missions**.
- **Run now** dispatches it immediately with the default agent profile.

The task moves to **in progress** and shows a badge with the mission's live status (`queued`, `dispatched`, `successful`, `failed`). Mark the task done yourself when you're happy with the result.

## Code & Sites (`/hub/code`)

### GitHub

Add repositories as `owner/name` or by pasting their GitHub URL, optionally linked to a project. Each card shows the description, the latest CI run on the default branch, open pull requests (top three listed), open issues, the latest commit and when the repository was last pushed. Data is cached for three minutes; **Refresh** fetches it fresh.

A token is needed for private repositories and to avoid GitHub's anonymous limit of 60 requests an hour. Control Hub uses the first of `CH_GITHUB_TOKEN`, `GITHUB_TOKEN` or `GH_TOKEN` from its own environment (`.env.local`), and otherwise the same names from your Hermes `.env`, so a Hermes install that already has `GITHUB_TOKEN` works as is. The token stays on the server. With a token, **Your recent repositories** offers one-click adds.

### Websites

Add any address (`http://` or `https://`), such as apps on Render, Replit or Supabase, or local services. A site is:

| Status | Meaning |
|--------|---------|
| up | answered with 2xx or 3xx |
| degraded | answered with 4xx (reachable, but e.g. 404 or a login wall) |
| down | 5xx, no answer within 10 seconds, or the connection failed |

Sites are checked when added, when you press the refresh icon, and whenever the dashboard or this page loads and the last check is more than five minutes old. There is no background checker: if no page is open, nothing is checked.

Checks run from the machine Control Hub runs on, so local addresses (`http://127.0.0.1:…`) work. Because Control Hub has no login of its own, run it only where you trust everyone who can reach it (see [DEPLOY.md](DEPLOY.md)).

## Import & Sync (`/hub/import`)

### Import

Paste (or load) a JSON file, press **Preview** to see what would be added or changed, untick anything you don't want, then **Import**. Nothing is saved before that.

```json
{
  "projects": [{"key": "client:apm", "name": "A Peaceful Mind", "description": "…", "color": "cyan", "status": "active"}],
  "tasks": [{"key": "gmail:18c2…", "title": "Reply to Roberto", "notes": "…", "project": "client:apm", "priority": "high", "dueDate": "2026-11-16", "status": "todo"}],
  "sites": [{"key": "render:srv-…", "name": "LaunchHost (staging)", "url": "https://…", "project": "client:apm"}],
  "repos": [{"fullName": "owner/name", "project": "client:apm"}]
}
```

Only `key` + `name` (projects), `key` + `title` (tasks), `name` + `url` (sites) and `fullName` (repos) are required. `project` may be a project key from the same file, an existing project's key, or a project name. Imported tasks show where they came from (Gmail, Calendar, Drive, Render…) based on the key's prefix.

Rules, so importing again is always safe:

- Items are matched by `key` (sites also by URL, repos by name, projects also by name), so nothing is duplicated.
- Your edits win until the source changes: if you rename a task or move its due date, re-importing the same data leaves it alone. When the source data itself changes, the new values are applied.
- Tasks you've finished are never reopened. An import can mark a task done (`"status": "done"`); new items that are already done are skipped.
- An import never deletes anything.

### Hermes sync

**Schedule sync** creates a recurring Hermes mission (default: every morning at 7:00, server time; the first run starts immediately) named "My Hub sync". **Run once now** does a single run. Pick which sources it should read; **Show what Hermes is asked to do** shows the exact instructions.

Each run, Hermes reads the chosen sources with the tools and credentials it already has on the server (skipping any it can't reach), writes the import JSON to `/tmp/my-hub-sync.json`, and posts it to `http://127.0.0.1:<PORT>/api/hub/import`, previewing first. It is told to only read: never send, reply, edit, delete, deploy, pause or spend anything. Each run's summary appears on **Orchestration → Missions**; change or pause the schedule on **Orchestration → Cron**.

The job's quality depends on what your Hermes profile can access. If a source is always skipped, give Hermes the matching tool or credential (for example a Google Workspace skill or a Render API key in its `.env`).

## Data

Everything is stored in Control Hub's own SQLite database (`CH_DATA_DIR/control-hub.db`) in the tables `hub_projects`, `hub_tasks`, `hub_sites` and `hub_repos` (imported items carry `external_key` and `external_hash`). Tables and columns are created automatically the first time a hub page or API route is used, so no migration step is needed. Nothing is written to Hermes except missions you create from tasks.

API routes: [API.md](API.md) (`/api/hub/*`). Code: `src/lib/hub/`, `src/components/hub/`, `src/app/hub/`.
