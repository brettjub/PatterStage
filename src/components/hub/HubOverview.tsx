// ═══════════════════════════════════════════════════════════════
// HubOverview — "My Hub" block at the top of the dashboard:
// up-next tasks, active projects, websites and GitHub at a glance
// ═══════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, FolderKanban, GitBranch, Globe, ListChecks } from "lucide-react";

import { StatPill, StatPillSkeleton } from "@/components/dashboard/StatPill";
import type { ToastType } from "@/components/ui/Toast";
import { CiBadge, DueLabel, PROJECT_COLOR_CLASSES, ProgressBar, SiteStatusDot } from "@/components/hub/HubBits";
import QuickAddTask from "@/components/hub/QuickAddTask";
import TaskRow from "@/components/hub/TaskRow";
import { hubRequest } from "@/components/hub/hub-client";
import { useTaskActions } from "@/components/hub/useTaskActions";
import { useInterval } from "@/hooks/useInterval";
import { todayLocal } from "@/lib/hub/hub-format";
import type { GithubRepoActivity, HubSite, HubSummary } from "@/types/hub";

const REFRESH_MS = 60_000;

function PanelHeader({
  icon: Icon,
  title,
  href,
  linkLabel,
  colorClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  href: string;
  linkLabel: string;
  colorClass: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-dark-800/50">
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
        <span className="text-xs font-mono text-white/60">{title}</span>
      </div>
      <Link href={href} className={`text-[10px] font-mono hover:underline ${colorClass}`}>
        {linkLabel} →
      </Link>
    </div>
  );
}

