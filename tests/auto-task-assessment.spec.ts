import { describe, expect, it, vi } from 'vitest'
import { assessAutoTask, assessTaskLocally, assessmentInput, TaskAssessmentRevokedError } from '../src/auto-task-assessment.ts'

const message = (text: string, role = 'user') => ({ role, content: [{ type: 'text', text }] })
const signal = () => new AbortController().signal
describe('bounded contextual Auto task assessment', () => {
  it('allows a response after the old eight-second budget under the new bounded default', async () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const result = await assessAutoTask([message('Continue')], {
        enabled: true, signal: signal(), diagnostic: vi.fn(),
        classify: async () => {
          now = 9000
          return '{"demand":"routine","signals":[]}'
        },
      })
      expect(result).toMatchObject({ demand: 'routine', source: 'semantic',
        semantic: { budgetMs: 30000, elapsedMs: 9000, validation: 'valid' } })
    } finally { clock.mockRestore() }
  })
  it('still rejects a result at the new default deadline without relying on timer delivery', async () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const result = await assessAutoTask([message('Continue')], {
        enabled: true, signal: signal(), diagnostic: vi.fn(),
        classify: async () => {
          now = 30000
          return '{"demand":"routine","signals":[]}'
        },
      })
      expect(result).toMatchObject({ demand: 'unknown', diagnostic: 'timeout',
        semantic: { budgetMs: 30000, validation: 'not-validated' } })
    } finally { clock.mockRestore() }
  })
  it('rejects late results even before the scheduled timeout callback runs', async () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const diagnostic = vi.fn()
    try {
      const result = await assessAutoTask([message('Continue')], {
        enabled: true, signal: signal(), timeoutMs: 8000, diagnostic,
        classify: async () => {
          now = 9000
          return '{"demand":"simple","signals":[]}'
        },
      })
      expect(result).toMatchObject({ demand: 'unknown', diagnostic: 'timeout',
        semantic: { elapsedMs: 9000, validation: 'not-validated' } })
      expect(diagnostic).toHaveBeenCalledWith('COPILOT_AUTO_ASSESSMENT_TIMEOUT')
    } finally { clock.mockRestore() }
  })
  it('aborts preparation at the monotonic deadline before an adapter can start', async () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const adapter = vi.fn()
    try {
      const result = await assessAutoTask([message('Continue')], {
        enabled: true, signal: signal(), timeoutMs: 8000, diagnostic: vi.fn(),
        classify: async (_input, signal, observe, checkpoint) => {
          observe?.({ stage: 'model-selected', modelId: 'fixture' })
          now = 8000
          checkpoint?.()
          expect(signal.aborted).toBe(true)
          adapter()
          return '{}'
        },
      })
      expect(adapter).not.toHaveBeenCalled()
      expect(result).toMatchObject({ demand: 'unknown', diagnostic: 'timeout',
        semantic: { stage: 'model-selected', validation: 'not-validated' } })
    } finally { clock.mockRestore() }
  })
  it('disposes the owned timer after success and ignores post-settlement observations', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    let observeLate: import('../src/auto-assessment-evidence.ts').TaskClassifierObserver | undefined
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const result = await assessAutoTask([message('Continue')], {
        enabled: true, signal: signal(), diagnostic: vi.fn(),
        classify: async (_input, _signal, observe) => {
          observeLate = observe
          return '{"demand":"complex","signals":[]}'
        },
      })
      expect(clear).toHaveBeenCalledOnce()
      const snapshot = JSON.stringify(result)
      now = 9000
      expect(() => observeLate?.({ stage: 'adapter-started' })).not.toThrow()
      expect(JSON.stringify(result)).toBe(snapshot)
    } finally { clear.mockRestore(); clock.mockRestore() }
  })
  it('captures bounded phase evidence for a timed-out partial result without treating it as a validated task', async () => {
    const result = await assessAutoTask([message('Continue')], {
      enabled: true, signal: signal(), timeoutMs: 20, diagnostic: vi.fn(),
      classify: async (_input, _signal, observe) => {
        observe?.({ stage: 'model-selected', modelId: 'synthetic-classifier' })
        observe?.({ stage: 'adapter-started' })
        observe?.({ stage: 'text', characters: 5 })
        return await new Promise<string>(() => {})
      },
    })
    expect(result).toMatchObject({ demand: 'unknown', diagnostic: 'timeout',
      semantic: { modelId: 'synthetic-classifier', stage: 'text-received', outputCharacters: 5,
        budgetMs: 20, validation: 'not-validated' } })
    expect(result.semantic?.firstTextMs).toBeGreaterThanOrEqual(0)
    expect(result.semantic?.elapsedMs).toBeGreaterThanOrEqual(result.semantic!.firstTextMs!)
    expect(Object.isFrozen(result.semantic)).toBe(true)
  })
  it.each(['valid', 'invalid', 'context-omitted'] as const)('captures native completion separately from result acceptance: %s', async validation => {
    const output = validation === 'invalid' ? 'PRIVATE_INVALID'
      : '{"demand":"routine","signals":["bounded-transformation"]}'
    const result = await assessAutoTask([message(validation === 'context-omitted' ? 'x'.repeat(2000) : 'Convert this.')], {
      enabled: true, signal: signal(), diagnostic: vi.fn(),
      classify: async (_input, _signal, observe) => {
        observe?.({ stage: 'model-selected', modelId: 'fixture' })
        observe?.({ stage: 'adapter-started' })
        observe?.({ stage: 'text', characters: output.length })
        observe?.({ stage: 'finished', stopped: true })
        return output
      },
    })
    expect(result.semantic).toMatchObject({ stage: 'finished', nativeFinish: 'stop', validation })
    expect(JSON.stringify(result.semantic)).not.toContain('PRIVATE_INVALID')
    expect(result.demand).toBe(validation === 'valid' ? 'routine' : 'unknown')
  })
  it('preserves the frozen timeout snapshot when an uncooperative classifier reports late output', async () => {
    let observeLate: Parameters<NonNullable<import('../src/auto-task-assessment.ts').TaskAssessmentDependencies['classify']>>[2]
    let resolve!: (text: string) => void
    const result = await assessAutoTask([message('Continue')], {
      enabled: true, signal: signal(), timeoutMs: 10, diagnostic: vi.fn(),
      classify: (_input, _signal, observe) => {
        observeLate = observe
        return new Promise<string>(done => { resolve = done })
      },
    })
    const snapshot = JSON.stringify(result)
    observeLate?.({ stage: 'adapter-started' })
    observeLate?.({ stage: 'text', characters: 30 })
    resolve('{"demand":"simple","signals":[]}')
    await Promise.resolve()
    expect(JSON.stringify(result)).toBe(snapshot)
    expect(result.semantic).toMatchObject({ stage: 'preparing', validation: 'not-validated' })
  })
  it('recognizes isolated multilingual greetings but not greetings during ongoing work', () => {
    for (const text of ['hello', '你好！']) expect(assessTaskLocally([message(text)])).toMatchObject({ demand: 'simple' })
    expect(assessTaskLocally([message('Investigating an unresolved failure.', 'assistant'), message('hello')]))
      .toMatchObject({ demand: 'unknown', signals: ['continuation', 'insufficient-evidence'] })
  })
  it('does not mistake short hard tasks or continuation for easy work', () => {
    expect(assessTaskLocally([message('Prove this theorem.')])).toMatchObject({ demand: 'complex' })
    expect(assessTaskLocally([message('继续')])).toMatchObject({ demand: 'unknown' })
    expect(assessTaskLocally([message('Prove it.'), message('Investigating', 'assistant'), message('Debug it.')]))
      .toMatchObject({ demand: 'complex' })
    expect(assessTaskLocally([message('Build a solver.'), message('Hello!')])).toMatchObject({ demand: 'unknown' })
  })
  it('does not mistake model-selection notices or system framing for task evidence', () => {
    const notice = { ...message('model changed: old to new'), source: { kind: 'model-selection' } }
    const history = [message('private system framing', 'system'), message('Hello!'), notice]
    expect(assessTaskLocally(history)).toMatchObject({ demand: 'simple' })
    expect(assessmentInput(history).text).not.toContain('private system framing')
    expect(assessmentInput(history).text).not.toContain('model changed')
    expect(assessmentInput(history).text).toContain('Hello!')
  })
  it('allows semantic recognition of long mechanical work without a length-based complexity claim', async () => {
    const classify = vi.fn(async () => JSON.stringify({ demand: 'routine', signals: ['bounded-transformation'] }))
    const result = await assessAutoTask([message('Convert these values to CSV. '.repeat(35))],
      { enabled: true, signal: signal(), classify, diagnostic: vi.fn() })
    expect(result).toMatchObject({ source: 'semantic', demand: 'routine' })
    expect(classify).toHaveBeenCalledOnce()
  })
  it('uses local greetings without extra inference and disabled assessment explicitly', async () => {
    const classify = vi.fn()
    expect(await assessAutoTask([message('hello')], { enabled: true, signal: signal(), classify, diagnostic: vi.fn() }))
      .toMatchObject({ source: 'local', demand: 'simple' })
    expect(classify).not.toHaveBeenCalled()
    expect(await assessAutoTask([message('Do something')], { enabled: false, signal: signal(), diagnostic: vi.fn() }))
      .toMatchObject({ source: 'local', demand: 'unknown', diagnostic: 'disabled' })
  })
  it.each(['not-json', '{"demand":"simple","signals":[],"model":"invented"}', 'x'.repeat(2049)])(
    'discloses invalid results and never retries', async output => {
      const classify = vi.fn(async () => output), diagnostic = vi.fn()
      expect(await assessAutoTask([message('Continue')], { enabled: true, signal: signal(), classify, diagnostic }))
        .toMatchObject({ diagnostic: 'invalid-result', demand: 'unknown' })
      expect(classify).toHaveBeenCalledOnce()
      expect(diagnostic).toHaveBeenCalledWith('COPILOT_AUTO_ASSESSMENT_INVALID_RESULT')
    })
  it('does not let a classifier downgrade explicit investigation evidence', async () => {
    const classify = vi.fn(async () => '{"demand":"simple","signals":[]}')
    expect(await assessAutoTask([message('Debug this failure')], { enabled: true, signal: signal(),
      classify, diagnostic: vi.fn() }))
      .toMatchObject({ source: 'local', demand: 'complex' })
    expect(classify).not.toHaveBeenCalled()
  })
  it('inherits difficult-task evidence only through explicit bounded continuations', () => {
    const history = [message('Investigate the failing build.'), message('Need to inspect the logs.', 'assistant')]
    expect(assessTaskLocally([...history, message('继续')]))
      .toMatchObject({ demand: 'complex', signals: ['continuation', 'reasoning', 'investigation'] })
    expect(assessTaskLocally([...history, message('继续'), message('Next step.', 'assistant'), message('好的')]))
      .toMatchObject({ demand: 'complex' })
    expect(assessTaskLocally([...history, message('Write a birthday greeting.')])).toMatchObject({ demand: 'unknown' })
    expect(assessTaskLocally([...history, message('A new task.'), message('继续')])).toMatchObject({ demand: 'unknown' })
    expect(assessTaskLocally([message('Continue')])).toMatchObject({ demand: 'unknown' })
    expect(assessTaskLocally([message('Investigate the build.'), ...Array.from({ length: 13 }, () => message('Continue'))]))
      .toMatchObject({ demand: 'unknown' })
  })
  it('recognizes only isolated explicit fenced mechanical transformations as routine', async () => {
    const classify = vi.fn()
    for (const instruction of ['Convert the following JSON to CSV:', 'Sort the following lines:', '将以下 JSON 转换为 CSV：']) {
      const current = message(`${instruction}\n\`\`\`\n{"a":1}\n\`\`\``)
      expect(await assessAutoTask([current], { enabled: true, signal: signal(), classify, diagnostic: vi.fn() }))
        .toMatchObject({ demand: 'routine', signals: ['bounded-transformation'] })
      expect(assessTaskLocally([message('Unresolved work.', 'assistant'), current])).toMatchObject({ demand: 'unknown' })
    }
    expect(classify).not.toHaveBeenCalled()
    expect(assessTaskLocally([message('Sort the following lines:\r\n```text\r\nb\r\na\r\n```')]))
      .toMatchObject({ demand: 'routine' })
    for (const current of ['Convert it to CSV.', 'Translate this file.', 'Sort the following lines:\n```\na\n```\nThen deploy it.',
      'Sort the following lines:\n```\na\n```\n```\nb\n```',
      'Sort the following lines:\n```\n' + 'x'.repeat(2000) + '\n```']) {
      expect(assessTaskLocally([message(current)])).toMatchObject({ demand: 'unknown' })
    }
    const image = { type: 'image', get attachment() { throw new Error('READ_ATTACHMENT') } }
    expect(assessTaskLocally([{ role: 'user', content: [{ type: 'text', text: 'Sort the following lines:\n```\na\n```' }, image] }]))
      .toMatchObject({ demand: 'unknown' })
  })
  it('preserves valid bounded rows and prioritizes the current user and nearest task over verbose output', () => {
    const history = [message('Investigate the build.'), ...Array.from({ length: 15 }, () => message('x'.repeat(1700), 'tool')),
      message('Current request: continue the build investigation.')]
    const input = assessmentInput(history)
    expect(input.omitted).toBe(true)
    expect(input.text.length).toBeLessThanOrEqual(8000)
    const rows = input.text.split('\n').map(row => JSON.parse(row))
    expect(rows.at(-1).text).toBe('Current request: continue the build investigation.')
    expect(rows[0].text).toBe('Investigate the build.')
    expect(rows.length).toBeLessThanOrEqual(12)
    expect(assessmentInput(history)).toEqual(input)
    const escaped = assessmentInput([message('"\n\\'.repeat(600)), message('Continue')])
    expect(escaped.text.length).toBeLessThanOrEqual(8000)
    expect(() => escaped.text.split('\n').forEach(row => JSON.parse(row))).not.toThrow()
    const expanded = assessmentInput([message('\u0001'.repeat(1600))])
    expect(expanded.omitted).toBe(true)
    expect(expanded.text.length).toBeLessThanOrEqual(8000)
    expect(JSON.parse(expanded.text).role).toBe('user')
  })
  it('bounds context, never reads attachment/reasoning bodies, and does not downshift omitted context', async () => {
    const image = { type: 'image', get attachment() { throw new Error('READ_ATTACHMENT') } }
    const history = [message('x'.repeat(9000)), { role: 'user', content: [image] }, message('Continue')]
    const input = assessmentInput(history)
    expect(input.omitted).toBe(true)
    expect(input.text.length).toBeLessThanOrEqual(8000)
    expect(await assessAutoTask(history, { enabled: true, signal: signal(),
      classify: async () => '{"demand":"routine","signals":[]}', diagnostic: vi.fn() }))
      .toMatchObject({ demand: 'unknown', diagnostic: 'context-omitted' })
  })
  it('bounds stalled classification without requiring the classifier to cooperate', async () => {
    const classify = vi.fn(() => new Promise<string>(() => {}))
    expect(await assessAutoTask([message('Continue')], { enabled: true, signal: signal(),
      classify, diagnostic: vi.fn(), timeoutMs: 10 })).toMatchObject({ diagnostic: 'timeout' })
    expect(classify).toHaveBeenCalledOnce()
  })
  it('preserves caller cancellation instead of using a success-shaped fallback', async () => {
    const controller = new AbortController(), reason = new Error('cancelled')
    const result = assessAutoTask([message('Continue')], { enabled: true, signal: controller.signal,
      classify: () => new Promise<string>(() => {}), diagnostic: vi.fn() })
    controller.abort(reason)
    await expect(result).rejects.toBe(reason)
  })
  it('preserves revoked account evidence as fatal rather than classifier fallback', async () => {
    const cause = new Error('synthetic-account-revoked'), diagnostic = vi.fn()
    await expect(assessAutoTask([message('Continue')], { enabled: true, signal: signal(),
      classify: async () => { throw new TaskAssessmentRevokedError(cause) }, diagnostic })).rejects.toBe(cause)
    expect(diagnostic).not.toHaveBeenCalled()
  })
})
