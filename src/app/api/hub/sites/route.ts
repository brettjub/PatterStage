// ═══════════════════════════════════════════════════════════════
// /api/hub/sites — Websites the hub keeps an eye on
// GET    ?check=stale   (re-check sites not checked in the last 5 minutes first)
// POST   { name, url, projectId? }   (checks the new site straight away)
// PUT    { id, name?, url?, projectId? }
// DELETE ?id=
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

import { requireNotReadOnly } from "@/lib/api-auth";
import {
  hubErrorResponse,
  notFound,
  parseHubBody,
  requireIdParam,
} from "@/lib/hub/hub-route-helpers";
import { siteCreateSchema, siteUpdateSchema } from "@/lib/hub/hub-validation";
import { checkSites } from "@/lib/hub/site-monitor";
import {
  createSite,
  deleteSite,
  getSite,
  listSites,
  updateSite,
} from "@/lib/hub/sites-repository";

export async function GET(request: NextRequest) {
  try {
    const sites =
      request.nextUrl.searchParams.get("check") === "stale"
        ? await checkSites({ onlyStale: true })
        : listSites();
    return NextResponse.json({ data: { sites } });
  } catch (error) {
    return hubErrorResponse("GET /api/hub/sites", "listing sites", error, "Failed to load sites");
  }
}

export async function POST(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const input = await parseHubBody(request, siteCreateSchema);
  if (input instanceof NextResponse) return input;
  try {
    const created = createSite(input);
    await checkSites({ ids: [created.id] });
    return NextResponse.json({ data: { site: getSite(created.id) ?? created } }, { status: 201 });
  } catch (error) {
    return hubErrorResponse("POST /api/hub/sites", "adding site", error, "Failed to add site");
  }
}

export async function PUT(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const input = await parseHubBody(request, siteUpdateSchema);
  if (input instanceof NextResponse) return input;
  const { id, ...fields } = input;
  try {
    const site = updateSite(id, fields);
    if (!site) return notFound("Site");
    if (!site.lastCheckedAt) await checkSites({ ids: [id] });
    return NextResponse.json({ data: { site: getSite(id) ?? site } });
  } catch (error) {
    return hubErrorResponse("PUT /api/hub/sites", `updating site ${id}`, error, "Failed to update site");
  }
}

export async function DELETE(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const id = requireIdParam(request);
  if (id instanceof NextResponse) return id;
  try {
    return deleteSite(id) ? NextResponse.json({ data: { deleted: true } }) : notFound("Site");
  } catch (error) {
    return hubErrorResponse("DELETE /api/hub/sites", `deleting site ${id}`, error, "Failed to delete site");
  }
}
