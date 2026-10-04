import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { strictRemoteCodec } from '../src/remote-codec.ts'
import remote from '../src/remote.ts'

describe('strict Remote factory compatibility', () => {
  it('preserves one strict parser for alpha.2 factories and legacy gateways', () => {
    const schema = z.object({ value: z.string() }).strict()
    const codec = strictRemoteCodec('fixture#Value', schema)
    expect(codec.create()).toBe(codec.schema)
    expect(codec.create()).toBe(codec.create())
    for (const parse of [codec.schema, codec.create()]) {
      expect(parse.parse({ value: 'ok' })).toEqual({ value: 'ok' })
      expect(() => parse.parse({ value: 1 })).toThrow()
      expect(() => parse.parse({ value: 'ok', credential: 'forbidden' })).toThrow()
    }
  })
  it('equips every handwritten strict parameter and result with a factory', () => {
    let checked = 0
    for (const descriptor of remote.descriptors) {
      const codecs = [descriptor.result, ...descriptor.parameters.map(value => value.codec),
        ...descriptor.invocation.kind === 'context' ? [descriptor.invocation.codec] : []]
      for (const codec of codecs) {
        expect(codec.mode).toBe('strict')
        const compatible = codec as ReturnType<typeof strictRemoteCodec>
        expect(compatible.create).toBeTypeOf('function')
        expect(compatible.create()).toBe(compatible.schema)
        checked++
      }
    }
    expect(checked).toBe(32)
  })
  it('keeps explicit replay recovery arguments and output strict', () => {
    const descriptors = remote.descriptors.filter(value => value.namespace === 'githubCopilotReplayRecovery')
    expect(descriptors.map(value => value.method)).toEqual(['get', 'setEnabled'])
    const write = descriptors[1]!
    expect(write.scope).toBeUndefined()
    expect(write.parameters[0]).toMatchObject({ source: 'lookup', lookup: 'agent', wire: 'agentId' })
    const revision = write.parameters[1]!.codec as ReturnType<typeof strictRemoteCodec>
    const enabled = write.parameters[2]!.codec as ReturnType<typeof strictRemoteCodec>
    expect(() => revision.create().parse('stale-not-a-uuid')).toThrow()
    expect(() => enabled.create().parse('true')).toThrow()
    const result = write.result as ReturnType<typeof strictRemoteCodec>
    expect(() => result.create().parse({ state: 'unavailable', encrypted_content: 'private' })).toThrow()
    expect(() => result.create().parse({ state: 'available', itemCount: 0,
      revision: '12345678-1234-4234-8234-123456789012', model: 'synthetic' })).toThrow()
  })
})
