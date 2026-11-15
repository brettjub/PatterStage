// ═══════════════════════════════════════════════════════════════
// /api/hub/summary — Dashboard overview of tasks, projects and sites
// GET ?today=YYYY-MM-DD  (the browser's date; defaults to server date)
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

import { hubErrorResponse } from "@/lib/hub/hub-route-helpers";
import { getHubSummary } from "@/lib/hub/hub-summary";
import { isoDateSchema } from "@/lib/hub/hub-validation";

export async function GET(request: NextRequest) {
  const todayParam = request.nextUrl.searchParams.get("today");
  const today = todayParam && isoDateSchema.safeParse(todayParam).success ? todayParam : undefined;
  try {
    return NextResponse.json({ data: getHubSummary(today) });
  } catch (error) {
    return hubErrorResponse("GET /api/hub/summary", "building summary", error, "Failed to load hub summary");
  }
}
