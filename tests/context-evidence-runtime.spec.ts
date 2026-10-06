import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { BlockAssembler, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import { COPILOT_CONTEXT_EVIDENCE, ContextEvidenceSchema, installContextEvidence } from '../src/context-evidence.ts'

describe('public native context integration', () => {
  it('cold-folds real public checkpoint and same-step ordinary settlement without inferring occupancy', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      const session = ctx.sessions.create()
      const route = { provider: 'github-copilot-preview', model: 'synthetic-model' }
      session.append('request/header', { header: { config: route }, reason: 'initial' })
      const input = session.append('user/message', createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic input' }],
      }), { surfaceOp: 'append' })
      const compactionId = CompactionId('synthetic-compact')
      session.append('compaction/start', { compactionId, turn: null })
      session.append('compaction/summary', { compactionId, provider: route.provider, model: route.model,
        summary: [{ type: 'text', text: 'Synthetic summary' }], shadowedSeqs: [input.seq],
        shadowedRange: { start: input.seq, end: input.seq }, shadowedTokenCount: 10 })
      session.append('user/message', createUserMessage({ source: compactCheckpointSource(compactionId),
        content: [{ type: 'text', text: 'Synthetic summary' }] }),
      { surfaceOp: { op: 'replace', startSeq: input.seq, endSeq: input.seq }, sourceEventSeqs: [input.seq] })
      session.append('compaction/end', { compactionId, turn: null })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('assistant/message', { turn: 1, step: 1,
        message: createAssistantMessage({ source: route, content: [{ type: 'text', text: 'Synthetic reply' }] }),
        stream: [{ type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } }] }, { surfaceOp: 'append' })
      await ctx.plugin({ apply: installContextEvidence })
      const state = ctx.sessionProjections.stateOf(session, COPILOT_CONTEXT_EVIDENCE)
      expect(state?.compaction).toMatchObject({ state: 'completed', request: 'succeeded' })
      expect(state?.sample).toBeNull()
      expect(state?.invalid).toBe(true)
    } finally { await ctx.fiber.dispose() }
  })
  it('registers a strict independent wire projection, cold-folds request routing and disposes reversibly', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      const session = ctx.sessions.create()
      session.append('request/header', {
        header: { config: { provider: 'github-copilot-preview', model: 'synthetic-model' } }, reason: 'initial',
      })
      const fiber = ctx.plugin({ apply: installContextEvidence })
      await fiber
      const snapshot = ctx.sessionProjections.snapshot(session, [COPILOT_CONTEXT_EVIDENCE])
      expect(ContextEvidenceSchema.parse(snapshot.values[COPILOT_CONTEXT_EVIDENCE]).route)
        .toEqual({ provider: 'github-copilot-preview', model: 'synthetic-model' })
      session.append('request/header', {
        header: { config: { provider: 'other', model: 'other' } }, reason: 'change',
      })
      expect(ctx.sessionProjections.stateOf(session, COPILOT_CONTEXT_EVIDENCE)?.route)
        .toEqual({ provider: 'other', model: 'other' })
      expect(ctx.sessionProjections.checkpoint(session)[COPILOT_CONTEXT_EVIDENCE]?.ver).toBe(2)
      await fiber.dispose()
      expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty(COPILOT_CONTEXT_EVIDENCE)
    } finally { await ctx.fiber.dispose() }
  })
  it('keeps native failed zero accounting separate from historical evidence', () => {
    const assembler = new BlockAssembler()
    const chunks: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'error', failure: { code: 'SYNTHETIC', message: 'synthetic' } } },
    ]
    for (const chunk of chunks) assembler.push(chunk)
    expect(assembler.finish.kind).toBe('error')
    expect(assembler.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})
