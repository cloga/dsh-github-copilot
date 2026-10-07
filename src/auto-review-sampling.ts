import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { currentSearchInitiator } from './current-provider.ts'
import type {} from './preview-route.ts'

const REVIEWER = '@deepseek-ai/dsh-experimental-auto-review'
const CORE_VERSION = '0.2.0-rc.2'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function streamService(value: unknown): value is Pick<LlmRuntime, 'stream'> {
  return record(value) && typeof value.stream === 'function'
}

/** Resolve the published callback, never the configured entry's display name. */
export async function isNativeReviewerContext(caller: Context): Promise<boolean> {
  const fiber = caller.fiber
  const entry = fiber.entry
  if (entry === undefined || entry.fiber !== fiber || entry.options.name !== REVIEWER
    || fiber.runtime === null || fiber.uid === null) return false
  const base = entry.parent.tree.ctx.baseUrl
  const packages = caller.get('pluginPackages')
  if (base === undefined || packages === undefined) return false
  const owner = packages.packageOf(REVIEWER, base)
  if (owner?.name !== REVIEWER || owner.version !== CORE_VERSION) return false
  const importedOwner = packages.packageOf(REVIEWER, import.meta.url)
  if (importedOwner?.manifestPath !== owner.manifestPath) return false
  const module: unknown = await import(REVIEWER)
  return record(module) && typeof module.apply === 'function' && module.apply === fiber.runtime.callback
    && fiber.uid !== null && entry.fiber === fiber && entry.options.name === REVIEWER
}

/** Reversible service-read delegation; neither the native service nor its context is changed. */
export function installAutoReviewSampling(ctx: Context): () => void {
  let active = true
  const lifecycle = new AbortController()
  const diagnosed = new Set<string>()
  const diagnose = (code: string) => {
    if (diagnosed.has(code)) return
    diagnosed.add(code)
    ctx.logger.warn(`github-copilot: Auto reviewer sampling scope unavailable (${code})`)
  }
  const dispose = ctx.on('internal/get', (caller, name, _error, next) => {
    const native: unknown = next()
    if (!active || name !== 'llm' || !streamService(native)) return native
    const entry = caller.fiber.entry
    if (entry === undefined || entry.fiber !== caller.fiber || entry.options.name !== REVIEWER) return native
    const runtime = native
    const scopedStream = (options: GenerateOptions): AsyncIterable<StreamChunk> => (async function* () {
      if (!active || options.provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID) {
        yield* runtime.stream(options)
        return
      }
      let identified: boolean
      try {
        identified = await isNativeReviewerContext(caller)
      } catch {
        diagnose('COPILOT_AUTO_REVIEW_IDENTITY_UNAVAILABLE')
        yield* runtime.stream(options)
        return
      }
      if (!active || !identified) {
        if (active) diagnose('COPILOT_AUTO_REVIEW_IDENTITY_UNPROVEN')
        yield* runtime.stream(options)
        return
      }
      const preview = ctx.get('githubCopilotPreview')
      if (preview === undefined) {
        diagnose('COPILOT_AUTO_REVIEW_ROUTE_UNAVAILABLE')
        yield* runtime.stream(options)
        return
      }
      await preview.discover({ signal: options.signal })
      const route = preview.recoveryLimits(options.model, currentSearchInitiator(ctx))
      if (!active || route?.api !== 'openai-responses') {
        if (active && route === undefined) diagnose('COPILOT_AUTO_REVIEW_ROUTE_UNPROVEN')
        yield* runtime.stream(options)
        return
      }
      route.assertCurrent()
      const signal = options.signal === undefined ? lifecycle.signal : AbortSignal.any([options.signal, lifecycle.signal])
      const request = { ...options, temperature: undefined, signal }
      if (Object.isFrozen(options)) Object.freeze(request)
      yield* runtime.stream(request)
    })()
    return new Proxy(runtime, {
      get(target, key) { return key === 'stream' ? scopedStream : Reflect.get(target, key, target) },
    })
  })
  return () => {
    active = false
    lifecycle.abort()
    dispose()
    diagnosed.clear()
  }
}
