// ═══════════════════════════════════════════════════════════════
// StateChip — text + icon state badge (never colour-only)
// ═══════════════════════════════════════════════════════════════

import {
  Ban,
  Circle,
  CircleDashed,
  CircleQuestionMark,
  Clock,
  LoaderCircle,
  Pause,
  PowerOff,
} from "lucide-react";
import { AVAILABILITY_LABEL, type DisplayedAgentState } from "./freshness";

interface ChipDef {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  classes: string;
}

const CHIP_DEFS: Record<DisplayedAgentState, ChipDef> = {
  running: {
    label: AVAILABILITY_LABEL.running,
    icon: LoaderCircle,
    classes: "bg-neon-green/10 text-neon-green border-neon-green/30",
  },
  idle: {
    label: AVAILABILITY_LABEL.idle,
    icon: Circle,
    classes: "bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30",
  },
  paused: {
    label: AVAILABILITY_LABEL.paused,
    icon: Pause,
    classes: "bg-semantic-warning/10 text-semantic-warning border-semantic-warning/30",
  },
  blocked: {
    label: AVAILABILITY_LABEL.blocked,
    icon: Ban,
    classes: "bg-semantic-danger/10 text-semantic-danger border-semantic-danger/30",
  },
  offline: {
    label: AVAILABILITY_LABEL.offline,
    icon: PowerOff,
    classes: "bg-white/5 text-white/60 border-white/20",
  },
  unknown: {
    label: AVAILABILITY_LABEL.unknown,
    icon: CircleQuestionMark,
    classes: "bg-neon-purple/10 text-neon-purple border-neon-purple/40 border-dashed",
  },
  stale: {
    label: "STALE",
    icon: Clock,
    classes: "bg-semantic-warning/10 text-semantic-warning border-semantic-warning/50 border-dashed",
  },
};

/** Generic neutral chip for run/project states that don't need an agent colour. */
export function TextChip({ children, dashed = false }: { children: React.ReactNode; dashed?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-mono text-white/80 border-white/20 bg-white/5 ${
        dashed ? "border-dashed" : ""
      }`}
    >
      {dashed && <CircleDashed className="w-3 h-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

export default function StateChip({ state }: { state: DisplayedAgentState }) {
  const def = CHIP_DEFS[state];
  const Icon = def.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-mono font-semibold ${def.classes}`}
      data-state={state}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {def.label}
    </span>
  );
}
