// ═══════════════════════════════════════════════════════════════
// ImportPanel — Paste or load an import file, preview, pick, import
// ═══════════════════════════════════════════════════════════════

"use client";

import { useMemo, useRef, useState } from "react";
import { Import, Upload } from "lucide-react";

import Button from "@/components/ui/Button";
import type { ToastType } from "@/components/ui/Toast";
import { DueLabel, fieldClass } from "@/components/hub/HubBits";
import { hubRequest } from "@/components/hub/hub-client";
import { todayLocal } from "@/lib/hub/hub-format";

type Kind = "project" | "task" | "site" | "repo";
type Action = "create" | "update" | "unchanged" | "skip";

interface PreviewItem {
  kind: Kind;
  index: number;
  key: string;
  label: string;
  action: Action;
  reason?: string;
  projectName?: string | null;
  dueDate?: string | null;
}

interface ImportResult {
  dryRun: boolean;
  counts: Record<Kind, Record<Action, number>>;
  items: PreviewItem[];
}

const KIND_SECTIONS: { kind: Kind; title: string; field: "projects" | "tasks" | "sites" | "repos" }[] = [
  { kind: "project", title: "Projects", field: "projects" },
  { kind: "task", title: "Tasks", field: "tasks" },
  { kind: "site", title: "Websites", field: "sites" },
  { kind: "repo", title: "GitHub repositories", field: "repos" },
];

const ACTION_BADGE: Record<Action, { label: string; cls: string }> = {
  create: { label: "new", cls: "bg-neon-green/10 text-neon-green" },
  update: { label: "update", cls: "bg-neon-cyan/10 text-neon-cyan" },
  unchanged: { label: "no change", cls: "bg-white/5 text-white/40" },
  skip: { label: "skipped", cls: "bg-white/5 text-white/40" },
};

const itemId = (i: Pick<PreviewItem, "kind" | "index">) => i.kind + ":" + i.index;

export default function ImportPanel({ showToast }: { showToast: (message: string, type?: ToastType) => void }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayLocal();

  const actionable = useMemo(
    () => (preview?.items ?? []).filter((i) => i.action === "create" || i.action === "update"),
    [preview],
  );

  async function runPreview(source = text) {
    setError(null);
    setPreview(null);
    let data: unknown;
    try {
      data = JSON.parse(source);
    } catch (e) {
      setError("That isn't valid JSON: " + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      setError('Expected an object with "projects", "tasks", "sites" and/or "repos".');
      return;
    }
    setBusy("preview");
    const res = await hubRequest<ImportResult>("/api/hub/import", "POST", { ...(data as object), dryRun: true });
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.error || "Preview failed");
      return;
    }
    setParsed(data as Record<string, unknown>);
    setPreview(res.data);
    setSelected(new Set(res.data.items.filter((i) => i.action === "create" || i.action === "update").map(itemId)));
  }

  async function runImport() {
    if (!parsed || !preview) return;
    const body: Record<string, unknown> = {};
    for (const { kind, field } of KIND_SECTIONS) {
      const list = Array.isArray(parsed[field]) ? (parsed[field] as unknown[]) : [];
      body[field] = list.filter((_, index) => selected.has(itemId({ kind, index })));
    }
    setBusy("import");
    const res = await hubRequest<ImportResult>("/api/hub/import", "POST", body);
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.error || "Import failed");
      return;
    }
    const c = res.data.counts;
    const created = c.project.create + c.task.create + c.site.create + c.repo.create;
    const updated = c.project.update + c.task.update + c.site.update + c.repo.update;
    showToast(`Imported: ${created} added, ${updated} updated`, "success");
    setPreview(null);
    setParsed(null);
    setText("");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(kind: Kind, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of actionable.filter((x) => x.kind === kind)) {
        if (on) next.add(itemId(i));
        else next.delete(itemId(i));
      }
      return next;
    });
  }

  return (
    <section className="space-y-3" aria-labelledby="hub-import-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hub-import-heading" className="text-sm font-mono uppercase tracking-wider text-white/60 flex items-center gap-2">
          <Import className="w-4 h-4 text-neon-cyan" /> Import
        </h2>
        <span className="text-[11px] font-mono text-white/35">Nothing is saved until you press Import. Importing twice never duplicates.</span>
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        rows={8}
        spellCheck={false}
        aria-label="Import data (JSON)"
        placeholder={'Paste an import file here, e.g. {"projects": [...], "tasks": [...], "sites": [...], "repos": [...]}'}
        className={fieldClass + " text-xs resize-y"}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" color="cyan" loading={busy === "preview"} disabled={!text.trim() || busy !== null} onClick={() => void runPreview()}>
          Preview
        </Button>
        <Button icon={Upload} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
          Load file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const content = await file.text();
            setText(content);
            void runPreview(content);
          }}
        />
        {error && <span className="text-sm text-semantic-danger">{error}</span>}
      </div>

      {preview && (
        <div className="rounded-xl border border-neon-cyan/20 bg-dark-900/50 overflow-hidden" data-testid="hub-import-preview">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
            <span className="text-xs font-mono text-white/60">
              {actionable.length === 0
                ? "Everything here is already in your hub."
                : `${selected.size} of ${actionable.length} new or changed items selected`}
            </span>
            <Button variant="primary" color="green" loading={busy === "import"} disabled={selected.size === 0 || busy !== null} onClick={() => void runImport()}>
              Import {selected.size} item{selected.size === 1 ? "" : "s"}
            </Button>
          </div>
          {KIND_SECTIONS.map(({ kind, title }) => {
            const items = preview.items.filter((i) => i.kind === kind);
            if (items.length === 0) return null;
            const selectable = items.filter((i) => i.action === "create" || i.action === "update");
            const allOn = selectable.length > 0 && selectable.every((i) => selected.has(itemId(i)));
            return (
              <div key={kind} className="border-b border-white/5 last:border-b-0">
                <div className="flex items-center justify-between px-4 py-2 bg-dark-800/40">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-white/45">
                    {title} <span className="text-white/30">{items.length}</span>
                  </span>
                  {selectable.length > 1 && (
                    <button type="button" onClick={() => toggleAll(kind, !allOn)} className="text-[10px] font-mono text-neon-cyan hover:underline">
                      {allOn ? "select none" : "select all"}
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-white/5">
                  {items.map((i) => {
                    const id = itemId(i);
                    const can = i.action === "create" || i.action === "update";
                    return (
                      <li key={id}>
                        <label className={`flex items-start gap-3 px-4 py-2 ${can ? "cursor-pointer hover:bg-white/[0.02]" : "opacity-60"}`}>
                          <input
                            type="checkbox"
                            className="mt-1 accent-neon-cyan"
                            checked={can && selected.has(id)}
                            disabled={!can}
                            onChange={() => toggle(id)}
                            aria-label={`Import ${i.label}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm text-white/85">{i.label}</span>
                              <span className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${ACTION_BADGE[i.action].cls}`}>{ACTION_BADGE[i.action].label}</span>
                              {i.projectName && <span className="text-[10px] font-mono text-white/40">{i.projectName}</span>}
                              {i.dueDate && <DueLabel dueDate={i.dueDate} today={today} />}
                            </span>
                            {i.reason && <span className="block text-[11px] text-white/35 mt-0.5">{i.reason}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
