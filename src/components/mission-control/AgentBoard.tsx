// ═══════════════════════════════════════════════════════════════
// Agent board — availability and run state shown separately
// ═══════════════════════════════════════════════════════════════
// With `live`, the board shows the VPS agent process observation and
// its connector status instead of fixture rows.

import { Bot } from "lucide-react";
import Section from "./Section";
import SourceTag from "./SourceTag";
import StateChip, { TextChip } from "./StateChip";
import {
  assessFreshness,
  AVAILABILITY_LABEL,
  displayedAgentState,
  RUN_STATE_LABEL,
} from "./freshness";
import { LIVE_AGENTS_ROUTE, type LiveAgentsState } from "./live-agents";
import type { AgentBoardEntry, SourceStamp } from "./types";

const LIVE_STALE_AFTER_MINUTES = 1;

function ConnectorStatus({ live, nowMs }: { live: LiveAgentsState; nowMs: number }) {
  const { observation, connector, lastError } = live;
  const stamp: SourceStamp = observation
    ? { source: observation.source, kind: "live", checkedAt: observation.checkedAt, staleAfterMinutes: LIVE_STALE_AFTER_MINUTES }
    : {
        source: `VPS agent process exporter via ${LIVE_AGENTS_ROUTE}`,
        kind: "not_connected",
        checkedAt: null,
        staleAfterMinutes: LIVE_STALE_AFTER_MINUTES,
      };

  let status: React.ReactNode;
  if (connector === "connected") {
    status = <span className="text-semantic-success">Connector OK — last poll succeeded.</span>;
  } else if (connector === "connecting") {
    status = <span>Connecting — no observation yet. Agent states are unknown.</span>;
  } else if (observation) {
    status = (
      <span className="text-semantic-warning">
        CONNECTOR UNAVAILABLE ({lastError}). Holding the last successful observation; it turns STALE as it ages.
      </span>
    );
  } else {
    status = (
      <span className="text-semantic-warning">
        NOT CONNECTED — connector unavailable ({lastError}). Agent states are unknown; no process data is shown.
      </span>
    );
  }

  return (
    <div
      className="mb-3 rounded-lg border border-white/10 bg-dark-950/40 p-3 text-xs"
      data-testid="mc-agent-connector"
      data-connector={connector}
    >
      <p className="font-mono font-semibold tracking-wide text-white">LIVE VPS AGENT PROCESS OBSERVATION</p>
      <p className="mt-1 text-white/70" data-testid="mc-agent-connector-status">
        {status}
      </p>
      <p className="mt-1 text-white/60">
        Process observation only: shows which agent processes the exporter saw. Task assignments, run state and
        projects are not known from this source.
      </p>
      <SourceTag stamp={stamp} nowMs={nowMs} />
    </div>
  );
}

export default function AgentBoard({
  agents,
  nowMs,
  live,
}: {
  agents: AgentBoardEntry[];
  nowMs: number;
  /** When set, the board reflects the live process connector rather than fixture rows. */
  live?: LiveAgentsState;
}) {
  let emptyText = "No agents reported by the configured source.";
  if (live && !live.observation) emptyText = "No process observation yet — agent states unknown.";
  else if (live) emptyText = "The last successful observation reported no agent processes.";

  return (
    <Section
      id="agent-board"
      title="Agent board"
      icon={Bot}
      description="Availability is the worker's own state; run state belongs to its task. A stale or missing heartbeat shows STALE or UNKNOWN, never idle."
    >
      {live && <ConnectorStatus live={live} nowMs={nowMs} />}
      {agents.length === 0 ? (
        <p className="text-sm text-white/60" data-testid="mc-agents-empty">
          {emptyText}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Agents">
          {agents.map((agent) => {
            const freshness = assessFreshness(agent.stamp, nowMs);
            const shown = displayedAgentState(agent.availability, freshness);
            return (
              <li
                key={agent.id}
                className="rounded-lg border border-white/10 bg-dark-950/40 p-3 min-w-0"
                data-testid="mc-agent-row"
                data-agent-id={agent.id}
              >
                <h3 className="text-sm font-semibold text-white break-words">
                  {agent.name}
                  <span className="ml-2 text-xs font-mono font-normal text-white/60">{agent.runtime}</span>
                </h3>
                <dl className="mt-2 grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-white/50 pt-0.5">Availability</dt>
                  <dd className="min-w-0" data-testid="mc-agent-availability">
                    <StateChip state={shown} />
                    {shown !== agent.availability && (
                      <span className="ml-2 text-white/60">
                        last reported: {AVAILABILITY_LABEL[agent.availability]}
                      </span>
                    )}
                  </dd>
                  <dt className="text-white/50 pt-0.5">Run state</dt>
                  <dd className="min-w-0" data-testid="mc-agent-run">
                    {agent.run ? (
                      <>
                        <TextChip dashed={agent.run.runState === "unknown" || agent.run.runState === "interrupted"}>
                          {RUN_STATE_LABEL[agent.run.runState]}
                        </TextChip>
                        <span className="block mt-1 text-white/80 break-words">{agent.run.taskLabel}</span>
                        <span className="block text-white/60 font-mono break-words">
                          {agent.run.project}
                          {agent.run.worktree ? ` · ${agent.run.worktree}` : ""}
                        </span>
                      </>
                    ) : agent.stamp.kind === "live" ? (
                      <TextChip dashed>Not observed — process scan cannot see assignments</TextChip>
                    ) : (
                      <span className="text-white/60">No run assigned</span>
                    )}
                  </dd>
                </dl>
                {agent.note && <p className="mt-2 text-xs text-white/60 break-words">{agent.note}</p>}
                <SourceTag stamp={agent.stamp} nowMs={nowMs} />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
