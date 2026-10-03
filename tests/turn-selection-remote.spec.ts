import { expect, it } from 'vitest'
import contribution from '../src/turn-selection-remote.ts'
it('requires native Host agent lookup without shortening explicit Client arguments', () => {
  expect(contribution.descriptors).toHaveLength(1)
  expect(contribution.descriptors[0]).not.toHaveProperty('scope')
  expect(contribution.descriptors[0]).toMatchObject({ invocation: { kind: 'direct' },
    parameters: [{ source: 'lookup', lookup: 'agent',
      codec: { typeSymbol: '@deepseek-ai/dsh-session/types#SessionId' } }, { source: 'json' }] })
})
