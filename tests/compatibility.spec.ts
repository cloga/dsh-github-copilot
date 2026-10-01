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
    settings: { get: () => undefined, describe: () => [], mutate: async () => undefined },
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
  it('admits only the exact current official release', () => {
    expect(DSH_COMPATIBILITY.release).toBe('0.2.0-rc.2')
    expect(DSH_COMPATIBILITY.developmentRelease).toBe('0.2.0-rc.2')
    expect(DSH_COMPATIBILITY.supportedReleases).toEqual(['0.2.0-rc.2'])
    expect(DSH_COMPATIBILITY.peerRange).toBe('0.2.0-rc.2')
    expect(() => assertDshCompatibility(context({ authorization: {} })))
      .toThrow('authorization.describe')
    expect(() => assertDshCompatibility(context({ authorization: {} })))
      .toThrow('0.2.0-rc.2')
  })

  it('declares the current and retained exact contract targets without claiming live Desktop validation', () => {
    const baseline = JSON.parse(readFileSync(new URL('../deployment-baseline.json', import.meta.url), 'utf8'))
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const current = baseline.supportedBaselines.dsh
    expect(current.admittedReleases).toEqual(DSH_COMPATIBILITY.supportedReleases)
    expect(current.baselines).toHaveLength(11)
    expect(current).toMatchObject({ release: '0.2.0-rc.2', tag: 'dsh-v0.2.0-rc.2', commit: '639ed015397290b3745d163aafe02ffee4aa3f84' })
    expect(current.baselines.at(-1)).toMatchObject({
      release: current.release, tag: current.tag, commit: current.commit,
      source: 'https://github.com/deepseek-ai/deepseek-harness',
      strictRemoteCodecs: 'create-factories-with-legacy-schema-bridge',
      roleChildDescriptorVersion: 3, roleChildCacheVersion: 2,
      roleChildHistory: 'unknown-legacy-history-fail-closed',
      runtimeDependencies: 'public-resolution-and-unload',
      clientSessionContext: 'multiple-session-owner-isolation',
      evidenceScope: 'unchanged-tagged-source-target', standaloneNpmArtifacts: 'tested',
    })
    expect(current.baselines.at(-1).runtimeTests).toEqual(expect.arrayContaining([
      'tests/fixtures/alpha2-contracts-core.fixture.ts',
      'tests/fixtures/session-context-core.fixture.ts', 'tests/fixtures/remote-core.fixture.ts',
    ]))
    expect(current.baselines.find((entry: { release: string }) => entry.release === '0.1.6-alpha.2')).toMatchObject({
      release: '0.1.6-alpha.2', tag: 'dsh-v0.1.6-alpha.2',
      commit: 'ddefc45fbc7f8e46dd73185e68295696d1297887',
    })
    expect(baseline.evidence.peerRangeMeaning).toBe('package-admission-not-runtime-validation')
    expect(baseline.evidence.doesNotProve).toEqual(expect.arrayContaining(['live-discovery', 'live-model-transport', 'published-release', 'local-upgrade']))
    expect(baseline.package.version).toBe(pkg.version)
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(version).toBe('0.2.0-rc.2')
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
