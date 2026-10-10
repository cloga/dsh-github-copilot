import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateIterationReview } from '../../scripts/iteration-review.mjs'
import { planTask } from '../../scripts/agent.mjs'
import { verifyAgentContract } from '../../scripts/verify-agent-contract.mjs'

const report = JSON.parse(await readFile(new URL('../../docs/auto-iteration-review.json', import.meta.url), 'utf8'))
test('missing evidence is explicit and report validation is not a truth claim', () => {
  const missing = { ...report, status: 'not-collected',
    observation: { ...report.observation, start: null, end: null, sampleCount: 0 } }
  assert.equal(validateIterationReview(missing).evidenceStatus, 'not-collected')
  assert.equal(validateIterationReview(missing).evidenceTruthVerified, false)
  for (const mutate of [
    value => { value.status = 'observed' },
    value => { value.followUp.owner = '' },
    value => { value.followUp.trigger = '' },
    value => { value.credential = 'SYNTHETIC_PRIVATE_VALUE' },
    value => { value.observation.sampleCount = 1 },
  ]) {
    const value = structuredClone(missing); mutate(value)
    assert.throws(() => validateIterationReview(value))
  }
})
test('the current descriptive assessment review retains insufficient evidence and follow-up', () => {
  const result = validateIterationReview(report)
  assert.equal(result.evidenceStatus, 'insufficient-sample')
  assert.equal(result.sampleCount, 63)
  assert.equal(result.evidenceTruthVerified, false)
  assert.match(report.observation.limitations, /No Session\/turn IDs/)
  assert.match(report.followUp.trigger, /200 new decisions/)
  assert.match(report.followUp.action, /#334/)
})
test('observed and insufficient evidence need ordered windows and positive samples', () => {
  for (const status of ['observed', 'insufficient-sample']) {
    const value = { ...report, status, observation: { ...report.observation,
      start: '2026-10-05T00:00:00Z', end: '2026-10-05T01:00:00Z', sampleCount: 10 } }
    assert.equal(validateIterationReview(value).sampleCount, 10)
    value.observation.end = '2026-10-04T00:00:00Z'
    assert.throws(() => validateIterationReview(value))
  }
})
test('Auto plans begin with an unexecuted previous-review prerequisite', async () => {
  const plan = await planTask('autorouting')
  assert.deepEqual(plan.commands[0], { argv: [
    'node', 'scripts/iteration-review.mjs', '--report', 'docs/auto-iteration-review.json',
  ], executed: false })
})
test('contract rejects disabled prerequisites, missing follow-up or automatic uploads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iteration-contract-'))
  try {
    const contract = JSON.parse(await readFile(new URL('../../agent-contract.json', import.meta.url), 'utf8'))
    await writeFile(join(root, 'package.json'), '{}')
    for (const [key, value] of [['requiredBeforeImplementation', false], ['missingEvidenceMustBeExplicit', false],
      ['automaticUpload', true], ['followUpRequired', false]]) {
      const changed = structuredClone(contract)
      changed.tasks.autorouting.iterationReview[key] = value
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(changed))
      await assert.rejects(verifyAgentContract(root), /Auto iteration review/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('CLI rejects oversized and malformed private reports without echoing their contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iteration-report-'))
  try {
    const file = join(root, 'report.json')
    for (const content of ['PRIVATE_SENTINEL', JSON.stringify({ ...report, findings: 'PRIVATE_SENTINEL'.repeat(4000) })]) {
      await writeFile(file, content)
      const result = spawnSync(process.execPath, ['scripts/iteration-review.mjs', '--report', file], { encoding: 'utf8' })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /ITERATION_REVIEW_INVALID/)
      assert.doesNotMatch(result.stderr + result.stdout, /PRIVATE_SENTINEL/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
