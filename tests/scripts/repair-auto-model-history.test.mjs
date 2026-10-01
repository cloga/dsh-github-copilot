import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { repairAutoModelHistory, runCli } from '../../scripts/repair-auto-model-history.mjs'

const header = sessionFormatCatalog.encodeCurrentHeader({
  version: 4, id: 'fixture-auto-history', createdAt: 1, isSeeded: false, delegationDepth: 0,
}, 0)
const decision = {
  type: 'github-copilot/auto-model-decision', seq: 0, time: 1,
  data: {
    turn: 1, step: 1, provider: 'github-copilot-preview', model: 'fixture-model',
    preference: 'balance', taskClass: 'fast', reason: 'short-text-turn', candidateCount: 2,
  },
}
const rows = events => [header, ...events]
const compress = records => zstdCompressSync(Buffer.from(`${records.map(row => JSON.stringify(row)).join('\n')}\n`))
const decode = bytes => zstdDecompressSync(bytes).toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line))

test('official current reader rejects the original event and accepts only its repaired marker', () => {
  const reader = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  assert.throws(() => { reader.decodeRow(decision); reader.finish() }, /unknown event type/)
  const result = repairAutoModelHistory(compress(rows([decision])))
  assert.deepEqual(result.report.changedSeqs, [0])
  assert.deepEqual(decode(result.output), rows([{ ...decision, ignorable: true }]))
  assert.equal(result.report.eventCount, 1)
  assert.deepEqual(repairAutoModelHistory(result.output).output, result.output)
})

test('preserves other events and concatenated zstd frames without changing sequence or data', () => {
  const events = [decision, { type: 'model/selection', seq: 1, time: 2, data: { provider: 'fixture', model: 'model' } }]
  const input = Buffer.concat([compress([header]), compress(events)])
  assert.deepEqual(decode(repairAutoModelHistory(input).output), rows([{ ...decision, ignorable: true }, events[1]]))
})

test('refuses unrelated unknown events, unexpected decision shapes, invalid sequences and torn tails', () => {
  for (const event of [
    { ...decision, type: 'unknown/required' },
    { ...decision, surfaceOp: 'append' },
    { ...decision, data: { ...decision.data, unknown: 'private' } },
    { ...decision, data: { ...decision.data, candidateCount: 0 } },
    { ...decision, seq: 1 },
    { ...decision, ignorable: false },
  ]) assert.throws(() => repairAutoModelHistory(compress(rows([event]))))
  const input = compress(rows([decision]))
  assert.throws(() => repairAutoModelHistory(input.subarray(0, input.length - 4)))
  assert.throws(() => repairAutoModelHistory(zstdCompressSync(Buffer.from(JSON.stringify(header)))))
  assert.throws(() => repairAutoModelHistory(compress([{ ...header, version: 3 }, decision])))
  assert.throws(() => repairAutoModelHistory(compress(rows([decision, { ...decision, seq: 2 }]))))
})

test('check-only and detached-copy modes never modify the source or overwrite prior recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'copilot-auto-repair-'))
  try {
    const source = join(directory, 'session.v4.jsonl.zstd')
    const output = join(directory, 'recovery')
    const input = compress(rows([decision]))
    await writeFile(source, input)
    assert.equal((await runCli([source])).mode, 'check-only')
    const result = await runCli([source, '--write-copy', output])
    assert.equal(result.mode, 'detached-copy')
    assert.deepEqual(await readFile(source), input)
    assert.deepEqual(await readFile(join(output, 'original.session.v4.jsonl.zstd')), input)
    assert.deepEqual(decode(await readFile(join(output, 'session.v4.jsonl.zstd'))), rows([{ ...decision, ignorable: true }]))
    assert.equal(JSON.parse(await readFile(join(output, 'repair.json'), 'utf8')).originalSha256, result.originalSha256)
    await assert.rejects(runCli([source, '--write-copy', output]), /EEXIST/)
    await assert.rejects(runCli([source, '--write-copy', source]), /EEXIST/)
    await assert.rejects(runCli(['relative.zstd']))
    assert.deepEqual(await readFile(source), input)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
