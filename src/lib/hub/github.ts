// ═══════════════════════════════════════════════════════════════
// github.ts — Read-only GitHub activity for watched repositories
// ═══════════════════════════════════════════════════════════════
//
// Token lookup order: CH_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN in the
// Control Hub environment, then the same names in the active Hermes
// install's .env (where Hermes keeps the GITHUB_TOKEN it uses itself).
// The token never leaves the server; API responses only say where it
// was found. Without a token, public repositories still work at
// GitHub's anonymous rate limit (60 requests an hour).

import { existsSync, readFileSync } from "fs";

import { getActiveHermesPaths } from "@/lib/hermes-agent-runtime";
import { mapWithLimit } from "@/lib/hub/site-check";
import type {
  CiState,
  GithubPullSummary,
  GithubRepoActivity,
  GithubTokenSource,
} from "@/types/hub";

const API = "https://api.github.com";
const TOKEN_KEYS = ["CH_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"] as const;
export const GITHUB_CACHE_TTL_MS = 3 * 60_000;
const PULLS_PAGE = 20;

// ── Token ──────────────────────────────────────────────────────

/** Minimal KEY=value parser for a .env file (comments and quotes handled). */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7) : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function firstToken(vars: Record<string, string | undefined>): string | null {
  for (const key of TOKEN_KEYS) {
    const v = vars[key]?.trim();
    if (v && v !== "changeme") return v;
  }
  return null;
}

export interface ResolvedToken {
  token: string | null;
  source: GithubTokenSource;
}

export function resolveGithubToken(
  env: Record<string, string | undefined> = process.env,
  readHermesEnv: () => string | null = defaultReadHermesEnv,
): ResolvedToken {
  const fromEnv = firstToken(env);
  if (fromEnv) return { token: fromEnv, source: "env" };
  const hermesContent = readHermesEnv();
  if (hermesContent) {
    const fromHermes = firstToken(parseDotEnv(hermesContent));
    if (fromHermes) return { token: fromHermes, source: "hermes" };
  }
  return { token: null, source: null };
}

function defaultReadHermesEnv(): string | null {
  try {
    const path = getActiveHermesPaths().env;
    return existsSync(path) ? readFileSync(path, "utf-8") : null;
  } catch {
    return null;
  }
}

// ── HTTP ───────────────────────────────────────────────────────

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GithubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GithubApiError";
  }
}

function describeHttpError(res: Response, hasToken: boolean): string {
  if (res.status === 401) return "GitHub rejected the token (expired or revoked?)";
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const when = Number.isFinite(reset) && reset > 0
        ? " until " + new Date(reset * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";
      return `GitHub rate limit reached${when}` + (hasToken ? "" : " (add a token for a higher limit)");
    }
    return "GitHub refused access (the token may lack permission for this repository)";
  }
  if (res.status === 404) {
    return hasToken
      ? "Repository not found, or the token cannot see it"
      : "Repository not found (private repositories need a GitHub token)";
  }
  return `GitHub returned HTTP ${res.status}`;
}

export class GithubClient {
  constructor(
    private readonly token: string | null,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async get<T>(path: string): Promise<{ data: T; headers: Headers }> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ControlHub",
    };
    if (this.token) headers.Authorization = "Bearer " + this.token;
    let res: Response;
    try {
      res = await this.fetchImpl(API + path, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new GithubApiError("Could not reach GitHub: " + msg, 0);
    }
    if (!res.ok) throw new GithubApiError(describeHttpError(res, Boolean(this.token)), res.status);
    return { data: (await res.json()) as T, headers: res.headers };
  }
}

// ── Response shapes (only the fields we read) ─────────────────

interface ApiRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  open_issues_count: number;
}

interface ApiPull {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  updated_at: string;
  user: { login: string } | null;
}

interface ApiCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; date?: string } | null };
  author: { login: string } | null;
}

interface ApiRuns {
  workflow_runs: {
    name: string | null;
    status: string | null;
    conclusion: string | null;
    html_url: string;
    updated_at: string;
  }[];
}

export function ciStateFor(status: string | null, conclusion: string | null): CiState {
  if (status && status !== "completed") return "running";
  switch (conclusion) {
    case "success":
      return "success";
    case "cancelled":
    case "skipped":
    case "neutral":
    case "stale":
      return "cancelled";
    case null:
    case undefined:
      return "none";
    default:
      return "failure";
  }
}

function hasNextPage(headers: Headers): boolean {
  return /rel="next"/.test(headers.get("link") ?? "");
}

