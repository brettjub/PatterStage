/** @jest-environment node */

jest.mock("@/lib/hermes-agent-runtime", () => ({
  getActiveHermesPaths: () => ({ env: "/nonexistent/.env" }),
}));

import {
  ciStateFor,
  clearGithubCache,
  fetchRepoActivity,
  getReposActivity,
  GithubClient,
  parseDotEnv,
  resolveGithubToken,
} from "@/lib/hub/github";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

const REPO = {
  full_name: "octo/app",
  html_url: "https://github.com/octo/app",
  description: "An app",
  private: false,
  default_branch: "main",
  pushed_at: "2026-11-01T10:00:00Z",
  open_issues_count: 5,
};

function routedFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("authorization") });
    const path = url.replace("https://api.github.com", "");
    const key = Object.keys(routes).find((k) => path.startsWith(k + "?") || path === k);
    if (!key) return jsonResponse({ message: "Not Found" }, { status: 404 });
    return routes[key]();
  };
  return { impl, calls };
}

beforeEach(() => clearGithubCache());

describe("parseDotEnv / resolveGithubToken", () => {
  it("parses quotes, comments and export prefixes", () => {
    expect(parseDotEnv('# c\nA=1\nexport B="two"\nC=\'3\'\r\nBAD\n')).toEqual({ A: "1", B: "two", C: "3" });
  });

  it("prefers the Control Hub environment over the Hermes .env", () => {
    expect(resolveGithubToken({ GITHUB_TOKEN: "env-token" }, () => "GITHUB_TOKEN=hermes-token")).toEqual({
      token: "env-token",
      source: "env",
    });
    expect(resolveGithubToken({}, () => "GITHUB_TOKEN=hermes-token")).toEqual({
      token: "hermes-token",
      source: "hermes",
    });
    expect(resolveGithubToken({}, () => "GITHUB_TOKEN=changeme")).toEqual({ token: null, source: null });
    expect(resolveGithubToken({}, () => null)).toEqual({ token: null, source: null });
  });
});

describe("ciStateFor", () => {
  it.each([
    ["in_progress", null, "running"],
    ["queued", null, "running"],
    ["completed", "success", "success"],
    ["completed", "failure", "failure"],
    ["completed", "timed_out", "failure"],
    ["completed", "cancelled", "cancelled"],
    ["completed", null, "none"],
  ])("%s/%s → %s", (status, conclusion, expected) => {
    expect(ciStateFor(status, conclusion)).toBe(expected);
  });
});

describe("fetchRepoActivity", () => {
  it("combines repo, pulls, last commit and CI, subtracting PRs from the issue count", async () => {
    const { impl, calls } = routedFetch({
      "/repos/octo/app": () => jsonResponse(REPO),
      "/repos/octo/app/pulls": () =>
        jsonResponse([
          { number: 7, title: "Add feature", html_url: "https://github.com/octo/app/pull/7", draft: false, updated_at: "2026-11-02T00:00:00Z", user: { login: "dev" } },
        ]),
      "/repos/octo/app/commits": () =>
        jsonResponse([
          { sha: "abc", html_url: "https://github.com/octo/app/commit/abc", commit: { message: "Fix bug\n\nlong body", author: { name: "Dev", date: "2026-11-03T00:00:00Z" } }, author: { login: "dev" } },
        ]),
      "/repos/octo/app/actions/runs": () =>
        jsonResponse({ workflow_runs: [{ name: "CI", status: "completed", conclusion: "failure", html_url: "https://github.com/octo/app/actions/runs/1", updated_at: "2026-11-03T01:00:00Z" }] }),
    });
    const activity = await fetchRepoActivity(new GithubClient("t0ken", impl), "octo/app");
    expect(activity).toMatchObject({
      fullName: "octo/app",
      description: "An app",
      openIssues: 4,
      morePulls: false,
      lastCommit: { sha: "abc", message: "Fix bug", author: "dev" },
      ci: { state: "failure", name: "CI" },
      error: null,
    });
    expect(activity.openPulls).toHaveLength(1);
    expect(calls.every((c) => c.auth === "Bearer t0ken")).toBe(true);
  });

  it("treats a missing Actions setup as no CI rather than an error", async () => {
    const { impl } = routedFetch({
      "/repos/octo/app": () => jsonResponse(REPO),
      "/repos/octo/app/pulls": () => jsonResponse([]),
      "/repos/octo/app/commits": () => jsonResponse([]),
    });
    const activity = await fetchRepoActivity(new GithubClient(null, impl), "octo/app");
    expect(activity.ci.state).toBe("none");
    expect(activity.error).toBeNull();
  });

  it("explains a private repository without a token", async () => {
    const { impl } = routedFetch({});
    const activity = await fetchRepoActivity(new GithubClient(null, impl), "octo/secret");
    expect(activity.error).toBe("Repository not found (private repositories need a GitHub token)");
  });

  it("explains rate limiting", async () => {
    const { impl } = routedFetch({
      "/repos/octo/app": () =>
        jsonResponse({ message: "rate limited" }, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    });
    const activity = await fetchRepoActivity(new GithubClient(null, impl), "octo/app");
    expect(activity.error).toMatch(/^GitHub rate limit reached/);
  });

  it("does not report an issue count when there are more PRs than one page", async () => {
    const { impl } = routedFetch({
      "/repos/octo/app": () => jsonResponse(REPO),
      "/repos/octo/app/pulls": () => jsonResponse([], { headers: { link: '<https://api.github.com/x?page=2>; rel="next"' } }),
      "/repos/octo/app/commits": () => jsonResponse([]),
    });
    const activity = await fetchRepoActivity(new GithubClient(null, impl), "octo/app");
    expect(activity.morePulls).toBe(true);
    expect(activity.openIssues).toBeNull();
  });
});

describe("getReposActivity cache", () => {
  it("serves repeat requests from cache until forced, and never caches failures", async () => {
    let repoCalls = 0;
    let fail = false;
    const { impl } = routedFetch({
      "/repos/octo/app": () => {
        repoCalls++;
        return fail ? jsonResponse({}, { status: 500 }) : jsonResponse(REPO);
      },
      "/repos/octo/app/pulls": () => jsonResponse([]),
      "/repos/octo/app/commits": () => jsonResponse([]),
    });
    const client = new GithubClient(null, impl);
    await getReposActivity(["octo/app"], { client, nowMs: 0 });
    await getReposActivity(["octo/app"], { client, nowMs: 1000 });
    expect(repoCalls).toBe(1);
    await getReposActivity(["octo/app"], { client, nowMs: 2000, force: true });
    expect(repoCalls).toBe(2);

    fail = true;
    const failed = await getReposActivity(["octo/app"], { client, nowMs: 3000, force: true });
    expect(failed.repos[0].error).toBe("GitHub returned HTTP 500");
    fail = false;
    await getReposActivity(["octo/app"], { client, nowMs: 4000 });
    expect(repoCalls).toBe(4);
  });
});
