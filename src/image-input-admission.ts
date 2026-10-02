import type { AccountModelDescriptor } from './account-model-catalog.ts'

export type ImageInputFailure = 'COPILOT_IMAGE_INPUT_UNSUPPORTED'
  | 'COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE' | 'COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED'

/** Inspect native projected images, never infer wire formats from durable filenames. */
export function imageInputFailure(
  model: AccountModelDescriptor,
  messages: readonly unknown[],
): ImageInputFailure | undefined {
  for (const message of messages) {
    if (typeof message !== 'object' || message === null || !('content' in message)
      || !Array.isArray(message.content)) continue
    const content: readonly unknown[] = message.content
    for (const block of content) {
      if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'image') continue
      if (!model.input.includes('image')) return 'COPILOT_IMAGE_INPUT_UNSUPPORTED'
      if (!('mimeType' in block) || typeof block.mimeType !== 'string'
        || !/^image\/[a-z0-9!#$%&'*+.^_`|~-]+$/iu.test(block.mimeType)) {
        return 'COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE'
      }
      const allowed = model.evidence.visionMediaTypes
      if (allowed !== undefined && !allowed.includes(block.mimeType.toLowerCase())) {
        return 'COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED'
      }
    }
  }
  return undefined
}
