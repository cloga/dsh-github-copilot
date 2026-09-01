/**
 * Tests for fail-closed DSH runtime compatibility validation.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { assertDshCompatibility } from '../src/compatibility.ts'

function context(overrides: Record<string, unknown> = {}): Context {
  const services: Record<string, unknown> = {
    agentDefaultModel: { currentSelection: () => undefined },
    authorization: { describe: () => undefined, begin: async () => undefined, cancel: () => undefined },
    credentials: {
      describeRecord: async () => ({ configured: false, writable: true }),
      readRecord: async () => undefined,
      listRecords: async () => [],
      modifyRecord: async () => undefined,
      deleteRecord: async () => undefined,
    },
    settings: { get: () => undefined, mutate: async () => undefined, installSection: () => undefined },
    web: { registerSearchProvider: () => undefined },
    ...overrides,
  }
  return {
    get: (key: string) => services[key],
    on: () => undefined,
    plugin: () => undefined,
    systemPrompt: { section: () => undefined },
  } as unknown as Context
}

describe('assertDshCompatibility', () => {
  it('accepts the supported DSH service contract', () => {
    expect(() => assertDshCompatibility(context())).not.toThrow()
  })

  it('fails before startup when a required API is absent', () => {
    expect(() => assertDshCompatibility(context({ agentDefaultModel: {} })))
      .toThrow('agentDefaultModel.currentSelection')
    expect(() => assertDshCompatibility(context({ credentials: {} })))
      .toThrow('credentials.describeRecord')
    expect(() => assertDshCompatibility(context({ web: {} })))
      .toThrow('web.registerSearchProvider')
  })
})
