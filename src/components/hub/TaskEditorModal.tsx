// ═══════════════════════════════════════════════════════════════
// TaskEditorModal — Create or edit a task
// ═══════════════════════════════════════════════════════════════

"use client";

import { useEffect, useState } from "react";
import { ListChecks } from "lucide-react";

import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { Field, SelectField, fieldClass } from "@/components/hub/HubBits";
import { saveTask, type TaskDraft } from "@/components/hub/hub-client";
import type { HubProject, HubTask, TaskPriority, TaskStatus } from "@/types/hub";

interface TaskEditorModalProps {
  open: boolean;
  /** Task to edit; null to create a new one. */
  task: HubTask | null;
  projects: Pick<HubProject, "id" | "name">[];
  /** Project preselected for new tasks. */
  defaultProjectId?: string | null;
  onClose: () => void;
  onSaved: (task: HubTask) => void;
}

export default function TaskEditorModal({
  open,
  task,
  projects,
  defaultProjectId = null,
  onClose,
  onSaved,
}: TaskEditorModalProps) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setProjectId(task ? task.projectId ?? "" : defaultProjectId ?? "");
    setStatus(task?.status ?? "todo");
    setPriority(task?.priority ?? "normal");
    setDueDate(task?.dueDate ?? "");
    setError(null);
    setSaving(false);
  }, [open, task, defaultProjectId]);

  async function handleSave() {
    if (!title.trim()) {
      setError("Give the task a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const draft: TaskDraft = {
      title: title.trim(),
      notes,
      projectId: projectId || null,
      status,
      priority,
      dueDate: dueDate || null,
    };
    const res = await saveTask(task?.id ?? null, draft);
    setSaving(false);
    if (!res.ok || !res.data) {
      setError(res.error || "Could not save the task.");
      return;
    }
    onSaved(res.data.task);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "Edit task" : "New task"}
      icon={ListChecks}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" color="cyan" loading={saving} onClick={handleSave}>
            {task ? "Save" : "Add task"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <Field label="Title">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            maxLength={300}
            className={fieldClass}
          />
        </Field>
        <Field label="Notes" hint="Optional. Also sent to Hermes if you hand the task over.">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Details, links, acceptance criteria…"
            className={fieldClass + " resize-y"}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Project">
            <SelectField
              value={projectId}
              onChange={setProjectId}
              options={[
                { value: "", label: "No project" },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
                // Keep the task's own project selectable even if the caller only listed active ones.
                ...(task?.projectId && task.projectName && !projects.some((p) => p.id === task.projectId)
                  ? [{ value: task.projectId, label: task.projectName }]
                  : []),
              ]}
            />
          </Field>
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Status">
            <SelectField
              value={status}
              onChange={(v) => setStatus(v as TaskStatus)}
              options={[
                { value: "todo", label: "To do" },
                { value: "doing", label: "In progress" },
                { value: "done", label: "Done" },
              ]}
            />
          </Field>
          <Field label="Priority">
            <SelectField
              value={priority}
              onChange={(v) => setPriority(v as TaskPriority)}
              options={[
                { value: "high", label: "High" },
                { value: "normal", label: "Normal" },
                { value: "low", label: "Low" },
              ]}
            />
          </Field>
        </div>
        {error && <p className="text-sm text-semantic-danger">{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
