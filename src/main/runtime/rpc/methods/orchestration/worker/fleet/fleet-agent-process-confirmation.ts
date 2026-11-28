import {
  createFleetStatusIndex,
  statusForFleetWorker
} from '../../../../../../../shared/orchestration/fleet/orchestration-fleet-status-index'
import { fleetStatusAcceptsProcessConfirmation } from '../../../../../../../shared/orchestration/fleet/orchestration-fleet-worker-projection'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../../../shared/agent-status/contracts/agent-status-freshness'
import type { FleetAgentStatusEvidence } from '../../../../../../../shared/orchestration/fleet/orchestration-fleet-agent-status-evidence'
import type { AgentProcessVerdict } from '../../../../../../../shared/agent-status/process/agent-process-presence'
import {
  projectDurableWorker,
  type WorkerAttentionFacts,
  type WorkerListRow
} from './fleet-durable-worker'

/** Short enough that an exited process returns to stale soon; long enough that a 10 s poll reuses it. */
export const WORKER_PROCESS_CONFIRMATION_TTL_MS = 60_000

type ConfirmationCacheEntry = { clockAt: number; confirmedAt: number }

/** A live probe's answer for one pane's hook row, reused until the row changes or the TTL passes. */
export class WorkerProcessConfirmationCache {
  private readonly entries = new Map<string, ConfirmationCacheEntry>()

  read(paneKey: string, clockAt: number, now: number): number | undefined {
    const entry = this.entries.get(paneKey)
    if (
      !entry ||
      entry.clockAt !== clockAt ||
      now - entry.confirmedAt > WORKER_PROCESS_CONFIRMATION_TTL_MS
    ) {
      return undefined
    }
    return entry.confirmedAt
  }

  write(paneKey: string, clockAt: number, confirmedAt: number): void {
    this.entries.set(paneKey, { clockAt, confirmedAt })
  }
}

/** The runtime surface a confirmation needs: its own hook-store presence check. */
export type WorkerProcessConfirmationRuntime = {
  checkHookAgentPresence(paneKey: string): Promise<AgentProcessVerdict | null>
}

const cachesByRuntime = new WeakMap<
  WorkerProcessConfirmationRuntime,
  WorkerProcessConfirmationCache
>()

/** One cache per runtime instance, so a confirmation never answers for another host's pane. */
export function workerProcessConfirmationCache(
  owner: WorkerProcessConfirmationRuntime
): WorkerProcessConfirmationCache {
  let cache = cachesByRuntime.get(owner)
  if (!cache) {
    cache = new WorkerProcessConfirmationCache()
    cachesByRuntime.set(owner, cache)
  }
  return cache
}

/** A projection's confirmation, using the runtime's own presence check and per-runtime cache. */
export function confirmStaleWorkerAgentProcessesForRuntime(
  runtime: WorkerProcessConfirmationRuntime,
  args: Omit<Parameters<typeof confirmStaleWorkerAgentProcesses>[0], 'checkPresence' | 'cache'>
): ReturnType<typeof confirmStaleWorkerAgentProcesses> {
  return confirmStaleWorkerAgentProcesses({
    ...args,
    checkPresence: (paneKey) => runtime.checkHookAgentPresence(paneKey),
    cache: workerProcessConfirmationCache(runtime)
  })
}

/**
 * Re-probe the recorded process behind stale at-rest hook evidence, then mark that evidence
 * current. Probing is limited to rows a worker on this page actually projects, a recent answer is
 * reused from the cache, and a failed or absent probe leaves the row stale. Nothing here restamps
 * the hook clock or persists.
 */
export async function confirmStaleWorkerAgentProcesses(args: {
  rows: readonly WorkerListRow[]
  attentionFacts: WorkerAttentionFacts
  statuses: readonly FleetAgentStatusEvidence[]
  now: number
  checkPresence?: (paneKey: string) => Promise<AgentProcessVerdict | null>
  cache?: WorkerProcessConfirmationCache
}): Promise<readonly FleetAgentStatusEvidence[]> {
  const { checkPresence, cache } = args
  if (!checkPresence) {
    return args.statuses
  }
  const workers = args.rows.map((row) => projectDurableWorker(row, args.attentionFacts))
  const index = createFleetStatusIndex(args.statuses, workers)
  const confirmedAt = new Map<FleetAgentStatusEvidence, number>()
  const candidates = new Map<FleetAgentStatusEvidence, string>()
  for (const worker of workers) {
    const evidence = statusForFleetWorker(worker, index)
    if (!evidence || !fleetStatusAcceptsProcessConfirmation(evidence, args.now)) {
      continue
    }
    const cached = cache?.read(evidence.activity.paneKey, evidence.clock.at, args.now)
    if (cached !== undefined) {
      confirmedAt.set(evidence, cached)
      continue
    }
    // A confirmation that is still current needs no second probe; an expired one is re-earned.
    if (
      evidence.processConfirmedAt !== undefined &&
      args.now - evidence.processConfirmedAt <= AGENT_STATUS_STALE_AFTER_MS
    ) {
      confirmedAt.set(evidence, evidence.processConfirmedAt)
      continue
    }
    candidates.set(evidence, evidence.activity.paneKey)
  }
  if (candidates.size > 0) {
    const probes = new Map<string, Promise<AgentProcessVerdict | null>>()
    await Promise.all(
      [...candidates].map(async ([evidence, paneKey]) => {
        let probe = probes.get(paneKey)
        if (!probe) {
          probe = checkPresence(paneKey).catch(() => null)
          probes.set(paneKey, probe)
        }
        if ((await probe) === 'live') {
          confirmedAt.set(evidence, args.now)
          cache?.write(paneKey, evidence.clock.at, args.now)
        }
      })
    )
  }
  return confirmedAt.size === 0
    ? args.statuses
    : args.statuses.map((evidence) => {
        const at = confirmedAt.get(evidence)
        return at === undefined ? evidence : { ...evidence, processConfirmedAt: at }
      })
}
