import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { describe, expect, it, vi } from 'vitest'
import { coreEventStream, coreProviderView } from '../src/pi-provider-bridge.ts'
import type { PiStreamPublicCompatibility, SimpleNativeProvider } from '../src/pi-provider-bridge.ts'

const publicTypesAgree: PiStreamPublicCompatibility = [true, true]

describe('published Core simple-stream compatibility view', () => {
  it('preserves the stream object rather than copying or replacing its private queue', () => {
    expect(publicTypesAgree).toEqual([true, true])
    const native = createAssistantMessageEventStream()
    expect(coreEventStream(native)).toBe(native)
  })
  it('passes the checked simple input through and rejects unsupported advanced entry without I/O', () => {
    const stream = createAssistantMessageEventStream()
    const simple = vi.fn(() => stream)
    const resolve = vi.fn(async () => undefined)
    const model = getBuiltinModels('github-copilot')[0]!
    const provider: SimpleNativeProvider = {
      id: 'fixture', name: 'Fixture', auth: { apiKey: { name: 'Fixture', resolve } },
      getModels: () => [model], streamSimple: simple,
    }
    const view = coreProviderView(provider)
    const context = { messages: [] }
    const options = { maxTokens: 24 }
    expect(view.streamSimple(model, context, options)).toBe(stream)
    expect(simple).toHaveBeenCalledWith(model, context, options)
    expect(() => view.stream(model, context)).toThrow('COPILOT_MANAGED_ADVANCED_STREAM_UNSUPPORTED')
    expect(simple).toHaveBeenCalledTimes(1)
    expect(resolve).not.toHaveBeenCalled()
  })
})
