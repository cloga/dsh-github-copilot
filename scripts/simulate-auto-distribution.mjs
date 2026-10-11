import assert from 'node:assert/strict'
import { selectAutoModel } from '../src/auto-model-routing.ts'

// Synthetic fixtures only; no account metadata, credentials or model calls.
const models = [
  ['powerful-marked', 'powerful', true],
  ['powerful-ordinary', 'powerful', true],
  ['versatile-a', 'versatile', true],
  ['versatile-b', 'versatile', false],
  ['lightweight-a', 'lightweight', true],
  ['lightweight-b', 'lightweight', false],
].map(([id, category, image]) => ({
  id, name: id, category, api: 'openai-responses', contextWindow: 128000, maxTokens: 8000,
  input: image ? ['text', 'image'] : ['text'],
  reasoning: { advertisedEfforts: [], unmappedEfforts: [] },
  evidence: { endpoints: ['/responses'], unsupportedEndpointCount: 0,
    selectedEndpoint: '/responses', apiSource: 'advertised-native',
    policySource: 'server-enabled', contextWindowSource: 'max_context_window_tokens' },
}))
const samples = 100000
function simulate(label, { demand = 'complex', preference = 'balance', previous,
  sequential = false, pool = models, floor = 100, image = false,
  marks = ['powerful-marked'] } = {}) {
  const counts = Object.fromEntries(models.map(model => [model.id, 0]))
  const expected = Object.fromEntries(models.map(model => [model.id, 0]))
  let prior = previous, pairs = 0, last, sample
  const messages = [{ role: 'user', content: [
    { type: 'text', text: 'Synthetic fixture task.' }, ...(image ? [{ type: 'image' }] : []),
  ] }]
  for (let turn = 1; turn <= samples; turn++) {
    const decision = selectAutoModel(pool, messages, preference, {
      estimateMessage: () => 100, inputTokenFloor: floor,
      sessionId: 'synthetic-probability-audit', turn,
      assessment: { demand, source: 'semantic', signals: [] },
      previousModelId: prior, highCostModelIds: marks,
    })
    sample ??= decision
    counts[decision.model.id]++
    for (const row of decision.explanation.allocation?.candidates ?? []) {
      expected[row.modelId] += row.expectedShare
    }
    if (last === 'powerful-marked' && decision.model.id === last) pairs++
    last = decision.model.id
    if (sequential) prior = last
  }
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), samples)
  const rows = models.map(model => {
    const expectedPercent = expected[model.id] / samples * 100
    const observedPercent = counts[model.id] / samples * 100
    assert.ok(Math.abs(expectedPercent - observedPercent) < 0.5)
    if (expectedPercent > 0) assert.ok(counts[model.id] > 0)
    else assert.equal(counts[model.id], 0)
    return { modelId: model.id, count: counts[model.id],
      expectedPercent: +expectedPercent.toFixed(4), observedPercent: +observedPercent.toFixed(4) }
  })
  return { label, samples, target: sample.explanation.targetCategory,
    adjacentMarkedPairs: pairs, rows }
}
const results = []
for (const demand of ['simple', 'routine', 'complex', 'unknown']) {
  for (const preference of ['efficiency', 'balance', 'intelligence']) {
    results.push(simulate(`${demand}/${preference}`, { demand, preference }))
  }
}
results.push(simulate('complex/previous-ordinary', { previous: 'powerful-ordinary' }))
results.push(simulate('complex/previous-marked', { previous: 'powerful-marked' }))
results.push(simulate('complex/sequential', { previous: 'powerful-ordinary', sequential: true }))
results.push(simulate('complex/both-powerful-marked', {
  marks: ['powerful-marked', 'powerful-ordinary'], previous: 'powerful-marked',
}))
results.push(simulate('complex/ordinary-does-not-fit', {
  pool: models.map(model => model.id === 'powerful-ordinary' ? { ...model, contextWindow: 10000 } : model),
  floor: 20000, previous: 'powerful-marked',
}))
results.push(simulate('routine/image', { demand: 'routine', image: true }))
results.push(simulate('complex/powerful-do-not-fit', {
  pool: models.map(model => model.category === 'powerful' ? { ...model, contextWindow: 10000 } : model),
  floor: 20000,
}))
console.log(JSON.stringify({
  fixtureOnly: true, policy: 'high-cost-v4',
  note: 'Calls the actual selector with synthetic metadata and Session/turn seeds. Not account probabilities, independent draws, task quality or billing.',
  results,
}, null, 2))
