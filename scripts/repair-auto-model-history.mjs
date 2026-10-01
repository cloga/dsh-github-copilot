import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'

const eventType = 'github-copilot/auto-model-decision'
const maxBytes = 128 * 1024 * 1024
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const budgetFields = ['fittingCandidateCount', 'estimatedInputTokens', 'selectedInputBudget', 'inputFitDiagnostic']

function assertDecision(event) {
  const data = event.data
  if (!Object.keys(event).every(key => ['type', 'seq', 'time', 'data', 'ignorable'].includes(key))
    || !count(event.seq) || !count(event.time)
    || event.ignorable !== undefined && event.ignorable !== true
    || !object(data) || !Object.keys(data).every(key =>
      ['turn', 'step', 'provider', 'model', 'preference', 'taskClass', 'reason', 'candidateCount', ...budgetFields].includes(key))
    || !count(data.turn) || !count(data.step)
    || data.provider !== 'github-copilot-preview'
    || typeof data.model !== 'string' || data.model.trim() === ''
    || data.preference !== undefined && !['efficiency', 'balance', 'intelligence'].includes(data.preference)
    || !['fast', 'balanced', 'strong'].includes(data.taskClass)
    || !['short-text-turn', 'standard-turn', 'large-structured-turn', 'image-capability'].includes(data.reason)
    || !count(data.candidateCount) || data.candidateCount < 1) {
    throw new Error('AUTO_HISTORY_UNRECOGNIZED_DECISION')
  }
  if (budgetFields.some(key => Object.hasOwn(data, key))
    && (!count(data.fittingCandidateCount) || data.fittingCandidateCount > data.candidateCount
      || !count(data.estimatedInputTokens) || !count(data.selectedInputBudget) || data.selectedInputBudget < 1
      || !['fitting-candidate-selected', 'compaction-eligible', 'compaction-unavailable',
        'attempted-but-still-oversized', 'fixed-content-cannot-fit'].includes(data.inputFitDiagnostic))) {
    throw new Error('AUTO_HISTORY_UNRECOGNIZED_BUDGET')
  }
}

function restore(rows) {
  if (rows[0]?.type !== 'session' || rows[0].version !== 4) throw new Error('AUTO_HISTORY_REQUIRES_V4')
  const reader = sessionFormatCatalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' })
  for (const row of rows.slice(1)) reader.decodeRow(row)
  return reader.finish()
}

function decompress(input) {
  const chunks = []
  let offset = 0
  let total = 0
  while (offset < input.length) {
    if (total >= maxBytes || input.subarray(offset, offset + 4).toString('hex') !== '28b52ffd') {
      throw new Error('AUTO_HISTORY_INVALID_ZSTD_FRAME')
    }
    // Node decodes one frame per call; DSH appends multiple independent frames.
    const { buffer, engine } = zstdDecompressSync(input.subarray(offset), {
      info: true, maxOutputLength: maxBytes - total,
    })
    if (engine.bytesWritten <= 0 || engine.bytesWritten > input.length - offset) {
      throw new Error('AUTO_HISTORY_INVALID_ZSTD_LENGTH')
    }
    chunks.push(buffer)
    total += buffer.length
    offset += engine.bytesWritten
  }
  return {
    decoded: Buffer.concat(chunks, total),
    independentHeader: chunks.length > 0 && chunks[0].indexOf(10) === chunks[0].length - 1,
  }
}

