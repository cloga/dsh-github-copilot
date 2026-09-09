/**
 * Tests for fail-closed DSH runtime compatibility validation.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { assertDshCompatibility, DSH_COMPATIBILITY } from '../src/compatibility.ts'

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
    settings: { get: () => undefined, describe: () => [], mutate: async () => undefined, installSection: () => undefined },
    web: { registerSearchProvider: () => undefined },
    ...overrides,
  }
  return {
    get: (key: string) => services[key],
    on: () => undefined,
    effect: () => () => undefined,
    plugin: () => undefined,
    systemPrompt: { section: () => undefined },
  } as unknown as Context
}

describe('assertDshCompatibility', () => {
  it('retains the original three compatibility baselines', () => {
    expect(DSH_COMPATIBILITY.supportedReleases.slice(0, 3)).toEqual([
      '0.1.1-rc.2', '0.1.2-rc.1', '0.1.3-alpha.1',
    ])
  })

  it('adds official 0.1.5-alpha.1 without dropping earlier baselines or advancing development dependencies', () => {
    expect(DSH_COMPATIBILITY.release).toBe('0.1.5-alpha.1')
    expect(DSH_COMPATIBILITY.developmentRelease).toBe('0.1.2-rc.1')
    expect(DSH_COMPATIBILITY.supportedReleases).toEqual([
      '0.1.1-rc.2', '0.1.2-rc.1', '0.1.3-alpha.1', '0.1.5-alpha.1',
    ])
    expect(DSH_COMPATIBILITY.peerRange).toBe('0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.3-alpha.1 || 0.1.5-alpha.1')
    expect(() => assertDshCompatibility(context({ authorization: {} })))
      .toThrow('authorization.describe')
    expect(() => assertDshCompatibility(context({ authorization: {} })))
      .toThrow('0.1.5-alpha.1')
  })

  it('accepts the supported DSH service contract', () => {
    expect(() => assertDshCompatibility(context())).not.toThrow()
  })

  it('fails before startup when a required API is absent', () => {
    expect(() => assertDshCompatibility(context({ agentDefaultModel: {} })))
      .toThrow('agentDefaultModel.currentSelection')
    expect(() => assertDshCompatibility(context({ credentials: {} })))
      .toThrow('credentials.describeRecord')
    expect(() => assertDshCompatibility(context({ settings: { get: () => undefined, mutate: async () => undefined } })))
      .toThrow('settings.describe')
    expect(() => assertDshCompatibility(context({ web: {} })))
      .toThrow('web.registerSearchProvider')
  })
})
