// ═══════════════════════════════════════════════════════════════
// SendToHermesModal — Turn a task into a Hermes mission
// ═══════════════════════════════════════════════════════════════

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";

import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { sendTaskToHermes, type MissionMode } from "@/components/hub/hub-client";
import { buildTaskMissionInstruction } from "@/lib/hub/hub-format";
import type { HubTask } from "@/types/hub";

interface SendToHermesModalProps {
  task: HubTask | null;
  onClose: () => void;
  onSent: (task: HubTask, mode: MissionMode) => void;
}

export default function SendToHermesModal({ task, onClose, onSent }: SendToHermesModalProps) {
  const [busy, setBusy] = useState<MissionMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(null);
    setError(null);
  }, [task]);

  async function send(mode: MissionMode) {
    if (!task) return;
    setBusy(mode);
    setError(null);
    const res = await sendTaskToHermes(task, mode);
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.error || "Hermes could not take the task.");
      return;
    }
    onSent(res.data.task, mode);
  }

  return (
    <Modal
      open={task !== null}
      onClose={onClose}
      title="Hand to Hermes"
      icon={Bot}
      iconColor="text-neon-purple"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button variant="secondary" loading={busy === "save"} disabled={busy !== null} onClick={() => send("save")}>
            Save as draft mission
          </Button>
          <Button variant="primary" color="purple" loading={busy === "now"} disabled={busy !== null} onClick={() => send("now")}>
            Run now
          </Button>
        </>
      }
    >
      {task && (
        <div className="space-y-4">
          <p className="text-sm text-white/70">
            Hermes gets this as a mission. <strong className="text-white">Save as draft</strong> lets you review it on the{" "}
            <Link href="/orchestration/missions" className="text-neon-cyan hover:underline">
              Missions
            </Link>{" "}
            page first; <strong className="text-white">Run now</strong>
            {" dispatches it straight away with your default agent profile. "} The task moves to &ldquo;in progress&rdquo; and shows the mission&rsquo;s status.
          </p>
          {task.missionId && (
            <p className="text-xs text-semantic-warning">
              This task already has a mission{task.missionStatus ? ` (${task.missionStatus})` : ""}. Sending it again creates a
              new one.
            </p>
          )}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1.5">Instruction</div>
            <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-dark-900/60 p-3 text-xs text-white/75 font-mono max-h-60 overflow-y-auto">
              {buildTaskMissionInstruction(task)}
            </pre>
            <p className="text-[11px] text-white/35 mt-1.5">Edit the task&rsquo;s notes to change what Hermes is asked to do.</p>
          </div>
          {error && <p className="text-sm text-semantic-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