/** Fetch one repository's activity. Never throws; failures land in `error`. */
export async function fetchRepoActivity(client: GithubClient, fullName: string): Promise<GithubRepoActivity> {
  const base: GithubRepoActivity = {
    fullName,
    url: "https://github.com/" + fullName,
    description: null,
    isPrivate: false,
    defaultBranch: null,
    pushedAt: null,
    openIssues: null,
    openPulls: [],
    morePulls: false,
    lastCommit: null,
    ci: { state: "none", name: null, url: null, updatedAt: null },
    error: null,
  };
  const path = "/repos/" + fullName.split("/").map(encodeURIComponent).join("/");
  let repo: ApiRepo;
  try {
    repo = (await client.get<ApiRepo>(path)).data;
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
  const branch = repo.default_branch;
  const [pulls, commits, runs] = await Promise.allSettled([
    client.get<ApiPull[]>(`${path}/pulls?state=open&sort=updated&direction=desc&per_page=${PULLS_PAGE}`),
    client.get<ApiCommit[]>(`${path}/commits?per_page=1&sha=${encodeURIComponent(branch)}`),
    client.get<ApiRuns>(`${path}/actions/runs?per_page=1&branch=${encodeURIComponent(branch)}`),
  ]);

  const openPulls: GithubPullSummary[] =
    pulls.status === "fulfilled"
      ? pulls.value.data.map((p) => ({
          number: p.number,
          title: p.title,
          url: p.html_url,
          author: p.user?.login ?? null,
          draft: Boolean(p.draft),
          updatedAt: p.updated_at,
        }))
      : [];
  const c = commits.status === "fulfilled" ? commits.value.data[0] : undefined;
  const run = runs.status === "fulfilled" ? runs.value.data.workflow_runs?.[0] : undefined;
  // Report the first sub-request failure that is not just "Actions not enabled" (404).
  const failed = [pulls, commits, runs].find(
    (r): r is PromiseRejectedResult =>
      r.status === "rejected" && !(r.reason instanceof GithubApiError && r.reason.status === 404),
  );

  return {
    ...base,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    isPrivate: repo.private,
    defaultBranch: branch,
    pushedAt: repo.pushed_at,
    // GitHub's open_issues_count includes open pull requests; subtract them
    // when we know the exact PR count, otherwise report "unknown".
    openIssues:
      pulls.status === "fulfilled" && !hasNextPage(pulls.value.headers)
        ? Math.max(0, repo.open_issues_count - openPulls.length)
        : null,
    openPulls,
    morePulls: pulls.status === "fulfilled" && hasNextPage(pulls.value.headers),
    lastCommit: c
      ? {
          sha: c.sha,
          message: (c.commit.message || "").split("\n")[0],
          author: c.author?.login ?? c.commit.author?.name ?? null,
          date: c.commit.author?.date ?? null,
          url: c.html_url,
        }
      : null,
    ci: run
      ? { state: ciStateFor(run.status, run.conclusion), name: run.name, url: run.html_url, updatedAt: run.updated_at }
      : base.ci,
    error: failed ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : null,
  };
}

// ── Cached activity for the watch list ─────────────────────────

const cache = new Map<string, { at: number; data: GithubRepoActivity }>();

export function clearGithubCache(): void {
  cache.clear();
}

export async function getReposActivity(
  fullNames: readonly string[],
  options: { force?: boolean; client?: GithubClient; nowMs?: number } = {},
): Promise<{ tokenSource: GithubTokenSource; repos: GithubRepoActivity[] }> {
  const resolved = options.client ? null : resolveGithubToken();
  const client = options.client ?? new GithubClient(resolved?.token ?? null);
  const nowMs = options.nowMs ?? Date.now();
  const repos = await mapWithLimit(fullNames, 4, async (name) => {
    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (!options.force && hit && nowMs - hit.at < GITHUB_CACHE_TTL_MS) return hit.data;
    const data = await fetchRepoActivity(client, name);
    // Don't cache failures, so the next refresh retries straight away.
    if (!data.error) cache.set(key, { at: nowMs, data });
    else cache.delete(key);
    return data;
  });
  return { tokenSource: resolved?.source ?? null, repos };
}

export interface RepoSuggestion {
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  pushedAt: string | null;
}

/** Repositories the token's owner pushed to most recently (needs a token). */
export async function listRecentRepos(client: GithubClient, limit = 15): Promise<RepoSuggestion[]> {
  const { data } = await client.get<ApiRepo[]>(
    `/user/repos?sort=pushed&direction=desc&per_page=${limit}&affiliation=owner,collaborator,organization_member`,
  );
  return data.map((r) => ({
    fullName: r.full_name,
    description: r.description,
    isPrivate: r.private,
    pushedAt: r.pushed_at,
  }));
}
