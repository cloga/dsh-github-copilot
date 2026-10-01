import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { boot, loadOverlayPatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { WebRuntime } from '@deepseek-ai/dsh-web'

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const bundlePath = join(packageRoot, 'cordis.patch.yml')

function snapshot(ctx, label, officialWeb) {
  return Promise.resolve(officialWeb.search({ query: 'fixture provider readiness' })).then(
    result => ({
      label,
      globalWebAvailable: ctx.get('web') !== undefined,
      isolatedOfficialWebAvailable: ctx.get('githubCopilotOriginalWeb') !== undefined,
      providerSearchWorks: result.answer === 'fixture-search',
      consumerActive: ctx.get('fixtureConsumerReady') === true,
    }),
    error => ({
      label,
      globalWebAvailable: ctx.get('web') !== undefined,
      isolatedOfficialWebAvailable: ctx.get('githubCopilotOriginalWeb') !== undefined,
      providerSearchWorks: false,
      providerError: error instanceof Error && 'code' in error ? error.code : error instanceof Error ? error.name : 'unknown',
      consumerActive: ctx.get('fixtureConsumerReady') === true,
    }),
  )
}

async function assertGlobalSearchWorks(ctx) {
  assert.equal(ctx.get('web') !== undefined, true, 'public global ctx.web must be available')
  assert.equal(ctx.get('fixtureConsumerReady'), true, 'independent global consumer must be active')
  assert.equal((await ctx.web.search({ query: 'fixture query' })).answer, 'fixture-search')
}

async function reconcileKnownState(ctx, patches, label, expectedPending) {
  let diagnostic = ''
  try {
    const warnings = await reconcileProfilePatches(ctx, patches, label, [])
    diagnostic = Array.isArray(warnings) ? warnings.join('\n') : ''
  } catch (error) {
    assert.ok(error instanceof Error)
    assert.ok(error.message.startsWith(`${label}: warning:`), error.message)
    diagnostic = error.message
  }
  const pending = [...diagnostic.matchAll(/^([^\s(]+) \(.+\): pending \(waiting for service: [^)]+\)$/gm)]
    .map(match => match[1])
    .sort()
  assert.deepEqual(pending, [...expectedPending].sort(), diagnostic)
}

function lifecycleGeneration(candidate, consumerHref, disabled = []) {
  const web = candidate.find(patch => patch.id === 'web')
  const insert = candidate.find(patch => patch.insert !== undefined)?.insert ?? []
  assert.ok(web, 'the reviewed bundle patch must contain its official web row')
  assert.ok(insert.some(entry => entry.id === 'github-copilot-web-delegate'))
  assert.ok(insert.some(entry => entry.id === 'github-copilot-routed-web'))
  return [
    web,
    { id: 'fixture-consumer', name: consumerHref },
    { insert },
    ...disabled.map(id => ({
      id,
      name: insert.find(entry => entry.id === id).name,
      disabled: true,
    })),
  ]
}

async function createFixture({ providerInitiallyActive = false, initialPatches = [] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'copilot-web-lifecycle-'))
  const consumer = join(directory, 'consumer.mjs')
  const config = join(directory, 'cordis.json')
  await writeFile(consumer, [
    'export const inject = ["web"]',
    'export function apply(ctx) { ctx.provide("fixtureConsumerReady", true) }',
    '',
  ].join('\n'))
  const consumerHref = pathToFileURL(consumer).href
  await writeFile(config, JSON.stringify([
    { id: 'web', name: '@deepseek-ai/dsh-web' },
    { id: 'fixture-consumer', name: consumerHref },
  ]))
  const ctx = await boot(
    'copilot-web-lifecycle-characterization',
    config,
    initialPatches,
    undefined,
    pathToFileURL(join(packageRoot, 'package.json')).href,
  )
  const officialWeb = ctx.get('githubCopilotOriginalWeb') ?? ctx.get('web')
  assert.ok(officialWeb, 'stock public WebRuntime must be available before the bundle transition')
  let disposeProvider = () => {}
  const registerProvider = web => {
    disposeProvider()
    disposeProvider = web.registerSearchProvider({
      id: 'fixture-search',
      available: () => true,
      search: async () => ({ answer: 'fixture-search', sources: [], truncated: false }),
    })
  }
  if (providerInitiallyActive) registerProvider(officialWeb)
  return {
    ctx, consumerHref, officialWeb, registerProvider,
    dispose: async () => {
      try {
        disposeProvider()
        await ctx.fiber.dispose()
      } finally { await rm(directory, { recursive: true, force: true }) }
    },
  }
}

