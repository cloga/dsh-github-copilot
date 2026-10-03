import { describe, expect, it, vi } from 'vitest'
import { assessAutoTask, assessTaskLocally, assessmentInput, TaskAssessmentRevokedError } from '../src/auto-task-assessment.ts'

const message = (text: string, role = 'user') => ({ role, content: [{ type: 'text', text }] })
const signal = () => new AbortController().signal
describe('bounded contextual Auto task assessment', () => {
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
    expect(await assessAutoTask([message('Debug this failure')], { enabled: true, signal: signal(),
      classify: async () => '{"demand":"simple","signals":[]}', diagnostic: vi.fn() }))
      .toMatchObject({ source: 'local', demand: 'complex', diagnostic: 'invalid-result' })
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
