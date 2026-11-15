"use client";

// ═══════════════════════════════════════════════════════════════
// /hub/code — GitHub activity and website uptime
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, GitBranch, GitPullRequest, Globe, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";

import AppPageShell from "@/components/layout/AppPageShell";
import PageHeader from "@/components/layout/PageHeader";
import Button from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/Toast";
import {
  CiBadge,
  EmptyState,
  ErrorBanner,
  ProjectChip,
  SelectField,
  SiteStatusDot,
  fieldClass,
} from "@/components/hub/HubBits";
import { addRepo, addSite, hubRequest, recheckSites, removeRepo, removeSite } from "@/components/hub/hub-client";
import { useTwoStepConfirm } from "@/hooks/useTwoStepConfirm";
import { timeAgo } from "@/lib/utils";
import type {
  GithubRepoActivity,
  GithubTokenSource,
  HubProjectWithStats,
  HubRepo,
  HubSite,
} from "@/types/hub";

interface RepoSuggestion {
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  pushedAt: string | null;
}

export default function CodeAndSitesPage() {
  const { showToast, toastElement } = useToast();
  const confirmRemove = useTwoStepConfirm({ autoDismissMs: 4000 });

  const [projects, setProjects] = useState<HubProjectWithStats[]>([]);
  const [repos, setRepos] = useState<HubRepo[] | null>(null);
  const [activity, setActivity] = useState<Record<string, GithubRepoActivity>>({});
  const [tokenSource, setTokenSource] = useState<GithubTokenSource>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<RepoSuggestion[]>([]);
  const [sites, setSites] = useState<HubSite[] | null>(null);
  const [checking, setChecking] = useState<string | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [repoInput, setRepoInput] = useState("");
  const [repoProject, setRepoProject] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [siteProject, setSiteProject] = useState("");
  const [adding, setAdding] = useState<"repo" | "site" | null>(null);

  const loadGithub = useCallback(async (refresh = false) => {
    setGithubLoading(true);
    const res = await hubRequest<{ tokenSource: GithubTokenSource; repos: GithubRepoActivity[] }>(
      "/api/hub/github" + (refresh ? "?refresh=1" : ""),
    );
    setGithubLoading(false);
    if (!res.ok || !res.data) {
      showToast(res.error || "Could not load GitHub activity", "error");
      return;
    }
    setTokenSource(res.data.tokenSource);
    setActivity(Object.fromEntries(res.data.repos.map((r) => [r.fullName.toLowerCase(), r])));
  }, [showToast]);

  const loadLists = useCallback(async () => {
    const [r, s, p] = await Promise.all([
      hubRequest<{ repos: HubRepo[] }>("/api/hub/repos"),
      hubRequest<{ sites: HubSite[] }>("/api/hub/sites"),
      hubRequest<{ projects: HubProjectWithStats[] }>("/api/hub/projects"),
    ]);
    if (!r.ok || !s.ok) {
      setError(r.error || s.error || "Could not load your repositories and sites");
      return;
    }
    setError(null);
    setRepos(r.data?.repos ?? []);
    setSites(s.data?.sites ?? []);
    if (p.ok && p.data) setProjects(p.data.projects);
  }, []);

  useEffect(() => {
    void loadLists();
    void loadGithub();
    void hubRequest<{ repos: RepoSuggestion[] }>("/api/hub/github/suggestions").then((res) => {
      if (res.ok && res.data) setSuggestions(res.data.repos);
    });
    // Re-check sites whose last check is older than five minutes.
    void hubRequest<{ sites: HubSite[] }>("/api/hub/sites?check=stale").then((res) => {
      if (res.ok && res.data) setSites(res.data.sites);
    });
  }, [loadLists, loadGithub]);

  const projectOptions = useMemo(
    () => [{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    [projects],
  );
  const watched = useMemo(() => new Set((repos ?? []).map((r) => r.fullName.toLowerCase())), [repos]);
  const freshSuggestions = suggestions.filter((s) => !watched.has(s.fullName.toLowerCase())).slice(0, 8);

  async function handleAddRepo(fullName: string, projectId: string | null) {
    setAdding("repo");
    const res = await addRepo(fullName, projectId);
    setAdding(null);
    if (!res.ok) {
      showToast(res.error || "Could not add the repository", "error");
      return;
    }
    setRepoInput("");
    showToast(`Watching ${res.data?.repo.fullName ?? fullName}`, "success");
    await loadLists();
    void loadGithub();
  }

  async function handleAddSite() {
    setAdding("site");
    const res = await addSite({ name: siteName.trim(), url: siteUrl.trim(), projectId: siteProject || null });
    setAdding(null);
    if (!res.ok) {
      showToast(res.error || "Could not add the site", "error");
      return;
    }
    setSiteName("");
    setSiteUrl("");
    const site = res.data?.site;
    showToast(site ? `${site.name} is ${site.lastStatus ?? "added"}` : "Site added", site?.lastStatus === "down" ? "error" : "success");
    void loadLists();
  }

  async function handleRecheck(id?: string) {
    setChecking(id ?? "all");
    const res = await recheckSites(id);
    setChecking(null);
    if (!res.ok || !res.data) {
      showToast(res.error || "Check failed", "error");
      return;
    }
    setSites(res.data.sites);
  }

  function handleRemove(kind: "repo" | "site", id: string, label: string) {
    const key = kind + ":" + id;
    if (!confirmRemove.isArmedFor(key)) {
      confirmRemove.arm(key);
      return;
    }
    void confirmRemove.confirm(async () => {
      const res = kind === "repo" ? await removeRepo(id) : await removeSite(id);
      if (!res.ok) {
        showToast(res.error || "Could not remove it", "error");
        return;
      }
      showToast(`Removed ${label}`, "success");
      void loadLists();
    });
  }

  function removeButton(kind: "repo" | "site", id: string, label: string) {
    const armed = confirmRemove.isArmedFor(kind + ":" + id);
    return (
      <button
        type="button"
        onClick={() => handleRemove(kind, id, label)}
        aria-label={armed ? "Confirm remove" : `Remove ${label}`}
        title={armed ? "Click again to remove" : "Remove"}
        className={
          armed
            ? "px-2 py-1 rounded-md text-[10px] font-mono bg-semantic-danger/20 text-semantic-danger"
            : "p-1.5 rounded-md text-white/35 hover:text-semantic-danger hover:bg-white/5"
        }
      >
        {armed ? "Remove?" : <Trash2 className="w-3.5 h-3.5" />}
      </button>
    );
  }

  const downCount = (sites ?? []).filter((s) => s.lastStatus === "down").length;

  return (
    <AppPageShell>
      <PageHeader
        icon={GitBranch}
        title="Code & Sites"
        subtitle={`${repos?.length ?? 0} repositories · ${sites?.length ?? 0} sites` + (downCount ? ` · ${downCount} down` : "")}
        color="purple"
        actions={
          <Button
            icon={RefreshCw}
            loading={githubLoading || checking === "all"}
            onClick={() => {
              void loadGithub(true);
              void handleRecheck();
            }}
          >
            Refresh
          </Button>
        }
      />
      {toastElement}
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-8">
        {error && <ErrorBanner message={error} onRetry={loadLists} />}

        {/* ═══ GitHub ═══ */}
        <section className="space-y-3" aria-labelledby="hub-github-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="hub-github-heading" className="text-sm font-mono uppercase tracking-wider text-white/60 flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-neon-purple" /> GitHub
            </h2>
            <span className="text-[11px] font-mono text-white/35">
              {tokenSource === "env"
                ? "Using the GitHub token from Control Hub's environment"
                : tokenSource === "hermes"
                  ? "Using the GitHub token from your Hermes .env"
                  : "No GitHub token: public repositories only, 60 requests an hour"}
            </span>
          </div>

          {tokenSource === null && repos !== null && (
            <div className="rounded-lg border border-semantic-warning/30 bg-semantic-warning/10 px-4 py-3 text-xs text-white/75">
              To see private repositories and avoid rate limits, add <code className="font-mono text-semantic-warning">GITHUB_TOKEN=…</code>{" "}
              to your Hermes <code className="font-mono">.env</code> (Config → Environment) or to Control Hub&rsquo;s{" "}
              <code className="font-mono">.env.local</code>, then restart Control Hub. A fine-grained token with read-only access to
              contents, pull requests and actions is enough.
            </div>
          )}

          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (repoInput.trim()) void handleAddRepo(repoInput.trim(), repoProject || null);
            }}
          >
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="owner/repository or GitHub URL"
              aria-label="Repository to watch"
              className={fieldClass + " flex-1 min-w-[14rem]"}
            />
            <SelectField value={repoProject} onChange={setRepoProject} options={projectOptions} ariaLabel="Project for repository" className="!w-auto min-w-[9rem]" />
            <Button type="submit" variant="primary" color="purple" icon={Plus} loading={adding === "repo"} disabled={!repoInput.trim()}>
              Watch
            </Button>
          </form>

          {freshSuggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono text-white/35">Your recent repositories:</span>
              {freshSuggestions.map((s) => (
                <button
                  key={s.fullName}
                  type="button"
                  onClick={() => void handleAddRepo(s.fullName, null)}
                  title={s.description ?? undefined}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] font-mono text-white/60 hover:border-neon-purple/40 hover:text-white"
                >
                  <Plus className="w-3 h-3" />
                  {s.fullName}
                  {s.isPrivate && <Lock className="w-3 h-3 text-white/30" />}
                </button>
              ))}
            </div>
          )}

          {repos === null && !error ? (
            <div className="py-8 flex justify-center">
              <LoadingSpinner text="Loading repositories..." />
            </div>
          ) : repos && repos.length === 0 ? (
            <EmptyState icon={GitBranch} title="No repositories watched yet">
              Add a repository to see its open pull requests, latest commit and whether its checks pass.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {(repos ?? []).map((repo) => {
                const a = activity[repo.fullName.toLowerCase()];
                return (
                  <div key={repo.id} data-testid="hub-repo-card" className="rounded-xl border border-neon-purple/20 bg-dark-900/50 p-4 space-y-2.5 min-w-0">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0">
                        <a
                          href={a?.url ?? "https://github.com/" + repo.fullName}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-mono text-white hover:text-neon-purple inline-flex items-center gap-1.5 max-w-full"
                        >
                          <span className="truncate">{repo.fullName}</span>
                          {a?.isPrivate && <Lock className="w-3 h-3 text-white/35 flex-shrink-0" />}
                          <ExternalLink className="w-3 h-3 text-white/30 flex-shrink-0" />
                        </a>
                        {a?.description && <p className="text-xs text-white/45 truncate mt-0.5">{a.description}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {repo.projectName && <ProjectChip name={repo.projectName} color={projects.find((p) => p.id === repo.projectId)?.color ?? null} />}
                        {removeButton("repo", repo.id, repo.fullName)}
                      </div>
                    </div>

                    {!a ? (
                      <div className="text-xs text-white/35 font-mono">{githubLoading ? "Loading activity…" : "No activity loaded"}</div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-white/50">
                          <CiBadge state={a.ci.state} url={a.ci.url} />
                          <span className="inline-flex items-center gap-1">
                            <GitPullRequest className="w-3 h-3" />
                            {a.openPulls.length}
                            {a.morePulls ? "+" : ""} open PR{a.openPulls.length === 1 && !a.morePulls ? "" : "s"}
                          </span>
                          {a.openIssues !== null && <span>{a.openIssues} issues</span>}
                          {a.pushedAt && <span>pushed {timeAgo(a.pushedAt)}</span>}
                        </div>
                        {a.lastCommit && (
                          <a href={a.lastCommit.url} target="_blank" rel="noreferrer" className="block text-xs text-white/65 hover:text-white truncate">
                            <span className="font-mono text-white/35">{a.lastCommit.sha.slice(0, 7)}</span> {a.lastCommit.message}
                            {a.lastCommit.author && <span className="text-white/35"> · {a.lastCommit.author}</span>}
                            {a.lastCommit.date && <span className="text-white/35"> · {timeAgo(a.lastCommit.date)}</span>}
                          </a>
                        )}
                        {a.openPulls.length > 0 && (
                          <ul className="space-y-1 border-t border-white/5 pt-2">
                            {a.openPulls.slice(0, 3).map((pr) => (
                              <li key={pr.number} className="text-xs truncate">
                                <a href={pr.url} target="_blank" rel="noreferrer" className="text-white/70 hover:text-white">
                                  <span className="font-mono text-neon-purple">#{pr.number}</span> {pr.title}
                                  {pr.draft && <span className="text-white/35"> (draft)</span>}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {a.error && <p className="text-xs text-semantic-danger">{a.error}</p>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ═══ Sites ═══ */}
        <section className="space-y-3" aria-labelledby="hub-sites-heading">
          <h2 id="hub-sites-heading" className="text-sm font-mono uppercase tracking-wider text-white/60 flex items-center gap-2">
            <Globe className="w-4 h-4 text-neon-green" /> Websites
          </h2>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (siteName.trim() && siteUrl.trim()) void handleAddSite();
            }}
          >
            <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Name" aria-label="Site name" className={fieldClass + " !w-40"} />
            <input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://your-site.com"
              aria-label="Site address"
              className={fieldClass + " flex-1 min-w-[14rem]"}
            />
            <SelectField value={siteProject} onChange={setSiteProject} options={projectOptions} ariaLabel="Project for site" className="!w-auto min-w-[9rem]" />
            <Button type="submit" variant="primary" color="green" icon={Plus} loading={adding === "site"} disabled={!siteName.trim() || !siteUrl.trim()}>
              Add site
            </Button>
          </form>

          {sites === null && !error ? (
            <div className="py-8 flex justify-center">
              <LoadingSpinner text="Loading sites..." />
            </div>
          ) : sites && sites.length === 0 ? (
            <EmptyState icon={Globe} title="No websites yet">
              Add the sites and apps you run (Render, Replit, Supabase, anything with a URL). Control Hub checks them every time you open
              this page or the dashboard, at most every five minutes.
            </EmptyState>
          ) : (
            <div className="rounded-xl border border-neon-green/20 bg-dark-900/50 divide-y divide-white/5 overflow-hidden">
              {(sites ?? []).map((site) => (
                <div key={site.id} data-testid="hub-site-row" className="px-4 py-3 flex items-center gap-3 min-w-0">
                  <SiteStatusDot status={site.lastStatus} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-white/85 truncate">{site.name}</span>
                      {site.projectName && <ProjectChip name={site.projectName} color={projects.find((p) => p.id === site.projectId)?.color ?? null} />}
                    </div>
                    <a href={site.url} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-white/40 hover:text-white/70 truncate block">
                      {site.url}
                    </a>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div
                      className={`text-xs font-mono ${
                        site.lastStatus === "up"
                          ? "text-neon-green"
                          : site.lastStatus === "degraded"
                            ? "text-semantic-warning"
                            : site.lastStatus === "down"
                              ? "text-semantic-danger"
                              : "text-white/35"
                      }`}
                    >
                      {site.lastStatus === null
                        ? "not checked"
                        : site.lastStatus === "up"
                          ? `up · ${site.lastResponseMs ?? "?"} ms`
                          : site.lastError ?? site.lastStatus}
                    </div>
                    <div className="text-[10px] font-mono text-white/30">checked {timeAgo(site.lastCheckedAt)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRecheck(site.id)}
                    disabled={checking !== null}
                    aria-label={`Check ${site.name} now`}
                    title="Check now"
                    className="p-1.5 rounded-md text-white/35 hover:text-white hover:bg-white/5 disabled:opacity-30"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checking === site.id || checking === "all" ? "animate-spin" : ""}`} />
                  </button>
                  {removeButton("site", site.id, site.name)}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppPageShell>
  );
}
