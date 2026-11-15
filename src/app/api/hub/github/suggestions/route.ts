// ═══════════════════════════════════════════════════════════════
// /api/hub/github/suggestions — Your most recently pushed repositories
// GET → { data: { tokenSource, repos: RepoSuggestion[], error? } }
// Needs a GitHub token; without one, or if GitHub refuses, returns an
// empty list (with GitHub's reason in `error`).
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

import { GithubApiError, GithubClient, listRecentRepos, resolveGithubToken } from "@/lib/hub/github";
import { hubErrorResponse } from "@/lib/hub/hub-route-helpers";

export async function GET() {
  const { token, source } = resolveGithubToken();
  if (!token) {
    return NextResponse.json({ data: { tokenSource: null, repos: [] } });
  }
  try {
    const repos = await listRecentRepos(new GithubClient(token));
    return NextResponse.json({ data: { tokenSource: source, repos } });
  } catch (error) {
    // Suggestions are optional: report GitHub's answer without failing the request.
    if (error instanceof GithubApiError) {
      return NextResponse.json({ data: { tokenSource: source, repos: [], error: error.message } });
    }
    return hubErrorResponse(
      "GET /api/hub/github/suggestions",
      "listing recent repos",
      error,
      "Failed to load your GitHub repositories",
    );
  }
}
