"use client";

// ═══════════════════════════════════════════════════════════════
// /hub/tasks — Personal task list
// ═══════════════════════════════════════════════════════════════

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListChecks, Plus } from "lucide-react";

import AppPageShell from "@/components/layout/AppPageShell";
import PageHeader from "@/components/layout/PageHeader";
import Button from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorBanner, SelectField, Tabs } from "@/components/hub/HubBits";
import QuickAddTask from "@/components/hub/QuickAddTask";
import TaskRow from "@/components/hub/TaskRow";
import { hubRequest } from "@/components/hub/hub-client";
import { useTaskActions } from "@/components/hub/useTaskActions";
import { todayLocal } from "@/lib/hub/hub-format";
import type { HubProjectWithStats, HubTask } from "@/types/hub";

type StatusTab = "open" | "doing" | "done" | "all";

function TasksPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectFilter = searchParams.get("project") ?? "";
  const { showToast, toastElement } = useToast();

  const [status, setStatus] = useState<StatusTab>("open");
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<HubTask[] | null>(null);
  const [projects, setProjects] = useState<HubProjectWithStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = todayLocal();

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([
      hubRequest<{ tasks: HubTask[] }>("/api/hub/tasks"),
      hubRequest<{ projects: HubProjectWithStats[] }>("/api/hub/projects?today=" + todayLocal()),
    ]);
    if (!t.ok || !t.data) {
      setError(t.error || "Could not load tasks");
      return;
    }
    setError(null);
    setTasks(t.data.tasks);
    if (p.ok && p.data) setProjects(p.data.projects);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useTaskActions({
    projects,
    onChanged: load,
    showToast,
    defaultProjectId: projectFilter && projectFilter !== "none" ? projectFilter : null,
  });

  const inProject = useMemo(() => {
    if (!tasks) return [];
    if (!projectFilter) return tasks;
    return tasks.filter((t) => (projectFilter === "none" ? t.projectId === null : t.projectId === projectFilter));
  }, [tasks, projectFilter]);

  const counts = useMemo(
    () => ({
      open: inProject.filter((t) => t.status !== "done").length,
      doing: inProject.filter((t) => t.status === "doing").length,
      done: inProject.filter((t) => t.status === "done").length,
      all: inProject.length,
    }),
    [inProject],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inProject.filter((t) => {
      if (status === "open" && t.status === "done") return false;
      if (status === "doing" && t.status !== "doing") return false;
      if (status === "done" && t.status !== "done") return false;
      if (!q) return true;
      return t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || (t.projectName ?? "").toLowerCase().includes(q);
    });
  }, [inProject, status, query]);

  const overdue = inProject.filter((t) => t.status !== "done" && t.dueDate !== null && t.dueDate < today).length;
  const currentProject = projects.find((p) => p.id === projectFilter);
  const subtitle = tasks
    ? `${counts.open} open` + (overdue ? ` · ${overdue} overdue` : "") + ` · ${counts.done} done`
    : "Loading…";

  function setProjectFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("project", value);
    else params.delete("project");
    const qs = params.toString();
    router.replace("/hub/tasks" + (qs ? "?" + qs : ""));
  }

  return (
    <AppPageShell>
      <PageHeader
        icon={ListChecks}
        title={currentProject ? `Tasks · ${currentProject.name}` : "Tasks"}
        subtitle={subtitle}
        color="cyan"
        actions={
          <Button variant="primary" color="cyan" icon={Plus} onClick={actions.create}>
            New task
          </Button>
        }
      />
      {toastElement}
      <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            value={status}
            onChange={setStatus}
            options={[
              { value: "open", label: "Open", count: counts.open },
              { value: "doing", label: "In progress", count: counts.doing },
              { value: "done", label: "Done", count: counts.done },
              { value: "all", label: "All", count: counts.all },
            ]}
          />
          <SelectField
            value={projectFilter}
            onChange={setProjectFilter}
            ariaLabel="Filter by project"
            className="!w-auto min-w-[10rem]"
            options={[
              { value: "", label: "All projects" },
              { value: "none", label: "No project" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <div className="flex-1 min-w-[12rem]">
            <SearchInput value={query} onChange={setQuery} placeholder="Search tasks…" />
          </div>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}

        <div className="rounded-xl border border-neon-cyan/20 bg-dark-900/50 overflow-hidden">
          {status !== "done" && (
            <div className="border-b border-white/10">
              <QuickAddTask
                projectId={projectFilter && projectFilter !== "none" ? projectFilter : null}
                placeholder={currentProject ? `Add a task to ${currentProject.name}…` : "Add a task and press Enter"}
                onAdded={(t) => {
                  showToast(`Added "${t.title}"`, "success");
                  void load();
                }}
                onError={(m) => showToast(m, "error")}
              />
            </div>
          )}
          {tasks === null && !error ? (
            <div className="py-12 flex justify-center">
              <LoadingSpinner text="Loading tasks..." />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={ListChecks} title={query ? "No tasks match your search" : status === "done" ? "Nothing finished yet" : "Nothing to do here"}>
                {!query && status !== "done" && "Type above to add your first task, or use New task for due dates and notes."}
              </EmptyState>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {visible.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  busy={actions.busyId === task.id}
                  hideProject={Boolean(projectFilter && projectFilter !== "none")}
                  onToggleDone={actions.toggleDone}
                  onToggleDoing={actions.toggleDoing}
                  onEdit={actions.edit}
                  onSendToHermes={actions.handToHermes}
                  onDelete={actions.requestDelete}
                  deleteArmed={actions.isDeleteArmed(task.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {actions.modals}
    </AppPageShell>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <LoadingSpinner text="Loading tasks..." />
        </div>
      }
    >
      <TasksPageInner />
    </Suspense>
  );
}
