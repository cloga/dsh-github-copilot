import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import type { JobId, JobOutcome, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-jobs/view' {
  interface JobKindMap {
    'copilot-compaction': 'copilot-compaction'
  }
}

type Jobs = Pick<JobRegistry, 'start' | 'get' | 'wait' | 'kill'>
type Result = Pick<CompactionResult, 'shadowedSeqs' | 'shadowedTokenCount'> | null
interface Running {
  id: JobId
  cancel: AbortController
  done: Promise<JobOutcome>
}
const WAIT_MS = 2_147_483_647
const USAGE = 'Usage: /copilot-compact [status|cancel|visible-history]. visible-history authorizes one lossy summary without old encrypted reasoning or its embedded summaries; stored source history is unchanged.'
const FAILED = 'COPILOT_BACKGROUND_COMPACTION_FAILED: inspect the native compaction/end record; no success is implied.'

function failureDetail(cause: unknown): string {
  const allowed = new Set([
    'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH', 'COPILOT_RESPONSES_REPLAY_UNSUPPORTED',
    'COPILOT_RESPONSES_REPLAY_INVALID_PAYLOAD', 'CONTEXT_WINDOW_EXCEEDED',
    'COPILOT_MANUAL_RECOVERY_ACCOUNT_PROOF_UNAVAILABLE', 'COPILOT_MANUAL_RECOVERY_FIXED_PREFIX',
    'COPILOT_MANUAL_RECOVERY_INDIVISIBLE', 'COPILOT_MANUAL_RECOVERY_CALL_LIMIT',
    'COPILOT_MANUAL_RECOVERY_EMPTY_SUMMARY', 'COPILOT_MANUAL_RECOVERY_UNBALANCED',
    'COPILOT_COMPACTION_REPLAY_UNAVAILABLE', 'COPILOT_COMPACTION_REPLAY_REVOKED',
  ])
  const visited = new Set<Error>()
  for (let depth = 0; depth < 8 && cause instanceof Error && !visited.has(cause); depth++) {
    visited.add(cause)
    const code = /^[A-Z][A-Z_]+(?=:|$)/.exec(cause.message)?.[0]
    if (code && allowed.has(code)) {
      const guidance = code === 'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH'
        ? ' Review loss of hidden context before explicitly using /copilot-compact visible-history. No automatic retry.'
        : ''
      return `${code}: compaction failed; stored source history is unchanged.${guidance} Inspect the native compaction/end record.`
    }
    cause = cause.cause
  }
  return FAILED
}

/** Own only admission and job lifetime; the selected engine owns all history transactions. */
export class BackgroundCompaction<A extends { readonly id: SessionId }> {
  private readonly latest = new WeakMap<A, JobId>()
  private readonly active = new Map<A, Running>()
  private closed = false

  constructor(
    private readonly jobs: Jobs,
    private readonly compact: (agent: A, signal: AbortSignal, visibleHistory: boolean) => Promise<Result>,
    private readonly warn: (message: string) => void,
  ) {}

  execute(agent: A, rawInput: string, signal: AbortSignal): CommandResult {
    if (this.closed) return { kind: 'error', text: 'COPILOT_BACKGROUND_COMPACTION_DISPOSED' }
    if (signal.aborted) return { kind: 'error', text: 'Compaction admission cancelled.' }
    const action = rawInput.trim()
    if (action !== '' && action !== 'status' && action !== 'cancel' && action !== 'visible-history') return { kind: 'error', text: USAGE }
    const id = this.latest.get(agent)
    if (action === 'status' || action === 'cancel') {
      if (id === undefined) return { kind: 'error', text: 'No background compaction job for this Session.' }
      try {
        if (action === 'cancel') {
          return { kind: 'success', text: `${id}: cancellation ${this.jobs.kill(id, agent.id)}.` }
        }
        const job = this.jobs.get(id, agent.id)
        return { kind: 'success', text: `${id}: ${job.status}${job.detail ? `; ${job.detail}` : ''}` }
      } catch {
        return { kind: 'error', text: 'COPILOT_BACKGROUND_COMPACTION_JOB_UNAVAILABLE' }
      }
    }
    const existing = this.active.get(agent)
    if (existing !== undefined) return { kind: 'success', text: `${existing.id}: already running; use /copilot-compact status or cancel.` }
    const cancel = new AbortController()
    let done: Promise<JobOutcome> | undefined
    try {
      const jobId = this.jobs.start({
        kind: 'copilot-compaction', label: 'Manual Copilot context compaction', owner: agent.id,
        run: job => {
          job.updateProgress('Compacting context; the original history remains until native commit.')
          done = Promise.resolve().then(async (): Promise<JobOutcome> => {
            try {
              cancel.signal.throwIfAborted()
              const result = await this.compact(agent, cancel.signal, action === 'visible-history')
              return { status: 'completed', detail: result === null ? 'No compactable history.'
                : `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).` }
            } catch (cause) {
              if (cancel.signal.aborted) return { status: 'killed', detail: 'Compaction cancelled; inspect native history for its transaction outcome.' }
              const detail = failureDetail(cause)
              this.warn(detail)
              return { status: 'failed', detail }
            } finally { this.active.delete(agent) }
          })
          return { cancel: () => { cancel.abort() }, done }
        },
      })
      if (done === undefined) throw new Error('COPILOT_BACKGROUND_COMPACTION_STARTER_MISSING')
      this.active.set(agent, { id: jobId, cancel, done })
      this.latest.set(agent, jobId)
      // This human-facing controller collects settlement. Native job reporting
      // consequently marks it awaited instead of waking the model or its Goal.
      void this.jobs.wait(jobId, WAIT_MS, agent.id).then(view => {
        if (view.status === 'running' || view.status === 'stopping') {
          this.warn('COPILOT_BACKGROUND_COMPACTION_OBSERVER_EXPIRED')
          cancel.abort()
        }
      }, () => {
        this.warn('COPILOT_BACKGROUND_COMPACTION_OBSERVER_FAILED')
        cancel.abort()
      })
      return { kind: 'success', text: `${jobId}: background compaction started, not completed. Use /copilot-compact status or /copilot-compact cancel.` }
    } catch {
      cancel.abort()
      this.warn('COPILOT_BACKGROUND_COMPACTION_ADMISSION_FAILED')
      return { kind: 'error', text: 'COPILOT_BACKGROUND_COMPACTION_ADMISSION_FAILED: jobs and a live Session owner are required.' }
    }
  }

  async dispose(): Promise<void> {
    this.closed = true
    const work = [...this.active.values()]
    for (const entry of work) entry.cancel.abort()
    await Promise.all(work.map(entry => entry.done))
  }
}

export function installBackgroundCompaction(
  ctx: Context,
  compact: (agent: Agent, signal: AbortSignal, visibleHistory: boolean) => Promise<CompactionResult | null>,
): void {
  const controller = new BackgroundCompaction(ctx.jobs, compact, message => ctx.logger.warn(message))
  ctx.effect(function* () {
    yield () => controller.dispose()
    yield ctx.jobs.attachController('copilot-background-compaction')
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('dsh-github-copilot/background-compaction'),
      name: 'copilot-compact',
      description: 'Start background manual compaction, inspect status, or cancel',
      input: { hint: 'status | cancel | visible-history (explicit lossy recovery; omit for normal compaction)' },
      handler: invocation => controller.execute(invocation.agent, invocation.rawInput, invocation.signal),
    })
  }, 'Copilot background compaction')
}