/** Produces a detached copy; only the optional event envelope marker may change. */
export function repairAutoModelHistory(input) {
  if (input.length > maxBytes) throw new Error('AUTO_HISTORY_TOO_LARGE')
  const { decoded, independentHeader } = decompress(input)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  if (!text.endsWith('\n')) throw new Error('AUTO_HISTORY_INCOMPLETE_TAIL')
  const lines = text.slice(0, -1).split('\n')
  const rows = lines.map(line => JSON.parse(line))
  const changedSeqs = []
  for (let index = 1; index < rows.length; index++) {
    const event = rows[index]
    if (!object(event) || event.type !== eventType) continue
    assertDecision(event)
    if (event.ignorable === true) continue
    rows[index] = { ...event, ignorable: true }
    lines[index] = JSON.stringify(rows[index])
    changedSeqs.push(event.seq)
  }
  // The official reader must accept all events, relationships and surfaces, not only our event.
  const artifact = restore(rows)
  const reframedHeader = !independentHeader
  if (reframedHeader && !rows.slice(1).some(row => row.type === eventType)) {
    throw new Error('AUTO_HISTORY_UNRECOGNIZED_FRAME_REPAIR')
  }
  // Desktop discovers logs by decoding a first frame containing only the header.
  const output = changedSeqs.length === 0 && !reframedHeader ? input : Buffer.concat([
    zstdCompressSync(Buffer.from(`${lines[0]}\n`)),
    ...(lines.length > 1 ? [zstdCompressSync(Buffer.from(`${lines.slice(1).join('\n')}\n`))] : []),
  ])
  const verified = decompress(output)
  if (!verified.independentHeader) throw new Error('AUTO_HISTORY_INVALID_HEADER_FRAME')
  const roundTrip = new TextDecoder('utf-8', { fatal: true })
    .decode(verified.decoded)
  const restored = restore(roundTrip.slice(0, -1).split('\n').map(line => JSON.parse(line)))
  if (JSON.stringify(restored) !== JSON.stringify(artifact)) throw new Error('AUTO_HISTORY_ROUNDTRIP_MISMATCH')
  return {
    output,
    report: {
      format: 4,
      eventCount: artifact.events.length,
      changedSeqs,
      reframedHeader,
      originalSha256: hash(input),
      repairedSha256: hash(output),
    },
  }
}

export async function runCli(args) {
  if (args.length !== 1 && !(args.length === 3 && args[1] === '--write-copy')) {
    throw new Error('Usage: node scripts/repair-auto-model-history.mjs <absolute-log-path> [--write-copy <new-absolute-directory>]')
  }
  const [source, , destination] = args
  if (!isAbsolute(source) || destination !== undefined && !isAbsolute(destination)) {
    throw new Error('AUTO_HISTORY_REQUIRES_ABSOLUTE_PATHS')
  }
  const before = await lstat(source)
  if (!before.isFile() || before.size > maxBytes) throw new Error('AUTO_HISTORY_REQUIRES_BOUNDED_REGULAR_FILE')
  const input = await readFile(source)
  const result = repairAutoModelHistory(input)
  const after = await lstat(source)
  if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs
    || before.ino !== after.ino || hash(await readFile(source)) !== result.report.originalSha256) {
    throw new Error('AUTO_HISTORY_SOURCE_CHANGED')
  }
  if (destination !== undefined) {
    if (result.report.changedSeqs.length === 0 && !result.report.reframedHeader) throw new Error('AUTO_HISTORY_NOTHING_TO_REPAIR')
    // Never overwrite the source, an existing recovery directory, or any existing output.
    await mkdir(destination, { mode: 0o700 })
    await writeFile(join(destination, 'original.session.v4.jsonl.zstd'), input, { flag: 'wx', mode: 0o600 })
    await writeFile(join(destination, 'session.v4.jsonl.zstd'), result.output, { flag: 'wx', mode: 0o600 })
    const written = repairAutoModelHistory(await readFile(join(destination, 'session.v4.jsonl.zstd')))
    if (written.report.originalSha256 !== result.report.repairedSha256
      || written.report.changedSeqs.length !== 0 || written.report.reframedHeader) {
      throw new Error('AUTO_HISTORY_WRITTEN_COPY_MISMATCH')
    }
    await writeFile(join(destination, 'repair.json'), `${JSON.stringify(result.report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  }
  return { mode: destination === undefined ? 'check-only' : 'detached-copy', ...result.report }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await runCli(process.argv.slice(2)), null, 2))
  } catch {
    // Parser and upstream errors may contain private event payloads or filesystem paths.
    console.error('AUTO_HISTORY_REPAIR_REFUSED: invalid arguments, changed source, unsupported/corrupt history, or output failure. Source was not modified; do not install a partial recovery directory.')
    process.exitCode = 1
  }
}
