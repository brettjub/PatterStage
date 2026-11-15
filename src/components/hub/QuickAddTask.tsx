// ═══════════════════════════════════════════════════════════════
// QuickAddTask — One-line "add a task" input
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { saveTask } from "@/components/hub/hub-client";
import type { HubTask } from "@/types/hub";

interface QuickAddTaskProps {
  projectId?: string | null;
  dueDate?: string | null;
  placeholder?: string;
  onAdded: (task: HubTask) => void;
  onError: (message: string) => void;
}

export default function QuickAddTask({
  projectId = null,
  dueDate = null,
  placeholder = "Add a task and press Enter",
  onAdded,
  onError,
}: QuickAddTaskProps) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const res = await saveTask(null, { title: trimmed, projectId, dueDate });
    setSaving(false);
    if (!res.ok || !res.data) {
      onError(res.error || "Could not add the task");
      return;
    }
    setTitle("");
    onAdded(res.data.task);
  }

  return (
    <form
      className="flex items-center gap-2 px-4 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Plus className={`w-4 h-4 flex-shrink-0 ${saving ? "text-neon-cyan animate-pulse" : "text-white/30"}`} />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        aria-label="New task title"
        maxLength={300}
        disabled={saving}
        className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-white/30 outline-none py-1"
      />
      {title.trim() && (
        <button type="submit" className="text-[10px] font-mono text-neon-cyan hover:underline flex-shrink-0">
          add ↵
        </button>
      )}
    </form>
  );
}
