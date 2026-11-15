// ═══════════════════════════════════════════════════════════════
// /api/hub/import — Bulk import / sync (Import page and Hermes sync job)
// GET  → { data: { endpoint } }  where a job on this machine should POST
// POST { dryRun?, projects?, tasks?, sites?, repos? }
//      → { data: ImportResult }  (dryRun previews without saving)
// Format and matching rules: src/lib/hub/hub-import.ts, docs/HUB.md.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

import { requireNotReadOnly } from "@/lib/api-auth";
import { applyHubImport, hubImportSchema, localImportEndpoint } from "@/lib/hub/hub-import";
import { hubErrorResponse, parseHubBody } from "@/lib/hub/hub-route-helpers";

export async function GET() {
  return NextResponse.json({ data: { endpoint: localImportEndpoint() } });
}

export async function POST(request: NextRequest) {
  const input = await parseHubBody(request, hubImportSchema);
  if (input instanceof NextResponse) return input;
  if (!input.dryRun) {
    const guard = requireNotReadOnly();
    if (guard) return guard;
  }
  try {
    return NextResponse.json({ data: applyHubImport(input) });
  } catch (error) {
    return hubErrorResponse("POST /api/hub/import", "importing", error, "Import failed");
  }
}
