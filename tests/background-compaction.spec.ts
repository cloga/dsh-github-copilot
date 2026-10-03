import { describe, expect, it, vi } from 'vitest'
import { BackgroundCompaction } from '../src/background-compaction.ts'
import type { JobHooks, JobSpec, JobView } from '@deepseek-ai/dsh-jobs'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

function fixture() {
  const jobs = new Map<string, { spec: JobSpec; hooks: JobHooks; view: JobView }>()
  let ordinal = 0
  const registry = {
    start: vi.fn((spec: JobSpec) => {
      const id = JobId(`copilot-compaction-${++ordinal}`)
      const hooks = spec.run({ id, append: vi.fn(), updateProgress: vi.fn() })
      const entry = { spec, hooks, view: { id, kind: spec.kind, owner: spec.owner, label: spec.label,
        status: 'running' as JobView['status'], startedAt: 0, output: { total: 0, earliest: 0 } } }
      jobs.set(id, entry)
      void hooks.done.then(outcome => { entry.view = { ...entry.view, ...outcome } })
      return id
    }),
    get: vi.fn((id: JobId, owner?: SessionId) => {
      const job = jobs.get(id)
      if (!job || job.spec.owner !== owner) throw new Error('foreign job')
      return job.view
    }),
    kill: vi.fn((id: JobId, owner?: SessionId) => {
      const job = jobs.get(id)
      if (!job || job.spec.owner !== owner) throw new Error('foreign job')
      job.hooks.cancel()
      return 'requested' as const
    }),
    wait: vi.fn(async (id: JobId, _timeout: number, owner?: SessionId) => {
      const job = jobs.get(id)
      if (!job || job.spec.owner !== owner) throw new Error('foreign job')
      await job.hooks.done
      return job.view
    }),
  }
  const compact = vi.fn((_agent: { id: SessionId }, signal: AbortSignal) =>
    new Promise<{ shadowedSeqs: SessionSeq[]; shadowedTokenCount: number } | null>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      finish = resolve
    }))
  let finish: (value: { shadowedSeqs: SessionSeq[]; shadowedTokenCount: number } | null) => void = () => {}
  const warn = vi.fn()
  const controller = new BackgroundCompaction(registry, compact, warn)
  const owner = { id: SessionId('owner') }
  return { controller, registry, compact, owner, jobs, warn, finish: () => finish({ shadowedSeqs: [SessionSeq(1), SessionSeq(2)], shadowedTokenCount: 50 }) }
}

describe('background manual compaction admission', () => {
  it('acknowledges before completion and outlives a five-minute caller deadline', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      const caller = new AbortController()
      const result = f.controller.execute(f.owner, '', caller.signal)
      expect(result).toMatchObject({ kind: 'success' })
      expect(result.text).toContain('started')
      expect(f.registry.wait).toHaveBeenCalledOnce()
      await Promise.resolve()
      caller.abort()
      await vi.advanceTimersByTimeAsync(360_000)
      expect(f.compact.mock.calls[0]![1].aborted).toBe(false)
      expect(f.controller.execute(f.owner, 'status', new AbortController().signal).text).toContain('running')
      f.finish()
      await f.controller.dispose()
      expect((await [...f.jobs.values()][0]!.hooks.done).status).toBe('completed')
    } finally { vi.useRealTimers() }
  })

  it('deduplicates per owner and never reads or cancels another owner job', async () => {
    const f = fixture()
    const signal = new AbortController().signal
    f.controller.execute(f.owner, '', signal)
    expect(f.controller.execute(f.owner, '', signal).text).toContain('already')
    expect(f.registry.start).toHaveBeenCalledOnce()
    expect(f.controller.execute({ id: SessionId('foreign') }, 'cancel', signal).kind).toBe('error')
    expect(f.registry.kill).not.toHaveBeenCalled()
    await f.controller.dispose()
  })

  it('cancels and drains producer work on explicit cancellation and teardown', async () => {
    const f = fixture()
    const signal = new AbortController().signal
    f.controller.execute(f.owner, '', signal)
    await Promise.resolve()
    expect(f.controller.execute(f.owner, 'cancel', signal).text).toContain('requested')
    await f.controller.dispose()
    expect((await [...f.jobs.values()][0]!.hooks.done).status).toBe('killed')
    expect(f.controller.execute(f.owner, '', signal).kind).toBe('error')
  })

  it('reports failed work without exposing raw provider bodies and allows a later explicit retry', async () => {
    const f = fixture()
    f.compact.mockRejectedValueOnce(new Error('secret raw provider body'))
    const signal = new AbortController().signal
    f.controller.execute(f.owner, '', signal)
    await [...f.jobs.values()][0]!.hooks.done
    const result = f.controller.execute(f.owner, 'status', signal)
    expect(result.text).toContain('failed')
    expect(result.text).not.toContain('secret')
    f.controller.execute(f.owner, '', signal)
    expect(f.registry.start).toHaveBeenCalledTimes(2)
    await f.controller.dispose()
  })

  it('rejects aborted admission and invalid arguments without starting work', async () => {
    const f = fixture()
    const abort = new AbortController()
    abort.abort()
    expect(f.controller.execute(f.owner, '', abort.signal).kind).toBe('error')
    expect(f.controller.execute(f.owner, 'status foreign-id', new AbortController().signal).kind).toBe('error')
    expect(f.registry.start).not.toHaveBeenCalled()
    await f.controller.dispose()
  })

  it('fails explicitly when admission is unavailable', async () => {
    const f = fixture()
    f.registry.start.mockImplementationOnce(() => { throw new Error('raw internal error') })
    const result = f.controller.execute(f.owner, '', new AbortController().signal)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('COPILOT_BACKGROUND_COMPACTION_ADMISSION_FAILED')
    expect(result.text).not.toContain('raw internal')
    expect(f.warn).toHaveBeenCalledWith('COPILOT_BACKGROUND_COMPACTION_ADMISSION_FAILED')
    expect(f.compact).not.toHaveBeenCalled()
    await f.controller.dispose()
  })

  it('cancels producer work if its settlement observer fails', async () => {
    const f = fixture()
    f.registry.wait.mockRejectedValueOnce(new Error('observer unavailable'))
    f.controller.execute(f.owner, '', new AbortController().signal)
    await [...f.jobs.values()][0]!.hooks.done
    expect(f.warn).toHaveBeenCalledWith('COPILOT_BACKGROUND_COMPACTION_OBSERVER_FAILED')
    expect(f.controller.execute(f.owner, 'status', new AbortController().signal).text).toContain('killed')
    await f.controller.dispose()
  })
})
