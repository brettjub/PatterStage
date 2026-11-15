// ═══════════════════════════════════════════════════════════════
// useTaskActions — Shared task interactions (done, start, edit,
// delete with confirmation, hand to Hermes) plus their modals
// ═══════════════════════════════════════════════════════════════

"use client";

import { useCallback, useState } from "react";

import SendToHermesModal from "@/components/hub/SendToHermesModal";
import TaskEditorModal from "@/components/hub/TaskEditorModal";
import { removeTask, saveTask } from "@/components/hub/hub-client";
import type { ToastType } from "@/components/ui/Toast";
import { useTwoStepConfirm } from "@/hooks/useTwoStepConfirm";
import type { HubProject, HubTask } from "@/types/hub";

interface Options {
  projects: Pick<HubProject, "id" | "name">[];
  /** Called after any change so the caller can refetch. */
  onChanged: () => void;
  showToast: (message: string, type?: ToastType) => void;
  defaultProjectId?: string | null;
}

export function useTaskActions({ projects, onChanged, showToast, defaultProjectId = null }: Options) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<HubTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [handingOver, setHandingOver] = useState<HubTask | null>(null);
  const confirmDelete = useTwoStepConfirm({ autoDismissMs: 4000 });

  const update = useCallback(
    async (task: HubTask, fields: Parameters<typeof saveTask>[1], message?: string) => {
      setBusyId(task.id);
      const res = await saveTask(task.id, fields);
      setBusyId(null);
      if (!res.ok) {
        showToast(res.error || "Could not update the task", "error");
        return;
      }
      if (message) showToast(message, "success");
      onChanged();
    },
    [onChanged, showToast],
  );

  const toggleDone = useCallback(
    (task: HubTask) =>
      update(task, { status: task.status === "done" ? "todo" : "done" }, task.status === "done" ? undefined : "Done ✓"),
    [update],
  );

  const toggleDoing = useCallback(
    (task: HubTask) => update(task, { status: task.status === "doing" ? "todo" : "doing" }),
    [update],
  );

  const requestDelete = useCallback(
    (task: HubTask) => {
      if (!confirmDelete.isArmedFor(task.id)) {
        confirmDelete.arm(task.id);
        return;
      }
      void confirmDelete.confirm(async () => {
        setBusyId(task.id);
        const res = await removeTask(task.id);
        setBusyId(null);
        if (!res.ok) {
          showToast(res.error || "Could not delete the task", "error");
          return;
        }
        showToast("Task deleted", "success");
        onChanged();
      });
    },
    [confirmDelete, onChanged, showToast],
  );

  const modals = (
    <>
      <TaskEditorModal
        open={creating || editing !== null}
        task={editing}
        projects={projects}
        defaultProjectId={defaultProjectId}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(saved) => {
          showToast(editing ? "Task saved" : `Added "${saved.title}"`, "success");
          setCreating(false);
          setEditing(null);
          onChanged();
        }}
      />
      <SendToHermesModal
        task={handingOver}
        onClose={() => setHandingOver(null)}
        onSent={(_task, mode) => {
          setHandingOver(null);
          showToast(mode === "now" ? "Hermes is on it" : "Draft mission saved — review it on Missions", "success");
          onChanged();
        }}
      />
    </>
  );

  return {
    busyId,
    isDeleteArmed: confirmDelete.isArmedFor,
    toggleDone,
    toggleDoing,
    requestDelete,
    edit: setEditing,
    create: () => setCreating(true),
    handToHermes: setHandingOver,
    modals,
  };
}
