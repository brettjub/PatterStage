// ═══════════════════════════════════════════════════════════════
// /api/hub/repos — GitHub repositories on the hub's watch list
// GET                         → { data: { repos } }
// POST   { fullName, projectId? }   (owner/name or a github.com URL)
// PUT    { id, projectId }
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
import { repoCreateSchema, repoUpdateSchema } from "@/lib/hub/hub-validation";
import {
  createRepo,
  deleteRepo,
  listRepos,
  updateRepoProject,
} from "@/lib/hub/repos-repository";

export async function GET() {
  try {
    return NextResponse.json({ data: { repos: listRepos() } });
  } catch (error) {
    return hubErrorResponse("GET /api/hub/repos", "listing repos", error, "Failed to load repositories");
  }
}

export async function POST(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const input = await parseHubBody(request, repoCreateSchema);
  if (input instanceof NextResponse) return input;
  try {
    const repo = createRepo(input.fullName, input.projectId ?? null);
    return NextResponse.json({ data: { repo } }, { status: 201 });
  } catch (error) {
    return hubErrorResponse("POST /api/hub/repos", "adding repo", error, "Failed to add repository");
  }
}

export async function PUT(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const input = await parseHubBody(request, repoUpdateSchema);
  if (input instanceof NextResponse) return input;
  try {
    const repo = updateRepoProject(input.id, input.projectId ?? null);
    return repo ? NextResponse.json({ data: { repo } }) : notFound("Repository");
  } catch (error) {
    return hubErrorResponse("PUT /api/hub/repos", `updating repo ${input.id}`, error, "Failed to update repository");
  }
}

export async function DELETE(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const id = requireIdParam(request);
  if (id instanceof NextResponse) return id;
  try {
    return deleteRepo(id) ? NextResponse.json({ data: { deleted: true } }) : notFound("Repository");
  } catch (error) {
    return hubErrorResponse("DELETE /api/hub/repos", `deleting repo ${id}`, error, "Failed to remove repository");
  }
}
