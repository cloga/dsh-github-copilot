/**
 * Tests for fail-closed DSH runtime compatibility validation.
 */

import { readFileSync } from 'node:fs'
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

  it('adds 0.1.6-alpha.2 without dropping earlier baselines or advancing development dependencies', () => {
    expect(DSH_COMPATIBILITY.release).toBe('0.1.6-alpha.2')
    expect(DSH_COMPATIBILITY.developmentRelease).toBe('0.1.2-rc.1')
    expect(DSH_COMPATIBILITY.supportedReleases).toEqual([
      '0.1.1-rc.2', '0.1.2-rc.1', '0.1.3-alpha.1', '0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.6-alpha.1', '0.1.6-alpha.2',
    ])
    expect(DSH_COMPATIBILITY.peerRange).toBe('0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.3-alpha.1 || 0.1.5-alpha.1 || 0.1.5-alpha.2 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2')
    expect(() => assertDshCompatibility(context({ authorization: {} })))
      .toThrow('authorization.describe')
    expect(() => assertDshCompatibility(context({ authorization: {} })))
      .toThrow('0.1.6-alpha.2')
  })

  it('declares exact alpha2 contract targets without claiming live or artifact validation', () => {
    const baseline = JSON.parse(readFileSync(new URL('../deployment-baseline.json', import.meta.url), 'utf8'))
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const current = baseline.supportedBaselines.dsh
    expect(current.baselines.map((entry: { release: string }) => entry.release)).toEqual(DSH_COMPATIBILITY.supportedReleases)
    expect(current).toMatchObject({ release: '0.1.6-alpha.2', tag: 'dsh-v0.1.6-alpha.2', commit: 'ddefc45fbc7f8e46dd73185e68295696d1297887' })
    expect(current.baselines.at(-1)).toMatchObject({
      release: current.release, tag: current.tag, commit: current.commit,
      source: 'https://github.com/deepseek-ai/deepseek-harness',
      strictRemoteCodecs: 'create-factories-with-legacy-schema-bridge',
      roleChildDescriptorVersion: 3, roleChildCacheVersion: 2,
      roleChildHistory: 'unknown-legacy-history-fail-closed',
      runtimeDependencies: 'public-resolution-and-unload',
      clientSessionContext: 'multiple-session-owner-isolation',
      evidenceScope: 'unchanged-tagged-source-target', standaloneNpmArtifacts: 'not-tested',
    })
    expect(current.baselines.at(-1).runtimeTests).toEqual(expect.arrayContaining([
      'tests/fixtures/alpha2-contracts-core.fixture.ts',
      'tests/fixtures/session-context-core.fixture.ts', 'tests/fixtures/remote-core.fixture.ts',
    ]))
    expect(baseline.evidence.peerRangeMeaning).toBe('package-admission-not-runtime-validation')
    expect(baseline.evidence.doesNotProve).toEqual(expect.arrayContaining(['live-discovery', 'live-model-transport', 'published-release', 'local-upgrade']))
    expect(baseline.package.version).toBe(pkg.version)
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(version).toBe('0.1.2-rc.1')
    }
    for (const name of current.packages) expect(pkg.peerDependencies[name]).toBe(DSH_COMPATIBILITY.peerRange)
    expect(pkg.engines.dsh).toBe(DSH_COMPATIBILITY.peerRange)
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
