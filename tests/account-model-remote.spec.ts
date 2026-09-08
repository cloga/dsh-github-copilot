import { describe, expect, it } from 'vitest'
import contribution, { GitHubCopilotAuthorizationViewSchema } from '../src/remote.ts'

const base = { phase: 'signed-in', configured: true, writable: true, inFlight: false, notices: [] }
const catalog = { state: 'ready', models: [{ id: 'future-lab-r17', name: 'Future', api: 'openai-responses' }],
  rejected: [{ id: 'unsupported', code: 'UNSUPPORTED_ENDPOINTS' }], discoveredAt: 123 }

describe('account model discovery Remote contract', () => {
  it.each(['discoverModels', 'ensureModels'])('registers %s with the same strict safe authorization view codec', method => {
    const discovery = contribution.descriptors.find(item => item.method === method)
    expect(discovery).toMatchObject({ service: 'githubCopilotAuthorization', namespace: 'githubCopilot',
      invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict' } })
    expect(contribution.descriptors.filter(item => item.method === method)).toHaveLength(1)
    expect(GitHubCopilotAuthorizationViewSchema.parse({ ...base, accountModels: catalog })).toEqual({ ...base, accountModels: catalog })
  })
  it.each(['accountKey', 'apiKey', 'baseURL', 'snapshot', 'credential'])('rejects private or unrequested discovery field %s', field => {
    expect(GitHubCopilotAuthorizationViewSchema.safeParse({ ...base, accountModels: { ...catalog, [field]: 'private' } }).success).toBe(false)
  })
  it('rejects secret-bearing model entries and oversized model lists', () => {
    expect(GitHubCopilotAuthorizationViewSchema.safeParse({ ...base, accountModels: { ...catalog,
      models: [{ ...catalog.models[0], headers: { Authorization: 'private' } }],
    } }).success).toBe(false)
    expect(GitHubCopilotAuthorizationViewSchema.safeParse({ ...base, accountModels: { ...catalog,
      models: Array.from({ length: 513 }, () => catalog.models[0]),
    } }).success).toBe(false)
  })
  it('continues accepting older authorization responses without a discovered catalog', () => {
    expect(GitHubCopilotAuthorizationViewSchema.safeParse(base).success).toBe(true)
  })
})
