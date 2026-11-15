// ═══════════════════════════════════════════════════════════════
// /api/hub/sites/check — Re-check sites now
// POST { id? }  → checks one site, or every site when id is omitted
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hubErrorResponse, notFound } from "@/lib/hub/hub-route-helpers";
import { hubValidationError } from "@/lib/hub/hub-validation";
import { checkSites } from "@/lib/hub/site-monitor";
import { getSite } from "@/lib/hub/sites-repository";
import { parseOptionalJsonBody } from "@/lib/parse-optional-json-body";

const bodySchema = z.object({ id: z.string().trim().min(1).max(100).optional() });

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await parseOptionalJsonBody(request));
  if (!parsed.success) return hubValidationError(parsed.error);
  const { id } = parsed.data;
  try {
    if (id && !getSite(id)) return notFound("Site");
    const sites = await checkSites(id ? { ids: [id] } : {});
    return NextResponse.json({ data: { sites } });
  } catch (error) {
    return hubErrorResponse("POST /api/hub/sites/check", "checking sites", error, "Failed to check sites");
  }
}
