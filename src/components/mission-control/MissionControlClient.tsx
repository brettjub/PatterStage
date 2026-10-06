// ═══════════════════════════════════════════════════════════════
// MissionControlClient — demo fixture + live agent process polling
// ═══════════════════════════════════════════════════════════════
// Builds the synthetic fixture once on mount, polls the same-origin
// agents route (never the VPS directly) and ticks the clock so a held
// observation turns STALE even while polls keep failing.

"use client";

import { useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import OwnerOverview from "./OwnerOverview";
import DemoDataBanner from "./DemoDataBanner";
import { buildDemoSnapshot } from "./demo-fixture";
import {
  applyPollFailure,
  applyPollSuccess,
  CLOCK_TICK_MS,
  fetchLiveAgents,
  INITIAL_LIVE_AGENTS_STATE,
  LIVE_AGENTS_POLL_MS,
  mergeLiveAgents,
  type LiveAgentsState,
} from "./live-agents";
import type { OwnerOverviewSnapshot } from "./types";

export default function MissionControlClient() {
  const [fixture, setFixture] = useState<OwnerOverviewSnapshot | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [live, setLive] = useState<LiveAgentsState>(INITIAL_LIVE_AGENTS_STATE);

  useEffect(() => {
    const now = Date.now();
    setFixture(buildDemoSnapshot(now));
    setNowMs(now);
    const tick = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let next: ReturnType<typeof setTimeout> | undefined;

    // Sequential polling: the next request is scheduled only after the previous settles.
    const poll = async () => {
      const result = await fetchLiveAgents(controller.signal);
      if (controller.signal.aborted) return;
      setLive((prev) =>
        result.ok ? applyPollSuccess(prev, result.observation) : applyPollFailure(prev, result.error)
      );
      setNowMs(Date.now());
      next = setTimeout(poll, LIVE_AGENTS_POLL_MS);
    };
    void poll();

    return () => {
      controller.abort();
      if (next) clearTimeout(next);
    };
  }, []);

  if (fixture === null || nowMs === null) {
    return (
      <div className="flex flex-col">
        <DemoDataBanner />
        <LoadingSpinner text="Loading overview..." />
      </div>
    );
  }

  return <OwnerOverview snapshot={mergeLiveAgents(fixture, live)} nowMs={nowMs} live={live} />;
}
