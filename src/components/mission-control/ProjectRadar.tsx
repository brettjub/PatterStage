// ═══════════════════════════════════════════════════════════════
// Project radar — recorded (not verified) project positions
// ═══════════════════════════════════════════════════════════════

import { FolderKanban } from "lucide-react";
import Section from "./Section";
import SourceTag from "./SourceTag";
import { TextChip } from "./StateChip";
import { RegisterReadStatus, RegisterRowProvenance } from "./RegisterStatus";
import {
  ownerReviewStatus,
  registerSourceDisplay,
  type OwnerReviewState,
  type RegisterProject,
  type RegisterState,
} from "./live-register";
import type { ProjectRadarEntry, ProjectState } from "./types";

const PROJECT_STATE_LABEL: Record<ProjectState, string> = {
  active: "Active",
  paused: "Paused",
  idea: "Idea",
  unknown: "Unknown",
};

const REVIEW_CHIP: Record<OwnerReviewState, string> = {
  reviewed: "Owner-reviewed",
  review_stale: "REVIEW STALE",
  unverified: "UNVERIFIED",
};

function ProjectFields({ p }: { p: Pick<RegisterProject, "recordedState" | "position" | "blocker" | "nextMove"> }) {
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
      <dt className="text-white/50">Recorded state</dt>
      <dd className="text-white/80">{PROJECT_STATE_LABEL[p.recordedState]}</dd>
      <dt className="text-white/50">Position</dt>
      <dd className="text-white/80 min-w-0 break-words">{p.position}</dd>
      {p.blocker && (
        <>
          <dt className="text-semantic-warning">Recorded blocker</dt>
          <dd className="text-white/80 min-w-0 break-words">{p.blocker}</dd>
        </>
      )}
      <dt className="text-white/50">Next move</dt>
      <dd className="text-white/80 min-w-0 break-words">{p.nextMove}</dd>
    </dl>
  );
}

function RegisterEmptyText({ register, nowMs }: { register: RegisterState; nowMs: number }) {
  const display = registerSourceDisplay(register, nowMs);
  if (display === "live") return <>0 projects recorded in register.</>;
  if (display === "connecting") return <>CONNECTING — owner register not read yet. Project states are unknown.</>;
  if (display === "unavailable") {
    return <>UNAVAILABLE — the owner register could not be read. Project states and blockers are unknown.</>;
  }
  return <>The last successful read recorded 0 projects; current project states are unknown.</>;
}

/** Radar backed by the owner register: recorded rows, each with its own owner-review freshness. */
function RegisterRadar({ register, nowMs }: { register: RegisterState; nowMs: number }) {
  const projects = register.observation?.projects ?? [];
  return (
    <Section
      id="project-radar"
      title="Project radar"
      icon={FolderKanban}
      description="Project rows as recorded in the manually maintained owner register — a successful read is not verification of any project status. Rows without an owner review are UNVERIFIED."
    >
      <RegisterReadStatus register={register} nowMs={nowMs} />
      {projects.length === 0 ? (
        <p className="text-sm text-white/70" data-testid="mc-radar-empty">
          <RegisterEmptyText register={register} nowMs={nowMs} />
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Projects recorded in register">
          {projects.map((p) => {
            const review = ownerReviewStatus(p.ownerReviewedAt, nowMs).state;
            return (
              <li
                key={p.id}
                className="rounded-lg border border-white/10 bg-dark-950/40 p-3 min-w-0"
                data-testid="mc-project-row"
                data-project-id={p.id}
                data-review={review}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">{p.name}</h3>
                  <TextChip dashed={review !== "reviewed"}>{REVIEW_CHIP[review]}</TextChip>
                </div>
                <p className="mt-1 text-xs text-white/70">{p.outcome}</p>
                <ProjectFields p={p} />
                <RegisterRowProvenance
                  register={register}
                  ownerReviewedAt={p.ownerReviewedAt}
                  sourceUrl={p.sourceUrl}
                  sourceUrlWithheld={p.sourceUrlWithheld}
                  nowMs={nowMs}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export default function ProjectRadar({
  projects,
  nowMs,
  notConnected = false,
  register,
}: {
  projects: ProjectRadarEntry[];
  nowMs: number;
  /** No authoritative project source exists: show NOT CONNECTED, never project cards. */
  notConnected?: boolean;
  /** Owner register poll state; when given, the radar shows recorded rows from it instead of `projects`. */
  register?: RegisterState;
}) {
  if (register) return <RegisterRadar register={register} nowMs={nowMs} />;
  if (notConnected) {
    return (
      <Section
        id="project-radar"
        title="Project radar"
        icon={FolderKanban}
        description="Recorded project positions, once a project source exists."
      >
        <p className="rounded-lg border border-dashed border-white/20 p-3 text-sm text-white/70" data-testid="mc-radar-not-connected">
          NOT CONNECTED — no authoritative project source exists yet. Project states, blockers and release gates are
          unknown. Evidence below does not stand in for a project status.
        </p>
      </Section>
    );
  }
  return (
    <Section
      id="project-radar"
      title="Project radar"
      icon={FolderKanban}
      description="Synthetic example projects (demo). None describes a real project or has been verified against any source."
    >
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Projects">
        {projects.map((p) => (
          <li
            key={p.id}
            className="rounded-lg border border-white/10 bg-dark-950/40 p-3 min-w-0"
            data-testid="mc-project-row"
            data-project-id={p.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{p.name}</h3>
              <TextChip dashed={p.verification === "unverified"}>
                {p.verification === "unverified" ? "UNVERIFIED" : "Verified"}
              </TextChip>
            </div>
            <p className="mt-1 text-xs text-white/70">{p.outcome}</p>
            <ProjectFields p={p} />
            <SourceTag stamp={p.stamp} nowMs={nowMs} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