export default function HubOverview({ showToast }: { showToast: (message: string, type?: ToastType) => void }) {
  const [summary, setSummary] = useState<HubSummary | null>(null);
  const [sites, setSites] = useState<HubSite[] | null>(null);
  const [repos, setRepos] = useState<GithubRepoActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    const res = await hubRequest<HubSummary>("/api/hub/summary?today=" + todayLocal());
    if (!res.ok || !res.data) {
      setError(res.error || "Could not load your hub");
      return;
    }
    setError(null);
    setSummary(res.data);
  }, []);

  const loadSites = useCallback(async () => {
    const res = await hubRequest<{ sites: HubSite[] }>("/api/hub/sites?check=stale");
    if (res.ok && res.data) setSites(res.data.sites);
  }, []);

  const loadRepos = useCallback(async () => {
    const res = await hubRequest<{ repos: GithubRepoActivity[] }>("/api/hub/github");
    if (res.ok && res.data) setRepos(res.data.repos);
  }, []);

  useEffect(() => {
    void loadSummary();
    void loadSites();
    void loadRepos();
  }, [loadSummary, loadSites, loadRepos]);

  useInterval(() => {
    void loadSummary();
  }, { ms: REFRESH_MS });

  const actions = useTaskActions({
    projects: summary?.projects ?? [],
    onChanged: loadSummary,
    showToast,
  });

  const today = summary?.today ?? todayLocal();
  const t = summary?.tasks;
  const siteStats = summary?.sites;
  const failingCi = (repos ?? []).filter((r) => r.ci.state === "failure").length;
  const openPrs = (repos ?? []).reduce((n, r) => n + r.openPulls.length, 0);

  return (
    <section className="space-y-3" aria-label="My hub">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-wider">My hub</h2>
        {error && (
          <button type="button" onClick={() => void loadSummary()} className="text-[10px] font-mono text-semantic-danger hover:underline">
            {error} — retry
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 min-w-0">
        {summary && t && siteStats ? (
          <>
            <StatPill
              icon={ListChecks}
              label="Open tasks"
              value={String(t.open)}
              color="cyan"
              subtitle={t.dueToday ? `${t.dueToday} due today` : t.doing ? `${t.doing} in progress` : `${t.doneThisWeek} done this week`}
            />
            <StatPill
              icon={t.overdue ? AlertTriangle : CalendarCheck}
              label="Overdue"
              value={t.overdue ? String(t.overdue) : "None"}
              color={t.overdue ? "pink" : "green"}
              subtitle={`${t.doneThisWeek} done this week`}
            />
            <StatPill icon={FolderKanban} label="Active projects" value={String(summary.projects.length)} color="green" />
            <StatPill
              icon={Globe}
              label="Websites"
              value={siteStats.total === 0 ? "None" : siteStats.down ? `${siteStats.down} down` : `${siteStats.up}/${siteStats.total} up`}
              color={siteStats.down ? "pink" : siteStats.degraded ? "orange" : "purple"}
              subtitle={summary.repoCount ? `${summary.repoCount} repos watched` : undefined}
            />
          </>
        ) : (
          <>
            <StatPillSkeleton />
            <StatPillSkeleton />
            <StatPillSkeleton />
            <StatPillSkeleton />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Up next */}
        <div className="rounded-xl border border-neon-cyan/20 bg-dark-900/50 overflow-hidden lg:col-span-1" data-testid="hub-up-next">
          <PanelHeader icon={ListChecks} title="Up next" href="/hub/tasks" linkLabel="all tasks" colorClass="text-neon-cyan" />
          <div className="border-b border-white/5">
            <QuickAddTask
              dueDate={today}
              placeholder="Add a task for today"
              onAdded={(task) => {
                showToast(`Added "${task.title}"`, "success");
                void loadSummary();
              }}
              onError={(m) => showToast(m, "error")}
            />
          </div>
          <div className="divide-y divide-white/5">
            {summary && summary.upNext.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-white/30">Nothing waiting. Add something for today above.</div>
            )}
            {summary?.upNext.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                busy={actions.busyId === task.id}
                onToggleDone={actions.toggleDone}
                onEdit={actions.edit}
                onSendToHermes={actions.handToHermes}
              />
            ))}
          </div>
        </div>

        {/* Projects */}
        <div className="rounded-xl border border-neon-green/20 bg-dark-900/50 overflow-hidden">
          <PanelHeader icon={FolderKanban} title="Projects" href="/hub/projects" linkLabel="manage" colorClass="text-neon-green" />
          <div className="divide-y divide-white/5">
            {summary && summary.projects.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-white/30">
                No active projects.{" "}
                <Link href="/hub/projects" className="text-neon-green hover:underline">
                  Create one
                </Link>
              </div>
            )}
            {summary?.projects.slice(0, 6).map((p) => (
              <Link key={p.id} href={"/hub/tasks?project=" + p.id} className="block px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PROJECT_COLOR_CLASSES[p.color].dot}`} />
                    <span className="text-xs text-white/80 truncate">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px] font-mono text-white/40">
                    {p.overdueTasks > 0 && <span className="text-semantic-danger">{p.overdueTasks} late</span>}
                    {p.nextDue && !p.overdueTasks && <DueLabel dueDate={p.nextDue} today={today} />}
                    <span>{p.openTasks} open</span>
                  </div>
                </div>
                <div className="mt-1.5">
                  <ProgressBar done={p.doneTasks} total={p.totalTasks} color={p.color} />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Code & sites */}
        <div className="rounded-xl border border-neon-purple/20 bg-dark-900/50 overflow-hidden">
          <PanelHeader icon={GitBranch} title="Code & sites" href="/hub/code" linkLabel="details" colorClass="text-neon-purple" />
          <div className="divide-y divide-white/5">
            {sites && sites.length === 0 && (!repos || repos.length === 0) && (
              <div className="px-4 py-6 text-center text-xs text-white/30">
                Watch your websites and GitHub repositories.{" "}
                <Link href="/hub/code" className="text-neon-purple hover:underline">
                  Add them
                </Link>
              </div>
            )}
            {(sites ?? []).slice(0, 5).map((s) => (
              <div key={s.id} className="px-4 py-2 flex items-center gap-2.5 min-w-0">
                <SiteStatusDot status={s.lastStatus} />
                <span className="text-xs text-white/80 truncate flex-1">{s.name}</span>
                <span className="text-[10px] font-mono text-white/40 flex-shrink-0">
                  {s.lastStatus === "up" ? `${s.lastResponseMs ?? "?"} ms` : s.lastStatus ?? "checking…"}
                </span>
              </div>
            ))}
            {repos && repos.length > 0 && (
              <div className="px-4 py-2.5 space-y-1.5">
                <div className="text-[10px] font-mono text-white/40">
                  {openPrs} open PR{openPrs === 1 ? "" : "s"}
                  {failingCi > 0 && <span className="text-semantic-danger"> · {failingCi} failing CI</span>}
                </div>
                {repos.slice(0, 4).map((r) => (
                  <div key={r.fullName} className="flex items-center justify-between gap-2 min-w-0">
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-xs font-mono text-white/70 hover:text-white truncate">
                      {r.fullName}
                    </a>
                    {r.error ? (
                      <span className="text-[10px] font-mono text-semantic-danger flex-shrink-0" title={r.error}>
                        error
                      </span>
                    ) : (
                      <CiBadge state={r.ci.state} url={r.ci.url} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {actions.modals}
    </section>
  );
}
