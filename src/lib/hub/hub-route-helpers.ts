// ═══════════════════════════════════════════════════════════════
// hub-route-helpers.ts — Shared bits for /api/hub/* route handlers
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";

import { logApiError } from "@/lib/api-logger";
import { badRequest } from "@/lib/api-response";
import { UnknownProjectError } from "@/lib/hub/hub-repository";
import { hubValidationError } from "@/lib/hub/hub-validation";
import { DuplicateRepoError } from "@/lib/hub/repos-repository";
import { parseJsonBody } from "@/lib/parse-json-body";

/** Parse the JSON body and validate it; returns the data or a 400 response. */
export async function parseHubBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<z.infer<S> | NextResponse> {
  const body = await parseJsonBody(request);
  if (body instanceof NextResponse) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return hubValidationError(parsed.error);
  return parsed.data;
}

/** The `?id=` query parameter, or a 400 response when it is missing. */
export function requireIdParam(request: NextRequest): string | NextResponse {
  const id = request.nextUrl.searchParams.get("id")?.trim();
  return id ? id : badRequest("id is required");
}

export function notFound(what: string): NextResponse {
  return NextResponse.json({ error: `${what} not found` }, { status: 404 });
}

/**
 * Map known repository errors to 4xx responses; log anything else and
 * return a 500 with `fallback` as the message.
 */
export function hubErrorResponse(
  route: string,
  context: string,
  error: unknown,
  fallback: string,
): NextResponse {
  if (error instanceof UnknownProjectError) return badRequest("That project no longer exists");
  if (error instanceof DuplicateRepoError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  logApiError(route, context, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
