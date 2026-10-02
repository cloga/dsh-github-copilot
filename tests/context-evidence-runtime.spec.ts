import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import { COPILOT_CONTEXT_EVIDENCE, ContextEvidenceSchema, installContextEvidence } from '../src/context-evidence.ts'
import { guardContextUsage } from '../src/context-usage-guard.ts'

describe('public native context integration', () => {
  it('registers a strict independent wire projection, cold-folds selection and disposes reversibly', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      const session = ctx.sessions.create()
      session.append('model/selection', { provider: 'github-copilot-preview', model: 'synthetic-model' })
      const fiber = ctx.plugin({ apply: installContextEvidence })
      await fiber
      const snapshot = ctx.sessionProjections.snapshot(session, [COPILOT_CONTEXT_EVIDENCE])
      expect(ContextEvidenceSchema.parse(snapshot.values[COPILOT_CONTEXT_EVIDENCE]).route)
        .toEqual({ provider: 'github-copilot-preview', model: 'synthetic-model' })
      session.append('model/selection', { provider: 'other', model: 'other' })
      expect(ctx.sessionProjections.stateOf(session, COPILOT_CONTEXT_EVIDENCE)?.route)
        .toEqual({ provider: 'other', model: 'other' })
      expect(ctx.sessionProjections.checkpoint(session)[COPILOT_CONTEXT_EVIDENCE]?.ver).toBe(1)
      await fiber.dispose()
      expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty(COPILOT_CONTEXT_EVIDENCE)
    } finally { await ctx.fiber.dispose() }
  })
  it('does not manufacture a settled native sample after guarded failure', async () => {
    const assembler = new BlockAssembler()
    const chunks: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'error', failure: { code: 'SYNTHETIC', message: 'synthetic' } } },
    ]
    for await (const chunk of guardContextUsage((async function* () { yield* chunks })())) assembler.push(chunk)
    expect(assembler.finish.kind).toBe('error')
    expect(assembler.usage).toBeUndefined()
  })
})
