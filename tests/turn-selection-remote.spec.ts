import { expect, it } from 'vitest'
import contribution from '../src/turn-selection-remote.ts'
it('requires native agent scope and lookup instead of exposing arbitrary session metadata', () => {
  expect(contribution.descriptors).toHaveLength(1)
  expect(contribution.descriptors[0]).toMatchObject({ scope: { context: 'agent', wire: 'agentId' },
    parameters: [{ source: 'lookup', lookup: 'agent',
      codec: { typeSymbol: '@deepseek-ai/dsh-session/types#SessionId' } }, { source: 'json' }] })
})
