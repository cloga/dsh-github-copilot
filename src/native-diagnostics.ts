import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { DiagnosticsCollector, DiagnosticsHandle } from './diagnostics-collector.ts'
import type { DiagnosticsOutcome, DiagnosticsReason } from './diagnostics-types.ts'

/** Observe only the public stream boundary, without changing chunks or transport. */
export function observeNativeStream(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>,
  collector: DiagnosticsCollector, warn: () => void): AsyncIterable<StreamChunk> {
  const token = options.provider === 'github-copilot' ? collector.nativeToken() : undefined
  const source = next()
  if (token === undefined) return source
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]()
      let handle: DiagnosticsHandle | undefined
      let started = false
      let settled = false
      let terminal: DiagnosticsOutcome | undefined
      let reason: DiagnosticsReason = 'unknown'
      const safely = (action: () => void) => { try { action() } catch { warn() } }
      const finish = (outcome: DiagnosticsOutcome) => {
        if (settled) return
        settled = true
        safely(() => handle?.finish(outcome, reason))
      }
      const invoke = async (call: () => Promise<IteratorResult<StreamChunk>>, stopping: boolean) => {
        try {
          const result = await call()
          if (!result.done && result.value.type === 'finish') {
            const kind = result.value.reason.kind
            if (kind === 'error') {
              const code = result.value.reason.failure.code
              reason = code === 'AUTH' ? 'NATIVE_LLM_AUTH'
                : code === 'RATE_LIMIT' ? 'NATIVE_LLM_RATE_LIMIT'
                  : code === 'TIMEOUT' ? 'NATIVE_LLM_TIMEOUT'
                    : code === 'CONTEXT_WINDOW_EXCEEDED' ? 'NATIVE_LLM_CONTEXT_LIMIT' : 'unknown'
            }
            terminal = kind === 'stop' || kind === 'tool-calls' ? 'success'
              : kind === 'error' ? 'failed' : kind === 'aborted' && options.signal?.aborted ? 'cancelled' : 'unknown'
          }
          if (result.done) finish(terminal ?? (stopping
            ? options.signal?.aborted ? 'cancelled' : 'interrupted' : 'unknown'))
          return result
        } catch (error) {
          finish(options.signal?.aborted ? 'cancelled' : 'failed')
          throw error
        }
      }
      return {
        [Symbol.asyncIterator]() { return this },
        next(...args: [] | [unknown]) {
          if (!started) {
            started = true
            safely(() => { handle = collector.beginNative(options.purpose === 'auto-review'
              ? 'native-copilot-review' : 'native-copilot-llm', token) })
          }
          return invoke(() => iterator.next(...args), false)
        },
        return: iterator.return === undefined ? undefined
          : (value?: unknown) => invoke(() => iterator.return!(value), true),
        throw: iterator.throw === undefined ? undefined
          : (error?: unknown) => invoke(() => iterator.throw!(error), true),
      }
    },
  }
}
