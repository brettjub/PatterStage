// ═══════════════════════════════════════════════════════════════
// TaskRow — One task line: checkbox, title, chips, actions
// ═══════════════════════════════════════════════════════════════

"use client";

import Link from "next/link";
import { Bot, Check, Pause, Pencil, Play, Trash2 } from "lucide-react";

import { DueLabel, PriorityFlag, ProjectChip } from "@/components/hub/HubBits";
import { sourceLabel } from "@/lib/hub/hub-format";
import type { HubTask } from "@/types/hub";

const MISSION_STATUS_CLASSES: Record<string, string> = {
  queued: "bg-white/5 text-white/50",
  dispatched: "bg-neon-cyan/10 text-neon-cyan",
  successful: "bg-neon-green/10 text-neon-green",
  failed: "bg-semantic-danger/10 text-semantic-danger",
};

interface TaskRowProps {
  task: HubTask;
  today: string;
  busy?: boolean;
  /** Hide the project chip (e.g. when already filtered to one project). */
  hideProject?: boolean;
  onToggleDone: (task: HubTask) => void;
  onToggleDoing?: (task: HubTask) => void;
  onEdit?: (task: HubTask) => void;
  onSendToHermes?: (task: HubTask) => void;
  onDelete?: (task: HubTask) => void;
  /** True while the delete button is armed for confirmation. */
  deleteArmed?: boolean;
}

export default function TaskRow({
  task,
  today,
  busy = false,
  hideProject = false,
  onToggleDone,
  onToggleDoing,
  onEdit,
  onSendToHermes,
  onDelete,
  deleteArmed = false,
}: TaskRowProps) {
  const done = task.status === "done";
  const source = sourceLabel(task.externalKey);
  const actionBtn =
    "p-1.5 rounded-md text-white/35 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30";

  return (
    <div
      className={`group flex items-start gap-3 px-4 py-2.5 min-w-0 ${busy ? "opacity-60" : ""}`}
      data-testid="hub-task-row"
    >
      <button
        type="button"
        onClick={() => onToggleDone(task)}
        disabled={busy}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
          done
            ? "bg-neon-green/20 border-neon-green/60 text-neon-green"
            : "border-white/25 hover:border-neon-green/60"
        }`}
      >
        {done && <Check className="w-3 h-3" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <PriorityFlag priority={task.priority} />
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(task)}
              className={`text-sm text-left truncate hover:underline ${done ? "text-white/35 line-through" : "text-white/85"}`}
            >
              {task.title}
            </button>
          ) : (
            <span className={`text-sm truncate ${done ? "text-white/35 line-through" : "text-white/85"}`}>
              {task.title}
            </span>
          )}
          {task.status === "doing" && (
            <span className="text-[10px] font-mono rounded px-1.5 py-0.5 bg-neon-purple/10 text-neon-purple flex-shrink-0">
              in progress
            </span>
          )}
        </div>
        {(task.notes || (!hideProject && task.projectName) || task.dueDate || task.missionId || source) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1 min-w-0">
            {!hideProject && task.projectName && <ProjectChip name={task.projectName} color={task.projectColor} />}
            {source && (
              <span title={"Imported from " + source} className="text-[10px] font-mono rounded px-1.5 py-0.5 border border-white/10 text-white/40">
                {source}
              </span>
            )}
            {task.dueDate && <DueLabel dueDate={task.dueDate} today={today} done={done} />}
            {task.missionId && (
              <Link
                href="/orchestration/missions"
                title={task.missionName ?? "Hermes mission"}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono hover:underline ${
                  MISSION_STATUS_CLASSES[task.missionStatus ?? ""] ?? "bg-white/5 text-white/40"
                }`}
              >
                <Bot className="w-3 h-3" />
                {task.missionStatus ? "Hermes: " + task.missionStatus : "Hermes mission"}
              </Link>
            )}
            {task.notes && (
              <span className="text-[11px] text-white/35 truncate min-w-0 max-w-full">{task.notes.split("\n")[0]}</span>
            )}
          </div>
        )}
      </div>

      {(onToggleDoing || onSendToHermes || onEdit || onDelete) && (
        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
          {onToggleDoing && !done && (
            <button
              type="button"
              className={actionBtn}
              disabled={busy}
              onClick={() => onToggleDoing(task)}
              aria-label={task.status === "doing" ? "Move back to to-do" : "Start working on it"}
              title={task.status === "doing" ? "Move back to to-do" : "Start working on it"}
            >
              {task.status === "doing" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
          )}
          {onSendToHermes && !done && (
            <button
              type="button"
              className={actionBtn}
              disabled={busy}
              onClick={() => onSendToHermes(task)}
              aria-label="Hand to Hermes"
              title={task.missionId ? "Hand to Hermes again" : "Hand to Hermes"}
            >
              <Bot className="w-3.5 h-3.5" />
            </button>
          )}
          {onEdit && (
            <button type="button" className={actionBtn} disabled={busy} onClick={() => onEdit(task)} aria-label="Edit task" title="Edit">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(task)}
              aria-label={deleteArmed ? "Confirm delete" : "Delete task"}
              title={deleteArmed ? "Click again to delete" : "Delete"}
              className={
                deleteArmed
                  ? "px-2 py-1 rounded-md text-[10px] font-mono bg-semantic-danger/20 text-semantic-danger"
                  : actionBtn + " hover:text-semantic-danger"
              }
            >
              {deleteArmed ? "Delete?" : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
