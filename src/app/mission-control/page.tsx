// ═══════════════════════════════════════════════════════════════
// Mission Control — Owner Overview (read-only, observed data only)
// ═══════════════════════════════════════════════════════════════
// Live agent process and evidence observations only; panels with no
// source show NOT CONNECTED. Does not replace the `/` dashboard.
// See docs/mission-control-owner-overview.md.

import type { Metadata } from "next";
import { Radar } from "lucide-react";
import AppPageShell from "@/components/layout/AppPageShell";
import PageHeader from "@/components/layout/PageHeader";
import MissionControlClient from "@/components/mission-control/MissionControlClient";

export const metadata: Metadata = {
  title: "Mission Control | Control Hub",
  description: "Read-only owner overview: observed agent process and evidence data only; partial coverage.",
};

export default function MissionControlPage() {
  return (
    <AppPageShell>
      <PageHeader
        icon={Radar}
        title="Mission Control"
        subtitle="Owner overview · read-only · observed sources only"
        color="purple"
        actions={
          <span
            className="rounded border border-semantic-warning/50 px-2 py-1 text-xs font-mono font-semibold text-semantic-warning"
            data-testid="mc-header-coverage-badge"
          >
            OBSERVED DATA ONLY · NOT FULLY CONNECTED
          </span>
        }
      />
      <MissionControlClient />
    </AppPageShell>
  );
}
