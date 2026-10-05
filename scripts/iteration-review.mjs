import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function validateIterationReview(value) {
  const require = (condition, message) => { if (!condition) throw new Error(`Iteration review: ${message}`) }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const keys = (value, allowed) => require(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'unknown or invalid fields')
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000
  keys(value, ['schemaVersion', 'feature', 'status', 'policyVersion', 'observation', 'previousReview', 'findings', 'decision', 'validation', 'followUp'])
  require(value.schemaVersion === 1 && value.feature === 'autorouting', 'unsupported version or feature')
  require(['observed', 'not-collected', 'insufficient-sample', 'unavailable'].includes(value.status), 'explicit evidence status required')
  require(text(value.policyVersion), 'policy version required')
  keys(value.observation, ['start', 'end', 'sampleCount', 'limitations'])
  const { start, end, sampleCount, limitations } = value.observation
  require(Number.isSafeInteger(sampleCount) && sampleCount >= 0, 'invalid sample count')
  require(text(limitations), 'observation limitations required')
  if (value.status === 'observed' || value.status === 'insufficient-sample') {
    require(typeof start === 'string' && typeof end === 'string'
      && Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end))
      && Date.parse(start) <= Date.parse(end), 'valid observation window required')
    require(sampleCount > 0, 'observed evidence needs samples')
  } else require(start === null && end === null && sampleCount === 0, 'missing evidence cannot claim a window')
  require(value.previousReview === null || text(value.previousReview), 'invalid prior review reference')
  for (const field of ['findings', 'decision', 'validation']) require(text(value[field]), `${field} required`)
  keys(value.followUp, ['owner', 'trigger', 'metric', 'action'])
  for (const field of ['owner', 'trigger', 'metric', 'action']) require(text(value.followUp[field]), `follow-up ${field} required`)
  return { schemaVersion: 1, ok: true, feature: value.feature, evidenceStatus: value.status,
    sampleCount, reviewDocumentOnly: true, evidenceTruthVerified: false }
}

export async function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 2 || args[0] !== '--report') throw new Error('Invalid arguments')
    const handle = await open(resolve(args[1]), 'r')
    let value
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > 32768) throw new Error('Invalid report file')
      const bytes = Buffer.alloc(32769)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead > 32768) throw new Error('Report exceeds 32 KiB')
      value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
    } finally { await handle.close() }
    const review = validateIterationReview(value)
    console.log(JSON.stringify({ ...review, report: value }))
    return 0
  } catch {
    console.error('ITERATION_REVIEW_INVALID: provide a bounded report matching docs/evidence-driven-iteration.md')
    return 1
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main()
