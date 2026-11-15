// ═══════════════════════════════════════════════════════════════
// hub-client.ts — Typed browser calls to /api/hub/*
// ═══════════════════════════════════════════════════════════════

"use client";

import { safeApiCall } from "@/lib/api-fetch";
import { buildTaskMissionInstruction } from "@/lib/hub/hub-format";
import type { HubProject, HubSite, HubTask, HubRepo } from "@/types/hub";

export interface HubResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Call a hub endpoint and unwrap `{ data }`. Never throws. */
export async function hubRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<HubResult<T>> {
  const res = await safeApiCall<{ data?: T }>(path, { method, body });
  return res.ok ? { ok: true, data: res.data?.data } : { ok: false, error: res.error };
}

export type TaskDraft = Partial<
  Pick<HubTask, "title" | "notes" | "projectId" | "status" | "priority" | "dueDate">
>;

export function saveTask(id: string | null, draft: TaskDraft) {
  return id
    ? hubRequest<{ task: HubTask }>("/api/hub/tasks", "PUT", { id, ...draft })
    : hubRequest<{ task: HubTask }>("/api/hub/tasks", "POST", draft);
}

export function removeTask(id: string) {
  return hubRequest<{ deleted: boolean }>("/api/hub/tasks?id=" + encodeURIComponent(id), "DELETE");
}

export type ProjectDraft = Partial<Pick<HubProject, "name" | "description" | "color" | "status">>;

export function saveProject(id: string | null, draft: ProjectDraft) {
  return id
    ? hubRequest<{ project: HubProject }>("/api/hub/projects", "PUT", { id, ...draft })
    : hubRequest<{ project: HubProject }>("/api/hub/projects", "POST", draft);
}

export function removeProject(id: string) {
  return hubRequest<{ deleted: boolean }>("/api/hub/projects?id=" + encodeURIComponent(id), "DELETE");
}

export function addSite(draft: { name: string; url: string; projectId: string | null }) {
  return hubRequest<{ site: HubSite }>("/api/hub/sites", "POST", draft);
}

export function removeSite(id: string) {
  return hubRequest<{ deleted: boolean }>("/api/hub/sites?id=" + encodeURIComponent(id), "DELETE");
}

export function recheckSites(id?: string) {
  return hubRequest<{ sites: HubSite[] }>("/api/hub/sites/check", "POST", id ? { id } : {});
}

export function addRepo(fullName: string, projectId: string | null) {
  return hubRequest<{ repo: HubRepo }>("/api/hub/repos", "POST", { fullName, projectId });
}

export function removeRepo(id: string) {
  return hubRequest<{ deleted: boolean }>("/api/hub/repos?id=" + encodeURIComponent(id), "DELETE");
}

export type MissionMode = "save" | "now";

/**
 * Create a Hermes mission from a task (draft or dispatched now) and link it
 * to the task. Returns the updated task.
 */
export async function sendTaskToHermes(task: HubTask, mode: MissionMode): Promise<HubResult<{ task: HubTask }>> {
  const created = await safeApiCall<{ data?: { mission?: { id: string } } }>("/api/missions", {
    method: "POST",
    body: {
      action: "dispatch",
      dispatchMode: mode,
      name: task.title.slice(0, 120),
      instruction: buildTaskMissionInstruction(task),
    },
  });
  const missionId = created.data?.data?.mission?.id;
  if (!created.ok || !missionId) {
    return { ok: false, error: created.error || "Hermes did not return a mission" };
  }
  const linked = await hubRequest<{ task: HubTask }>("/api/hub/tasks", "PUT", {
    id: task.id,
    missionId,
    status: task.status === "todo" ? "doing" : task.status,
  });
  return linked.ok ? linked : { ok: false, error: "Mission created, but linking it to the task failed: " + linked.error };
}
