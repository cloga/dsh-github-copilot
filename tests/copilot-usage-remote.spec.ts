import { describe, expect, it } from 'vitest'
import contribution, { CopilotUsageViewSchema } from '../src/copilot-usage-remote.ts'

describe('Copilot quota strict Remote', () => {
  const ready = { state: 'ready', billing: 'credits', budget: 'individual',
    used: 25, remaining: 75, limit: 100, percentUsed: 25, observedAt: 1_800_000_000_000 }
  it('accepts only bounded canonical or opaque account provenance', () => {
    for (const accountId of ['canonical', '11111111-1111-4111-8111-111111111111']) {
      expect(CopilotUsageViewSchema.parse({ ...ready, accountId })).toEqual({ ...ready, accountId })
    }
    for (const accountId of ['', 'alice', 'github-copilot/account-secret', 'x'.repeat(37)]) {
      expect(CopilotUsageViewSchema.safeParse({ ...ready, accountId }).success).toBe(false)
    }
  })
  it('uses a separate no-argument namespace and shared strict codec on both supported gateways', () => {
    expect(contribution.descriptors.map(value => value.method)).toEqual(
      ['get', 'refresh', 'getNative', 'refreshNative', 'ensureNativeIdentity', 'refreshNativeIdentity'])
    for (const descriptor of contribution.descriptors) {
      expect(descriptor).toMatchObject({ namespace: 'githubCopilotUsage', service: 'githubCopilotUsage', parameters: [] })
      expect(descriptor.result).toMatchObject({ mode: 'strict', schema: CopilotUsageViewSchema })
      expect(Reflect.get(descriptor.result, 'create')()).toBe(CopilotUsageViewSchema)
    }
    expect(CopilotUsageViewSchema.parse(ready)).toEqual(ready)
  })
  it('accepts a bounded native identity only with canonical quota evidence', () => {
    const identity = { login: 'native-user', userId: 123 }
    expect(CopilotUsageViewSchema.parse({ ...ready, accountId: 'canonical', identity })).toMatchObject({ identity })
    expect(CopilotUsageViewSchema.safeParse({ ...ready, accountId: '11111111-1111-4111-8111-111111111111', identity }).success).toBe(false)
    expect(CopilotUsageViewSchema.safeParse({ ...ready, identity }).success).toBe(false)
    expect(CopilotUsageViewSchema.safeParse({ ...ready, accountId: 'canonical', identity: { ...identity, access: 'secret' } }).success).toBe(false)
  })
  it.each([
    { access: 'secret' }, { user: 'private-id' }, { diagnostic: 'raw server error' },
    { used: Infinity }, { limit: -1 }, { percentUsed: 101 }, { remaining: 200 },
    { used: 26 }, { budget: 'pooled' }, { state: 'signed-out' }, { observedAt: -1 },
  ])('rejects secrets, invalid amounts and contradictory views %j', extra => {
    expect(CopilotUsageViewSchema.safeParse({ ...ready, ...extra }).success).toBe(false)
  })
})
