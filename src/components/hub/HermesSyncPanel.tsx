// ═══════════════════════════════════════════════════════════════
// HermesSyncPanel — Schedule a Hermes job that keeps My Hub current
// ═══════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, CalendarClock, Copy, Play } from "lucide-react";

import Button from "@/components/ui/Button";
import type { ToastType } from "@/components/ui/Toast";
import { SelectField } from "@/components/hub/HubBits";
import { hubRequest } from "@/components/hub/hub-client";
import { safeApiCall } from "@/lib/api-fetch";
import {
  buildHermesSyncPrompt,
  HUB_SYNC_MISSION_NAME,
  HUB_SYNC_SCHEDULES,
  HUB_SYNC_SOURCES,
  type HubSyncSourceId,
} from "@/lib/hub/hermes-sync";

interface MissionSummary {
  id: string;
  name: string;
  status: string;
  schedule?: string;
  cronJobId?: string;
}

export default function HermesSyncPanel({ showToast }: { showToast: (message: string, type?: ToastType) => void }) {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [sources, setSources] = useState<Set<HubSyncSourceId>>(new Set(HUB_SYNC_SOURCES.map((s) => s.id)));
  const [schedule, setSchedule] = useState<string>(HUB_SYNC_SCHEDULES[0].value);
  const [existing, setExisting] = useState<MissionSummary[] | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState<"now" | "cron" | null>(null);

  const loadExisting = useCallback(async () => {
    const res = await safeApiCall<{ data?: { missions?: MissionSummary[] } }>("/api/missions");
    const missions = res.data?.data?.missions ?? [];
    setExisting(missions.filter((m) => m.name === HUB_SYNC_MISSION_NAME));
  }, []);

  useEffect(() => {
    void hubRequest<{ endpoint: string }>("/api/hub/import").then((res) => {
      if (res.ok && res.data) setEndpoint(res.data.endpoint);
    });
    void loadExisting();
  }, [loadExisting]);

  const prompt = useMemo(
    () => (endpoint ? buildHermesSyncPrompt(endpoint, HUB_SYNC_SOURCES.filter((s) => sources.has(s.id)).map((s) => s.id)) : ""),
    [endpoint, sources],
  );
  const scheduled = (existing ?? []).filter((m) => m.cronJobId);

  async function create(mode: "now" | "cron") {
    if (!prompt) return;
    setBusy(mode);
    const res = await safeApiCall<{ data?: { mission?: { id: string } } }>("/api/missions", {
      method: "POST",
      body: {
        action: "dispatch",
        dispatchMode: mode,
        name: HUB_SYNC_MISSION_NAME,
        instruction: prompt,
        ...(mode === "cron" ? { schedule } : {}),
      },
    });
    setBusy(null);
    if (!res.ok) {
      showToast(res.error || "Hermes could not create the job", "error");
      return;
    }
    showToast(mode === "cron" ? "Sync scheduled. The first run starts now." : "Hermes is syncing your hub now", "success");
    void loadExisting();
  }

  return (
    <section className="space-y-3" aria-labelledby="hub-sync-heading">
      <h2 id="hub-sync-heading" className="text-sm font-mono uppercase tracking-wider text-white/60 flex items-center gap-2">
        <Bot className="w-4 h-4 text-neon-purple" /> Hermes sync
      </h2>
      <p className="text-sm text-white/65 max-w-3xl">
        Hermes reads your sources on a schedule and sends what it finds to the import above, so new meetings, emails waiting on you,
        failing deploys and client issues show up as tasks. It only reads: it never sends, edits or spends anything. It uses the tools
        and credentials your Hermes already has on this server and skips any source it can&rsquo;t reach.
      </p>

      {scheduled.length > 0 && (
        <div className="rounded-lg border border-neon-purple/30 bg-neon-purple/10 px-4 py-3 text-xs text-white/75">
          A sync job is already scheduled{scheduled[0].schedule ? ` (${scheduled[0].schedule})` : ""}. Change or pause it on the{" "}
          <Link href="/orchestration/cron" className="text-neon-purple hover:underline">
            Cron
          </Link>{" "}
          page; see each run&rsquo;s summary on{" "}
          <Link href="/orchestration/missions" className="text-neon-purple hover:underline">
            Missions
          </Link>
          . Scheduling again adds a second job.
        </div>
      )}

      <div className="rounded-xl border border-neon-purple/20 bg-dark-900/50 p-4 space-y-4">
        <fieldset>
          <legend className="text-xs font-medium text-white/60 mb-2">Sources</legend>
          <div className="flex flex-wrap gap-2">
            {HUB_SYNC_SOURCES.map((s) => {
              const on = sources.has(s.id);
              return (
                <label
                  key={s.id}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-mono cursor-pointer transition-colors ${
                    on ? "border-neon-purple/40 text-white" : "border-white/10 text-white/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-neon-purple"
                    checked={on}
                    onChange={() =>
                      setSources((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                  />
                  {s.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/60">How often</span>
            <SelectField
              value={schedule}
              onChange={setSchedule}
              options={HUB_SYNC_SCHEDULES.map((s) => ({ value: s.value, label: s.label }))}
              className="!w-auto min-w-[16rem]"
            />
          </label>
          <Button
            variant="primary"
            color="purple"
            icon={CalendarClock}
            loading={busy === "cron"}
            disabled={!prompt || sources.size === 0 || busy !== null}
            onClick={() => void create("cron")}
          >
            Schedule sync
          </Button>
          <Button icon={Play} loading={busy === "now"} disabled={!prompt || sources.size === 0 || busy !== null} onClick={() => void create("now")}>
            Run once now
          </Button>
        </div>
        <p className="text-[11px] text-white/35">
          Times use the server&rsquo;s clock. Each run is a normal Hermes mission with your default profile, so it uses that profile&rsquo;s
          model and tools.
        </p>

        <div>
          <button type="button" onClick={() => setShowPrompt((v) => !v)} className="text-xs font-mono text-neon-purple hover:underline">
            {showPrompt ? "Hide" : "Show"} what Hermes is asked to do
          </button>
          {showPrompt && prompt && (
            <div className="mt-2 space-y-2">
              <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-dark-950/60 p-3 text-[11px] text-white/70 font-mono max-h-80 overflow-y-auto">
                {prompt}
              </pre>
              <Button
                size="sm"
                icon={Copy}
                onClick={() => {
                  void navigator.clipboard.writeText(prompt).then(
                    () => showToast("Copied", "success"),
                    () => showToast("Copy failed; select the text instead", "error"),
                  );
                }}
              >
                Copy
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
