"use client";

// ═══════════════════════════════════════════════════════════════
// /hub/projects — Personal projects with progress
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FolderKanban, GitBranch, Globe, Pencil, Plus, Trash2 } from "lucide-react";

import AppPageShell from "@/components/layout/AppPageShell";
import PageHeader from "@/components/layout/PageHeader";
import Button from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/Toast";
import {
  DueLabel,
  EmptyState,
  ErrorBanner,
  PROJECT_COLOR_CLASSES,
  ProgressBar,
  Tabs,
} from "@/components/hub/HubBits";
import ProjectEditorModal from "@/components/hub/ProjectEditorModal";
import { hubRequest, removeProject } from "@/components/hub/hub-client";
import { todayLocal } from "@/lib/hub/hub-format";
import { useTwoStepConfirm } from "@/hooks/useTwoStepConfirm";
import type { HubProject, HubProjectWithStats, ProjectStatus } from "@/types/hub";

type StatusTab = ProjectStatus | "all";

const STATUS_BADGE: Record<ProjectStatus, string> = {
  active: "bg-neon-green/10 text-neon-green",
  paused: "bg-semantic-warning/10 text-semantic-warning",
  done: "bg-white/5 text-white/40",
};

export default function ProjectsPage() {
  const { showToast, toastElement } = useToast();
  const [projects, setProjects] = useState<HubProjectWithStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<StatusTab>("active");
  const [editing, setEditing] = useState<HubProject | null>(null);
  const [creating, setCreating] = useState(false);
  const confirmDelete = useTwoStepConfirm({ autoDismissMs: 4000 });
  const today = todayLocal();

  const load = useCallback(async () => {
    const res = await hubRequest<{ projects: HubProjectWithStats[] }>("/api/hub/projects?today=" + todayLocal());
    if (!res.ok || !res.data) {
      setError(res.error || "Could not load projects");
      return;
    }
    setError(null);
    setProjects(res.data.projects);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const list = projects ?? [];
    return {
      active: list.filter((p) => p.status === "active").length,
      paused: list.filter((p) => p.status === "paused").length,
      done: list.filter((p) => p.status === "done").length,
      all: list.length,
    };
  }, [projects]);

  const visible = (projects ?? []).filter((p) => tab === "all" || p.status === tab);

  function handleDelete(project: HubProjectWithStats) {
    if (!confirmDelete.isArmedFor(project.id)) {
      confirmDelete.arm(project.id);
      return;
    }
    void confirmDelete.confirm(async () => {
      const res = await removeProject(project.id);
      if (!res.ok) {
        showToast(res.error || "Could not delete the project", "error");
        return;
      }
      showToast(`Deleted "${project.name}". Its tasks were kept without a project.`, "success");
      void load();
    });
  }

  return (
    <AppPageShell>
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        subtitle={projects ? `${counts.active} active · ${counts.paused} paused · ${counts.done} done` : "Loading…"}
        color="green"
        actions={
          <Button variant="primary" color="green" icon={Plus} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />
      {toastElement}
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "active", label: "Active", count: counts.active },
            { value: "paused", label: "Paused", count: counts.paused },
            { value: "done", label: "Done", count: counts.done },
            { value: "all", label: "All", count: counts.all },
          ]}
        />

        {error && <ErrorBanner message={error} onRetry={load} />}

        {projects === null && !error ? (
          <div className="py-12 flex justify-center">
            <LoadingSpinner text="Loading projects..." />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState icon={FolderKanban} title={tab === "active" || tab === "all" ? "No projects yet" : `No ${tab} projects`}>
            {(tab === "active" || tab === "all") &&
              "Projects group your tasks, websites and GitHub repositories. Create one for each thing you have going on."}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map((p) => {
              const c = PROJECT_COLOR_CLASSES[p.color];
              const armed = confirmDelete.isArmedFor(p.id);
              return (
                <div
                  key={p.id}
                  data-testid="hub-project-card"
                  className={`rounded-xl border ${c.border} bg-dark-900/50 p-4 flex flex-col gap-3 min-w-0`}
                >
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${c.dot}`} />
                        <h2 className="text-base font-semibold text-white truncate">{p.name}</h2>
                      </div>
                      {p.description && <p className="text-xs text-white/50 mt-1 line-clamp-2">{p.description}</p>}
                    </div>
                    <span className={`text-[10px] font-mono rounded px-1.5 py-0.5 flex-shrink-0 ${STATUS_BADGE[p.status]}`}>
                      {p.status}
                    </span>
                  </div>

                  <ProgressBar done={p.doneTasks} total={p.totalTasks} color={p.color} />

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-white/50">
                    <span>
                      <span className="text-white/80">{p.openTasks}</span> open
                    </span>
                    <span>
                      <span className="text-white/80">{p.doneTasks}</span> done
                    </span>
                    {p.overdueTasks > 0 && <span className="text-semantic-danger">{p.overdueTasks} overdue</span>}
                    {p.nextDue && (
                      <span className="inline-flex items-center gap-1">
                        next <DueLabel dueDate={p.nextDue} today={today} />
                      </span>
                    )}
                    {p.siteCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="w-3 h-3" /> {p.siteCount}
                      </span>
                    )}
                    {p.repoCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <GitBranch className="w-3 h-3" /> {p.repoCount}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 mt-auto border-t border-white/5">
                    <Link href={"/hub/tasks?project=" + p.id} className={`text-xs font-mono hover:underline ${c.text}`}>
                      Open tasks →
                    </Link>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(p)}
                        className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/5"
                        aria-label={`Edit ${p.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        aria-label={armed ? "Confirm delete" : `Delete ${p.name}`}
                        title={armed ? "Click again to delete (tasks are kept)" : "Delete"}
                        className={
                          armed
                            ? "px-2 py-1 rounded-md text-[10px] font-mono bg-semantic-danger/20 text-semantic-danger"
                            : "p-1.5 rounded-md text-white/40 hover:text-semantic-danger hover:bg-white/5"
                        }
                      >
                        {armed ? "Delete?" : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ProjectEditorModal
        open={creating || editing !== null}
        project={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(saved) => {
          showToast(editing ? "Project saved" : `Created "${saved.name}"`, "success");
          setCreating(false);
          setEditing(null);
          void load();
        }}
      />
    </AppPageShell>
  );
}
