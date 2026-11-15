// ═══════════════════════════════════════════════════════════════
// /api/hub/tasks — Personal tasks CRUD
// GET    ?projectId=<id|none>&status=<open|done|all|todo|doing>
// POST   { title, notes?, projectId?, status?, priority?, dueDate? }
// PUT    { id, title?, notes?, projectId?, status?, priority?, dueDate?, missionId? }
// DELETE ?id=
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

import { requireNotReadOnly } from "@/lib/api-auth";
import { badRequest } from "@/lib/api-response";
import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
  type TaskStatusFilter,
} from "@/lib/hub/hub-repository";
import {
  hubErrorResponse,
  notFound,
  parseHubBody,
  requireIdParam,
} from "@/lib/hub/hub-route-helpers";
import { taskCreateSchema, taskUpdateSchema } from "@/lib/hub/hub-validation";

const STATUS_FILTERS: readonly TaskStatusFilter[] = ["open", "done", "all", "todo", "doing"];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? "all";
  if (!(STATUS_FILTERS as readonly string[]).includes(status)) {
    return badRequest("status must be one of: " + STATUS_FILTERS.join(", "));
  }
  const projectId = params.get("projectId")?.trim() || undefined;
  try {
    const tasks = listTasks({ projectId, status: status as TaskStatusFilter });
    return NextResponse.json({ data: { tasks } });
  } catch (error) {
    return hubErrorResponse("GET /api/hub/tasks", "listing tasks", error, "Failed to load tasks");
  }
}

export async function POST(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const input = await parseHubBody(request, taskCreateSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ data: { task: createTask(input) } }, { status: 201 });
  } catch (error) {
    return hubErrorResponse("POST /api/hub/tasks", "creating task", error, "Failed to create task");
  }
}

export async function PUT(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const input = await parseHubBody(request, taskUpdateSchema);
  if (input instanceof NextResponse) return input;
  const { id, ...fields } = input;
  try {
    const task = updateTask(id, fields);
    return task ? NextResponse.json({ data: { task } }) : notFound("Task");
  } catch (error) {
    return hubErrorResponse("PUT /api/hub/tasks", `updating task ${id}`, error, "Failed to update task");
  }
}

export async function DELETE(request: NextRequest) {
  const guard = requireNotReadOnly();
  if (guard) return guard;
  const id = requireIdParam(request);
  if (id instanceof NextResponse) return id;
  try {
    return deleteTask(id) ? NextResponse.json({ data: { deleted: true } }) : notFound("Task");
  } catch (error) {
    return hubErrorResponse("DELETE /api/hub/tasks", `deleting task ${id}`, error, "Failed to delete task");
  }
}