async function reviewedCandidate() {
  return loadOverlayPatches('test', bundlePath).flatMap(patch => {
    if (patch.insert === undefined) return [patch]
    const insert = patch.insert
      .filter(entry => entry.id !== 'github-copilot')
      .map(entry => ({
        ...entry,
        name: entry.name === 'dsh-github-copilot/web-delegate'
          ? pathToFileURL(join(packageRoot, 'lib/web-delegate.js')).href
          : entry.name === 'dsh-github-copilot/routed-web'
            ? pathToFileURL(join(packageRoot, 'lib/routed-web.js')).href
            : entry.name,
      }))
    return [{ ...patch, insert }]
  })
}

test('known-bug characterization: exact bundle ids strand an active consumer during staged first-add', async () => {
  const unaffected = await createFixture({ providerInitiallyActive: true })
  try {
    await assertGlobalSearchWorks(unaffected.ctx)
  } finally {
    await unaffected.dispose()
  }

  const fixture = await createFixture({ providerInitiallyActive: true })
  const { ctx, officialWeb } = fixture
  const candidate = await reviewedCandidate()
  const timeline = []
  try {
    await assertGlobalSearchWorks(ctx)
    timeline.push(await snapshot(ctx, 'before-first-add', officialWeb))
    assert.deepEqual(
      { globalWebAvailable: timeline[0].globalWebAvailable, providerSearchWorks: timeline[0].providerSearchWorks, consumerActive: timeline[0].consumerActive },
      { globalWebAvailable: true, providerSearchWorks: true, consumerActive: true },
    )

    const stages = [
      lifecycleGeneration(candidate, fixture.consumerHref, ['github-copilot-web-delegate', 'github-copilot-routed-web']),
      lifecycleGeneration(candidate, fixture.consumerHref, ['github-copilot-routed-web']),
      lifecycleGeneration(candidate, fixture.consumerHref),
    ]
    for (const [index, patches] of stages.entries()) {
      const before = timeline.at(-1)
      assert.equal(before.providerSearchWorks, true, `provider precondition before first-add stage ${index + 1}`)
      if (index > 0) assert.equal(before.consumerActive, false, `consumer state before first-add stage ${index + 1}`)
      await reconcileKnownState(ctx, patches, `first-add-stage-${index + 1}`, ['fixture-consumer'])
      const after = await snapshot(ctx, `first-add-stage-${index + 1}`, officialWeb)
      timeline.push(after)
      assert.equal(after.providerSearchWorks, true, 'registered provider remains callable on the captured official WebRuntime')
      assert.equal(after.globalWebAvailable, false)
      assert.equal(after.consumerActive, false)
    }

    assert.equal(ctx.get('web'), undefined, 'completed staged add still has no public global Web service with the exact bundle ids')
    assert.deepEqual(timeline.map(({ label }) => label), [
      'before-first-add',
      'first-add-stage-1',
      'first-add-stage-2',
      'first-add-stage-3',
    ])
  } finally {
    await fixture.dispose()
  }
  assert.equal(ctx.get('web'), undefined, 'Loader teardown leaves no global service')
})

