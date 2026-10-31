import { describe, expect, it } from 'vitest'
import { HydraFusionEvidenceCollector } from '../src/hydrafusion-evidence.ts'

describe('Fusion stop and fallback ordering', () => {
  it.each([false, true])('keeps stopping after fallback until root idle (completed: %s)', completed => {
    const collector = new HydraFusionEvidenceCollector('synthetic-selection')
    collector.observe({
      type: 'session.fusion_route_started', ephemeral: true,
      data: { attemptId: 'attempt', syntheticModel: 'synthetic-selection' },
    })
    collector.requestStop()
    const fallback = collector.observe({
      type: 'session.fusion_route_failed',
      data: { attemptId: 'attempt', syntheticModel: 'synthetic-selection', fallbackModel: 'synthetic-fallback' },
    })
    expect(fallback).toMatchObject({ lifecycle: 'stopping', stopRequested: true })
    expect(fallback.outcome).toBeUndefined()
    if (completed) {
      collector.observe({
        type: 'session.fusion_resolved',
        data: { syntheticModel: 'synthetic-selection', fusionId: 'fusion', pattern: 'single' },
      })
      collector.observe({
        type: 'session.fusion_completed',
        data: {
          syntheticModel: 'synthetic-selection', fusionId: 'fusion', commitId: 'commit',
          finalSourceModel: 'synthetic-fallback', degradedReason: null, awaitingBackgroundWork: false,
        },
      })
    }
    expect(collector.observe({
      type: 'session.idle', agentId: 'child', ephemeral: true, data: { aborted: true },
    }).lifecycle).toBe('stopping')
    expect(collector.snapshot().outcome).toBeUndefined()
    expect(collector.observe({
      type: 'session.idle', ephemeral: true, data: { aborted: !completed },
    })).toMatchObject({
      lifecycle: 'idle', stopRequested: true,
      outcome: completed ? 'completed-with-fallback' : 'cancelled',
    })
  })

  it.each([undefined, null, 0, 'false', true])('does not infer background completion from %s', awaitingBackgroundWork => {
    const collector = new HydraFusionEvidenceCollector('synthetic-selection')
    collector.observe({
      type: 'session.fusion_resolved',
      data: { syntheticModel: 'synthetic-selection', fusionId: 'fusion', pattern: 'single' },
    })
    collector.observe({
      type: 'session.fusion_completed',
      data: {
        syntheticModel: 'synthetic-selection', fusionId: 'fusion', commitId: 'commit',
        finalSourceModel: 'synthetic-model', degradedReason: null,
        ...(awaitingBackgroundWork === undefined ? {} : { awaitingBackgroundWork }),
      },
    })
    const rootIdle = collector.observe({
      type: 'session.idle', ephemeral: true, data: {},
    })
    expect(rootIdle.lifecycle).toBe('stopping')
    expect(rootIdle.outcome).toBeUndefined()
    collector.observe({
      type: 'assistant.fusion_phase_started',
      data: { fusionId: 'fusion', phaseId: 'late-phase', phaseKind: 'repair', model: 'synthetic-model', role: 'repair' },
    })
    expect(collector.snapshot().phases.map(phase => phase.phaseId)).toEqual(['late-phase'])
    collector.observe({
      type: 'session.fusion_completed',
      data: {
        syntheticModel: 'synthetic-selection', fusionId: 'fusion', commitId: 'commit',
        finalSourceModel: 'synthetic-model', degradedReason: null, awaitingBackgroundWork: false,
      },
    })
    expect(collector.snapshot().lifecycle).not.toBe('idle')
    expect(collector.snapshot().outcome).toBeUndefined()
    expect(collector.observe({
      type: 'session.idle', ephemeral: true, data: {},
    })).toMatchObject({ lifecycle: 'idle', outcome: 'completed' })
  })

  it.each(['abort', 'error'])('does not discharge known background work from root %s evidence', terminal => {
    const collector = new HydraFusionEvidenceCollector('synthetic-selection')
    collector.observe({
      type: 'session.fusion_resolved',
      data: { syntheticModel: 'synthetic-selection', fusionId: 'fusion', pattern: 'single' },
    })
    collector.observe({
      type: 'session.fusion_completed',
      data: {
        syntheticModel: 'synthetic-selection', fusionId: 'fusion', commitId: 'commit',
        finalSourceModel: 'synthetic-model', degradedReason: null, awaitingBackgroundWork: true,
      },
    })
    if (terminal === 'error') collector.observe({ type: 'session.error', data: {} })
    const rootIdle = collector.observe({
      type: 'session.idle', ephemeral: true, data: { aborted: terminal === 'abort' },
    })
    expect(rootIdle.lifecycle).toBe('stopping')
    expect(rootIdle.outcome).toBeUndefined()
    expect(collector.requestStop()).toMatchObject({ lifecycle: 'stopping', stopRequested: true })
  })
})
