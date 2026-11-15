// ═══════════════════════════════════════════════════════════════
// /api/hub/projects — Personal projects CRUD
// GET                → { data: { projects } } (with task/site/repo counts)
// POST   { name, description?, color?, status? }
// PUT    { id, name?, description?, color?, status? }
// DELETE ?id=        (tasks, sites and repos are kept, unassigned)
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

import { requireNotReadOnly } from "@/lib/api-auth";
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from "@/lib/hub/hub-repository";
import {
  hubErrorResponse,
  notFound,
  parseHubBody,
  requireIdParam,
} from "@/lib/hub/hub-route-helpers";
import { isoDateSchema, projectCreateSchema, projectUpdateSchema } from "@/lib/hub/hub-validation";

export async function GET(request: NextRequest) {
  const todayParam = request.nextUrl.searchParams.get("today");
  const today = todayParam && isoDateSchema.safeParse(todayParam).success ? todayParam : undefined;
  try {
    return NextResponse.json({ data: { projects: listProjects(today) } });
  } catch (error) {
    return hubErrorResponse("GET /api/hub/projects", "listing projects", error, "Failed to load projects");
  }
}

export async function POST(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const input = await parseHubBody(request, projectCreateSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ data: { project: createProject(input) } }, { status: 201 });
  } catch (error) {
    return hubErrorResponse("POST /api/hub/projects", "creating project", error, "Failed to create project");
  }
}

export async function PUT(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const input = await parseHubBody(request, projectUpdateSchema);
  if (input instanceof NextResponse) return input;
  const { id, ...fields } = input;
  try {
    const project = updateProject(id, fields);
    return project ? NextResponse.json({ data: { project } }) : notFound("Project");
  } catch (error) {
    return hubErrorResponse("PUT /api/hub/projects", `updating project ${id}`, error, "Failed to update project");
  }
}

export async function DELETE(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const id = requireIdParam(request);
  if (id instanceof NextResponse) return id;
  try {
    return deleteProject(id) ? NextResponse.json({ data: { deleted: true } }) : notFound("Project");
  } catch (error) {
    return hubErrorResponse("DELETE /api/hub/projects", `deleting project ${id}`, error, "Failed to delete project");
  }
}