test('known-bug characterization: remove and re-add strands an active cold-loaded routed consumer', async () => {
  const candidate = await reviewedCandidate()
  const fixture = await createFixture({ initialPatches: candidate })
  const { ctx, officialWeb } = fixture
  const timeline = []
  try {
    assert.equal(ctx.get('web') !== undefined, true, 'cold-loaded route exposes the public global Web service')
    assert.equal(ctx.get('fixtureConsumerReady'), true, 'cold-loaded route activates the independent consumer')
    const activeWeb = ctx.get('web')
    assert.ok(activeWeb)
    fixture.registerProvider(activeWeb)
    await assertGlobalSearchWorks(ctx)
    const beforeRemove = await snapshot(ctx, 'before-remove', officialWeb)
    timeline.push(beforeRemove)
    assert.deepEqual(
      { globalWebAvailable: beforeRemove.globalWebAvailable, providerSearchWorks: beforeRemove.providerSearchWorks, consumerActive: beforeRemove.consumerActive },
      { globalWebAvailable: true, providerSearchWorks: true, consumerActive: true },
    )

    await reconcileKnownState(ctx, [], 'bundle-removed', ['fixture-consumer'])
    const afterRemove = await snapshot(ctx, 'after-remove', officialWeb)
    timeline.push(afterRemove)
    assert.deepEqual(
      { globalWebAvailable: afterRemove.globalWebAvailable, providerSearchWorks: afterRemove.providerSearchWorks, consumerActive: afterRemove.consumerActive },
      { globalWebAvailable: false, providerSearchWorks: true, consumerActive: false },
    )

    const beforeReadd = await snapshot(ctx, 'before-readd', officialWeb)
    timeline.push(beforeReadd)
    assert.deepEqual(
      { globalWebAvailable: beforeReadd.globalWebAvailable, providerSearchWorks: beforeReadd.providerSearchWorks, consumerActive: beforeReadd.consumerActive },
      { globalWebAvailable: false, providerSearchWorks: true, consumerActive: false },
      'the re-add starts from the explicitly recorded stranded state; consumer recovery is the expected outcome, not a precondition',
    )
    await reconcileKnownState(ctx, candidate, 'bundle-readded', ['fixture-consumer'])
    const afterReadd = await snapshot(ctx, 'after-readd', officialWeb)
    timeline.push(afterReadd)
    await reconcileKnownState(ctx, candidate, 'bundle-readded-retry', ['fixture-consumer'])
    const afterRetry = await snapshot(ctx, 'after-readd-retry', officialWeb)
    timeline.push(afterRetry)
    for (const state of [afterReadd, afterRetry]) {
      assert.deepEqual(
        { globalWebAvailable: state.globalWebAvailable, providerSearchWorks: state.providerSearchWorks, consumerActive: state.consumerActive },
        { globalWebAvailable: false, providerSearchWorks: true, consumerActive: false },
      )
    }
    assert.equal(ctx.get('web'), undefined)
    assert.equal(timeline.at(-1).label, 'after-readd-retry')
  } finally {
    await fixture.dispose()
  }
  assert.equal(ctx.get('web'), undefined, 'Loader teardown leaves no global service')
})

test('public rc.2 provider registration cannot transparently override configured dispatch', async () => {
  async function selection(config) {
    const ctx = new Context()
    const fibers = []
    try {
      const web = ctx.plugin(WebRuntime, config)
      fibers.push(web)
      await web
      for (const id of ['configured-provider', 'copilot-router']) {
        const fiber = ctx.plugin({
          name: `fixture-${id}`,
          inject: ['web'],
          apply(pluginContext) {
            pluginContext.web.registerSearchProvider({
              id,
              available: () => true,
              search: async () => ({ answer: id, sources: [], truncated: false }),
            })
          },
        })
        fibers.push(fiber)
        await fiber
      }
      try {
        return { answer: (await ctx.get('web').search({ query: 'selection fixture' })).answer }
      } catch (error) {
        return { errorCode: error instanceof Error && 'code' in error ? error.code : error instanceof Error ? error.name : 'unknown' }
      }
    } finally {
      for (const fiber of fibers.reverse()) await fiber.dispose()
    }
  }

  assert.deepEqual(await selection({ searchProvider: 'configured-provider' }), { answer: 'configured-provider' })
  assert.deepEqual(await selection({}), { errorCode: 'WEB_PROVIDER_AMBIGUOUS' })
})
