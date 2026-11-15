// ═══════════════════════════════════════════════════════════════
// /api/hub/github — Live activity for watched GitHub repositories
// GET ?refresh=1  → bypass the 3-minute cache
// → { data: { tokenSource, repos: GithubRepoActivity[] } }
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

import { getReposActivity } from "@/lib/hub/github";
import { hubErrorResponse } from "@/lib/hub/hub-route-helpers";
import { listRepos } from "@/lib/hub/repos-repository";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    const watched = listRepos();
    const { tokenSource, repos } = await getReposActivity(
      watched.map((r) => r.fullName),
      { force },
    );
    return NextResponse.json({ data: { tokenSource, repos } });
  } catch (error) {
    return hubErrorResponse("GET /api/hub/github", "loading repo activity", error, "Failed to load GitHub activity");
  }
}
