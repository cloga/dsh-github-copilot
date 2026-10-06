import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = resolve('scripts/analyze-diagnostics.mjs')
const emptySnapshot = () => ({
  schemaVersion: 1, coverageVersion: 1, epoch: 2, updatedAt: 1_800_000_000_000,
  rows: [], pending: [], dropped: 0, clientDropped: 0, clientUnconfirmed: 0,
  saturated: 0, evicted: 0, interrupted: 0,
})
const profileName = 'test'
const unitName = `github_copilot_diagnostics_${Buffer.from(profileName, 'ascii').toString('hex')}`

test('portable diagnostics CLI writes only an explicitly requested local strict report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-diagnostics-analysis-'))
  try {
    const input = join(directory, `${unitName}.json`)
    const output = join(directory, 'report.json')
    await writeFile(input, JSON.stringify({ unit: { name: unitName, version: 1 },
      global: emptySnapshot(), tables: {} }), { flag: 'wx' })
    const result = spawnSync(process.execPath, [script, '--input', input, '--mode', 'persisted-unit',
      '--profile-name', profileName, '--output', output], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.source, 'persisted-snapshot')
    assert.equal(report.collection.enabled, null)
    assert.equal(report.coverageComplete, false)
    assert.equal(JSON.stringify(report).includes(unitName), false)

    const second = spawnSync(process.execPath, [script, '--input', input, '--mode', 'persisted-unit',
      '--profile-name', profileName, '--output', output], { encoding: 'utf8' })
    assert.equal(second.status, 1)
    assert.equal(second.stdout, '')
    assert.equal(second.stderr, 'COPILOT_DIAGNOSTICS_ANALYSIS_OUTPUT_UNAVAILABLE\n')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('portable diagnostics CLI rejects private data without echoing it or writing a report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-diagnostics-analysis-'))
  try {
    const input = join(directory, `${unitName}.json`)
    const output = join(directory, 'report.json')
    const marker = 'private-account-marker'
    await writeFile(input, JSON.stringify({ unit: { name: unitName, version: 1 },
      global: { ...emptySnapshot(), accountId: marker }, tables: {} }), { flag: 'wx' })
    const result = spawnSync(process.execPath, [script, '--input', input, '--mode', 'persisted-unit',
      '--profile-name', profileName, '--output', output], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_SNAPSHOT\n')
    assert.equal(result.stderr.includes(marker), false)
    await assert.rejects(readFile(output))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reviewed-view mode is an explicit strict file input and preserves its read-time state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-diagnostics-analysis-'))
  try {
    const input = join(directory, 'reviewed-view.json')
    const output = join(directory, 'reviewed-report.json')
    await writeFile(input, JSON.stringify({
      enabled: true, state: 'ready', diagnostic: 'none', dirty: false,
      persistedAt: 1_800_000_000_000, snapshot: emptySnapshot(),
    }), { flag: 'wx' })
    const result = spawnSync(process.execPath, [script, '--input', input, '--mode', 'reviewed-view',
      '--output', output], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.source, 'reviewed-view')
    assert.deepEqual(report.collection, {
      enabled: true, state: 'ready', diagnostic: 'none', dirty: false,
      persistedAt: 1_800_000_000_000,
    })
    assert.equal(report.gaps.includes('live-enabled-state-unknown'), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
