// ═══════════════════════════════════════════════════════════════
// ProjectEditorModal — Create or edit a project
// ═══════════════════════════════════════════════════════════════

"use client";

import { useEffect, useState } from "react";
import { FolderKanban } from "lucide-react";

import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { ColorPicker, Field, SelectField, fieldClass } from "@/components/hub/HubBits";
import { saveProject } from "@/components/hub/hub-client";
import type { HubProject, ProjectColor, ProjectStatus } from "@/types/hub";

interface ProjectEditorModalProps {
  open: boolean;
  project: HubProject | null;
  onClose: () => void;
  onSaved: (project: HubProject) => void;
}

export default function ProjectEditorModal({ open, project, onClose, onSaved }: ProjectEditorModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ProjectColor>("cyan");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setColor(project?.color ?? "cyan");
    setStatus(project?.status ?? "active");
    setError(null);
    setSaving(false);
  }, [open, project]);

  async function handleSave() {
    if (!name.trim()) {
      setError("Give the project a name.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveProject(project?.id ?? null, { name: name.trim(), description, color, status });
    setSaving(false);
    if (!res.ok || !res.data) {
      setError(res.error || "Could not save the project.");
      return;
    }
    onSaved(res.data.project);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "New project"}
      icon={FolderKanban}
      iconColor="text-neon-green"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" color="green" loading={saving} onClick={handleSave}>
            {project ? "Save" : "Create project"}
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
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Website relaunch"
            maxLength={120}
            className={fieldClass}
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this project about?"
            className={fieldClass + " resize-y"}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Colour">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <Field label="Status">
            <SelectField
              value={status}
              onChange={(v) => setStatus(v as ProjectStatus)}
              options={[
                { value: "active", label: "Active" },
                { value: "paused", label: "Paused" },
                { value: "done", label: "Done" },
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
