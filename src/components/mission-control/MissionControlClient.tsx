// ═══════════════════════════════════════════════════════════════
// MissionControlClient — observed-only owner overview polling
// ═══════════════════════════════════════════════════════════════
// Starts from an empty `observed` snapshot (never the demo fixture),
// polls the same-origin agents and evidence routes independently
// (never the VPS or any provider directly) and ticks the clock so held
// observations turn STALE even while polls keep failing.

"use client";

import { useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import OwnerOverview from "./OwnerOverview";
import { buildObservedSnapshot } from "./observed-snapshot";
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
import {
  applyEvidenceFailure,
  applyEvidenceSuccess,
  EVIDENCE_POLL_MS,
  fetchLiveEvidence,
  INITIAL_LIVE_EVIDENCE_STATE,
  withEvidenceMode,
  type LiveEvidenceState,
} from "./live-evidence";
import type { OwnerOverviewSnapshot } from "./types";

export default function MissionControlClient() {
  const [base, setBase] = useState<OwnerOverviewSnapshot | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [live, setLive] = useState<LiveAgentsState>(INITIAL_LIVE_AGENTS_STATE);
  const [evidence, setEvidence] = useState<LiveEvidenceState>(INITIAL_LIVE_EVIDENCE_STATE);

  useEffect(() => {
    const now = Date.now();
    setBase(buildObservedSnapshot(now));
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

  // Evidence has its own sequential loop so a slow or failing source never delays the agent board.
  useEffect(() => {
    const controller = new AbortController();
    let next: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const result = await fetchLiveEvidence(controller.signal);
      if (controller.signal.aborted) return;
      setEvidence((prev) =>
        result.ok ? applyEvidenceSuccess(prev, result.observation) : applyEvidenceFailure(prev, result.error)
      );
      setNowMs(Date.now());
      next = setTimeout(poll, EVIDENCE_POLL_MS);
    };
    void poll();

    return () => {
      controller.abort();
      if (next) clearTimeout(next);
    };
  }, []);

  if (base === null || nowMs === null) {
    return <LoadingSpinner text="Loading overview..." />;
  }

  return (
    <OwnerOverview
      snapshot={withEvidenceMode(mergeLiveAgents(base, live), evidence)}
      nowMs={nowMs}
      live={live}
      evidence={evidence}
    />
  );
}
