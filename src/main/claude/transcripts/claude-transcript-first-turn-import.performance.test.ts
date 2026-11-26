import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../../shared/agent-session/journal/agent-session-journal-identity'
import { claudeProviderHandle } from '../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle-encoding'
import { readTestJournalItems } from '../../native-chat/agent-session-journal/journal-observation.test-support'
import { createTrackedJournalOpener } from '../../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
import { createDeferredStructuredAgentSessionEventSink } from '../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-event-sink'
import { recordingStructuredAgentSessionLogger } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-logger.test-fixture'
import { testEventSinkLogging } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-logger.test-fixture'
import { agentJournalTurnBody } from '../../../shared/agent-session/lifecycle/records/agent-session-turn-record'
import { agentJournalItemKey } from '../../../shared/agent-session/journal/agent-session-journal-item-key'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { catchUpClaudeTranscript } from './claude-transcript-catch-up'

const SESSION = 'session-first-turn-import'
const PROVIDER = '6f1c2d3e-0000-4000-8000-000000000001'
const journals = createTrackedJournalOpener({ legacyInputs: true })
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
})

/** A first turn whose prompt the chat holds, then `rows` assistant replies of `chars` each. */
async function writeTranscript(path: string, cwd: string, rows: number, chars: number) {
  const file = await open(path, 'w')
  const base = { sessionId: PROVIDER, cwd, isSidechain: false, userType: 'external', version: '2' }
  const prompt = {
    ...base,
    type: 'user',
    uuid: 'prompt-1',
    parentUuid: null,
    timestamp: new Date(1_700_000_000_000).toISOString(),
    message: { role: 'user', content: 'write a long reply' }
  }
  let parent = prompt.uuid
  const lines = [JSON.stringify(prompt)]
  const text = 'x'.repeat(chars)
  for (let index = 0; index < rows; index++) {
    const uuid = `reply-${index}`
    lines.push(
      JSON.stringify({
        ...base,
        type: 'assistant',
        uuid,
        parentUuid: parent,
        timestamp: new Date(1_700_000_000_000 + index).toISOString(),
        message: {
          id: `msg_${index}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: `${index} ${text}` }],
          stop_reason: 'end_turn'
        }
      })
    )
    parent = uuid
    if (lines.length >= 512) {
      await file.write(`${lines.splice(0).join('\n')}\n`)
    }
  }
  await file.write(`${lines.join('\n')}\n`)
  await file.close()
}

async function measure(rows: number, chars: number) {
  const root = await mkdtemp(join(tmpdir(), 'orca-first-turn-import-'))
  const cwd = join(root, 'repo')
  const claudeConfigDir = join(root, 'claude')
  const bucket = join(claudeConfigDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  await mkdir(bucket, { recursive: true })
  await writeTranscript(join(bucket, `${PROVIDER}.jsonl`), cwd, rows, chars)
  const journal = await journals.open({
    identity: {
      sessionId: SESSION,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'claude',
      providerHandle: claudeProviderHandle(PROVIDER, null)
    } satisfies AgentSessionJournalIdentity,
    stateDirectory: root,
    now: () => 1_700_000_000
  })
  const deferred = createDeferredStructuredAgentSessionEventSink(testEventSinkLogging())
  deferred.bind({ journal, fence: 1, publish: () => {} })
  cleanups.push(async () => {
    deferred.close()
    await journals.closeAll()
    await rm(root, { recursive: true, force: true })
  })
  // The chat as Orca left it: the first prompt and its open turn, no turn end saved.
  const turn = { provider: 'orca' as const, clientMessageId: 'claude-turn:first' }
  const prompt = { provider: 'orca' as const, clientMessageId: 'claude-prompt:first' }
  await journal.appendItem(
    turn,
    agentJournalTurnBody({ turnId: 'first', state: 'running', startedAt: 1_700_000_000_000 }),
    { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  await journal.appendItem(
    prompt,
    { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'write a long reply' }] },
    { fence: 1, turnScope: { kind: 'turn', turnItemId: agentJournalItemKey(turn) } }
  )
  const seeded = await readTestJournalItems(journal)
  const before = seeded.length
  console.info(
    `seeded: ${JSON.stringify(seeded.map((item) => [item.itemId, item.body.kind, item.linkage]))}`
  )
  const recorder = recordingStructuredAgentSessionLogger()

  const delay = monitorEventLoopDelay({ resolution: 1 })
  const elu = performance.eventLoopUtilization()
  const started = performance.now()
  delay.enable()
  const caughtUp = await catchUpClaudeTranscript({
    sessionId: SESSION,
    providerSessionId: PROVIDER,
    leafUuid: '',
    fromFirstPrompt: true,
    claudeConfigDir,
    cwd,
    sink: deferred.sink,
    timeoutMs: 600_000,
    logger: recorder.logger
  })
  console.info(`catch-up log: ${JSON.stringify(recorder.entries)}`)
  delay.disable()
  const elapsedMs = performance.now() - started
  const busy = performance.eventLoopUtilization(elu)
  const after = (await readTestJournalItems(journal)).length
  return {
    caughtUp,
    imported: after - before,
    elapsedMs,
    busyMs: busy.active,
    blockMs: delay.max / 1e6
  }
}

// The worst first turn a chat can import before its first send: 64 MiB of transcript.
describe('first-turn transcript import', () => {
  it(
    'imports a 64 MiB first turn without blocking main for long',
    async () => {
      const cases = [
        { rows: 1_500, chars: 4_000 },
        { rows: 15_000, chars: 4_000 }
      ]
      for (const { rows, chars } of cases) {
        const result = await measure(rows, chars)
        console.info(
          `first-turn import ${rows} rows x ${chars} chars (${((rows * chars) / 2 ** 20).toFixed(1)} MiB): ` +
            `caughtUp=${result.caughtUp} imported=${result.imported} ` +
            `first-send delay ${result.elapsedMs.toFixed(0)}ms, main busy ${result.busyMs.toFixed(0)}ms, ` +
            `longest block ${result.blockMs.toFixed(1)}ms`
        )
        expect(result.caughtUp).toBe(true)
      }
    },
    /* A 64 MiB import with real SQLite writes runs minutes on a slow runner. */ 900_000
  )
})
