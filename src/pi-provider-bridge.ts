import type { Provider, AssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'

export type CoreCompatibleProvider = ResolvedPiAiProviderProfile['piProvider']
export type SimpleNativeProvider = Pick<Provider,
  'id' | 'name' | 'baseUrl' | 'headers' | 'auth' | 'getModels' | 'filterModels' | 'streamSimple'>
type CoreStream = ReturnType<CoreCompatibleProvider['streamSimple']>
type PublicCoreStream = Pick<CoreStream, keyof CoreStream>
type PublicNativeStream = Pick<AssistantMessageEventStream, keyof AssistantMessageEventStream>
type Assert<Condition extends true> = Condition

/** Compile-time, bidirectional proof; a future real public event change must fail this gate. */
export type PiStreamPublicCompatibility = [
  Assert<PublicNativeStream extends PublicCoreStream ? true : false>,
  Assert<PublicCoreStream extends PublicNativeStream ? true : false>,
]

/** Retain the same stream object after proving its public surface; only SDK-private nominal identity differs. */
export function coreEventStream(stream: AssistantMessageEventStream): CoreStream {
  const publicStream: PublicCoreStream = stream
  return publicStream as CoreStream
}

/**
 * The published Core adapter consumes streamSimple. Do not pretend its older
 * protocol-specific clients are interchangeable with a newer SDK's clients.
 */
export function coreProviderView(provider: SimpleNativeProvider): CoreCompatibleProvider {
  return {
    ...provider,
    stream: (): never => { throw new Error('COPILOT_MANAGED_ADVANCED_STREAM_UNSUPPORTED') },
    streamSimple: (model, context, options) => coreEventStream(provider.streamSimple(model, context, options)),
  }
}
