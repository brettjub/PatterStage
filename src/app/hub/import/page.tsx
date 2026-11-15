"use client";

// ═══════════════════════════════════════════════════════════════
// /hub/import — Import into My Hub and set up the Hermes sync job
// ═══════════════════════════════════════════════════════════════

import { Import } from "lucide-react";

import AppPageShell from "@/components/layout/AppPageShell";
import PageHeader from "@/components/layout/PageHeader";
import { useToast } from "@/components/ui/Toast";
import HermesSyncPanel from "@/components/hub/HermesSyncPanel";
import ImportPanel from "@/components/hub/ImportPanel";

export default function HubImportPage() {
  const { showToast, toastElement } = useToast();
  return (
    <AppPageShell>
      <PageHeader icon={Import} title="Import & Sync" subtitle="Bring in what you have going on, and keep it current" color="cyan" />
      {toastElement}
      <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-10">
        <ImportPanel showToast={showToast} />
        <HermesSyncPanel showToast={showToast} />
      </div>
    </AppPageShell>
  );
}
