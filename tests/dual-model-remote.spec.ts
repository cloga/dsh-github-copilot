import { describe, expect, it } from 'vitest'
import contribution, {
  DualModelCreateSchema, DualModelSaveSchema, DualModelViewSchema,
} from '../src/dual-model-remote.ts'

describe('dual-model Remote boundary', () => {
  const configuration = { enabled: true, plannerModel: 'planner-from-account', executorModel: 'executor-from-account' }
  it('owns a separate strict namespace without changing authorization descriptors', () => {
    expect(contribution.package).toBe('dsh-github-copilot')
    expect(contribution.descriptors.map(value => value.method)).toEqual(['view', 'save', 'create'])
    for (const descriptor of contribution.descriptors) {
      expect(descriptor.namespace).toBe('githubCopilotDualModel')
      expect(descriptor.service).toBe('githubCopilotDualModel')
      expect(descriptor.result.mode).toBe('strict')
      expect(descriptor.parameters.every(parameter => parameter.codec.mode === 'strict')).toBe(true)
    }
  })
  it('requires a revision, bounds ids and rejects global/default/provider overrides', () => {
    expect(DualModelSaveSchema.parse({ configuration, expectedRevision: 0 })).toEqual({ configuration, expectedRevision: 0 })
    expect(DualModelSaveSchema.safeParse({ configuration }).success).toBe(false)
    expect(DualModelSaveSchema.safeParse({ configuration, expectedRevision: -1 }).success).toBe(false)
    expect(DualModelSaveSchema.safeParse({ configuration: { ...configuration, provider: 'other' }, expectedRevision: 0 }).success).toBe(false)
    expect(DualModelSaveSchema.safeParse({ configuration, expectedRevision: 0, globalDefault: true }).success).toBe(false)
    expect(DualModelSaveSchema.safeParse({ configuration: { ...configuration, plannerModel: 'x'.repeat(513) }, expectedRevision: 0 }).success).toBe(false)
  })
  it('keeps an immutable request identity and rejects arbitrary cwd/session/model input', () => {
    const request = { requestId: '993601ac-140a-4fe5-a841-80fc14d249f9', workspaceId: 'workspace-one', expectedRevision: 3 }
    expect(DualModelCreateSchema.parse(request)).toEqual(request)
    for (const extra of [{ cwd: '/tmp' }, { sessionId: 'existing' }, { plannerModel: 'other' }]) {
      expect(DualModelCreateSchema.safeParse({ ...request, ...extra }).success).toBe(false)
    }
    expect(DualModelCreateSchema.safeParse({ ...request, requestId: '../bad' }).success).toBe(false)
  })
  it('accepts unavailable and disabled states, but never leaks credentials or arbitrary diagnostics', () => {
    const view = { supported: false, writable: false, revision: null,
      diagnostic: 'DUAL_MODEL_UNSUPPORTED', configuration: { enabled: false, plannerModel: '', executorModel: '' }, models: [], workspaces: [] }
    expect(DualModelViewSchema.parse(view)).toEqual(view)
    expect(DualModelViewSchema.safeParse({ ...view, accessToken: 'not-a-real-token' }).success).toBe(false)
    expect(DualModelViewSchema.safeParse({ ...view, models: [{ id: 'm', name: 'Model', auth: 'secret' }] }).success).toBe(false)
  })
})
