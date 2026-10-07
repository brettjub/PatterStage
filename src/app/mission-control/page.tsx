// ═══════════════════════════════════════════════════════════════
// Mission Control — Owner Overview (read-only, mostly DEMO)
// ═══════════════════════════════════════════════════════════════
// Synthetic fixture data plus optional live agent process and
// evidence observations; does not replace the `/` dashboard.
// See docs/mission-control-owner-overview.md.

import type { Metadata } from "next";
import { Radar } from "lucide-react";
import AppPageShell from "@/components/layout/AppPageShell";
import PageHeader from "@/components/layout/PageHeader";
import MissionControlClient from "@/components/mission-control/MissionControlClient";

export const metadata: Metadata = {
  title: "Mission Control (demo) | Control Hub",
  description: "Read-only owner overview: synthetic demo data plus optional live agent process and evidence observations.",
};

export default function MissionControlPage() {
  return (
    <AppPageShell>
      <PageHeader
        icon={Radar}
        title="Mission Control"
        subtitle="Owner overview · read-only · demo data + live observations"
        color="purple"
        actions={
          <span
            className="rounded border border-semantic-warning/50 px-2 py-1 text-xs font-mono font-semibold text-semantic-warning"
            data-testid="mc-header-demo-badge"
          >
            DEMO DATA · PAGE NOT LIVE
          </span>
        }
      />
      <MissionControlClient />
    </AppPageShell>
  );
}
