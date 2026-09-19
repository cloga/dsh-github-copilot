/** Local Copilot pressure signalling over the stock compaction recovery path. */
import type { Context } from '@deepseek-ai/cordis'
import { callConfigEquals, CONTEXT_WINDOW_EXCEEDED_CODE, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { currentSearchInitiator } from './current-provider.ts'
import { isPluginPreviewProvider } from './model-protocol.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'

/** Conservative input threshold already resolved from authenticated model facts and current policy. */
export interface CopilotCompactionPressureBudget {
  readonly inputBudgetTokens: number
}

/** Snapshot access belongs to the account route; pressure signalling never starts discovery. */
export interface CopilotCompactionPressureCallbacks {
  /** Return the exact owned request's current budget, or undefined when disabled or unavailable. */
  resolve(request: GenerateOptions): CopilotCompactionPressureBudget | undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** Optional public services are not dependencies of the retained development baseline. */
function optionalService(ctx: Context, name: string): unknown {
  return (ctx as unknown as { get(name: string): unknown }).get(name)
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Request a stock overflow reduction before sending an estimated over-budget
 * conversation. The loop has already logged and frozen this exact request;
 * only its owner can rebuild it after a durable compaction. Never rewrite the
 * request, invoke compaction concurrently, or intercept auxiliary summaries.
 * @param ctx - Host context owning the reversible stream listener.
 * @param callbacks - synchronous authenticated budget lookup, without discovery.
 * @returns disposer for the listener, also owned by its Cordis context.
 */
export function installCopilotCompactionPressure(
  ctx: Context,
  callbacks: CopilotCompactionPressureCallbacks,
): () => void {
  let warned = false
  const unavailable = (): void => {
    if (warned) return
    warned = true
    try {
      if (typeof ctx.logger?.warn === 'function') {
        ctx.logger.warn('COPILOT_COMPACTION_PRESSURE_UNAVAILABLE: optional request measurement or stock automatic recovery is unavailable; retaining the native request budget guard.')
      }
    } catch (_error) {
      // A diagnostic sink must not turn optional pressure support into a request failure.
    }
  }

  const pressureFailure = (request: GenerateOptions): StreamChunk | undefined => {
    if (!isAgentLoopRequest(request) || request.purpose !== undefined
      || request.provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID
      || request.sessionId === undefined || request.signal?.aborted) return undefined
    if (!isPluginPreviewProvider(ctx, request.provider)) return undefined

    const agents = object(ctx.get('agents'))
    if (typeof agents?.currentInitiator !== 'function') {
      unavailable()
      return undefined
    }
    const owner = currentSearchInitiator(ctx)
    if (owner === undefined || owner.session.id !== request.sessionId) return undefined
    if (typeof owner.session.requestHeader !== 'function') {
      unavailable()
      return undefined
    }
    const header = owner.session.requestHeader()
    if (header === undefined || !callConfigEquals(header.config, request)) return undefined
    const budget = callbacks.resolve(request)
    if (budget === undefined || !positiveInteger(budget.inputBudgetTokens)) return undefined

    // These are public BasicCompactionEngine configuration leaves, not a second
    // service registration or private access to its recovery counters.
    const compaction = object(optionalService(ctx, 'compaction'))
    const config = object(compaction?.config)
    if (config?.auto === false) return undefined
    if (config?.auto !== true || typeof compaction?.compactIfNeeded !== 'function') {
      unavailable()
      return undefined
    }
    const policy = Array.isArray(config.modelPolicies)
      ? object(config.modelPolicies.find((value: unknown) => {
        const candidate = object(value)
        return candidate?.provider === request.provider && candidate.model === request.model
      }))
      : undefined
    const retries = policy?.maxOverflowRetries ?? config.maxOverflowRetries
    if (retries === 0) return undefined
    if (!positiveInteger(retries)) {
      unavailable()
      return undefined
    }

    const meter = object(optionalService(ctx, 'tokenMeter'))
    if (typeof meter?.measure !== 'function') {
      unavailable()
      return undefined
    }
    const measured = object(meter.measure(owner.session))
    const tokens = measured?.totalTokens
    if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0) {
      unavailable()
      return undefined
    }
    if (tokens <= budget.inputBudgetTokens) return undefined
    return {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          code: CONTEXT_WINDOW_EXCEEDED_CODE,
          message: `Copilot local estimated input budget exceeded (${tokens} estimated tokens > ${budget.inputBudgetTokens} budget tokens); requesting stock compaction before provider dispatch.`,
        },
      },
    }
  }

  return ctx.on('llm/stream', (request, next) => {
    let failure: StreamChunk | undefined
    try {
      failure = pressureFailure(request)
    } catch (_error) {
      // Optional snapshot/meter drift must not throw from middleware or expose
      // request/credential data. The route's final native guard remains in force.
      unavailable()
    }
    if (failure === undefined) return next()
    const terminal = failure
    return (async function* (): AsyncGenerator<StreamChunk> {
      // Iteration can begin after cancellation, even when the synchronous
      // pressure snapshot was taken while the request was still live.
      if (request.signal?.aborted) {
        yield {
          type: 'finish',
          reason: {
            kind: 'aborted',
            failure: { code: 'ABORTED', message: 'Copilot request cancelled before provider dispatch.' },
          },
        }
        return
      }
      yield terminal
    })()
  }, { prepend: true })
}
