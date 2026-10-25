import type { AccountModelDescriptor } from './account-model-catalog.ts'
import packageMetadata from '#package.json' with { type: 'json' }

export type ImageInputFailureCode = 'COPILOT_IMAGE_INPUT_UNSUPPORTED'
  | 'COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE' | 'COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED'

export interface ImageInputFailure {
  readonly code: ImageInputFailureCode
  readonly message: string
  readonly diagnostic: {
    readonly model: string
    readonly projectedMime: string
    readonly allowedMimeTypes: readonly string[] | null
    readonly allowedMimeTypeCount: number | null
    readonly allowedMimeTypesTruncated: boolean
    readonly messageIndex: number
    readonly blockIndex: number
    readonly role: string
    readonly pluginVersion: string
  }
}

const imageMime = /^image\/[a-z0-9!#$%&'*+.^_`|~-]+$/iu

function diagnosticMime(value: unknown): string {
  return typeof value === 'string' && value.length <= 128 && imageMime.test(value)
    ? value.toLowerCase() : 'unavailable'
}

/** Inspect native projected images, never infer wire formats from durable filenames. */
export function imageInputFailure(
  model: AccountModelDescriptor,
  messages: readonly unknown[],
): ImageInputFailure | undefined {
  for (const [messageIndex, message] of messages.entries()) {
    if (typeof message !== 'object' || message === null || !('content' in message)
      || !Array.isArray(message.content)) continue
    const content: readonly unknown[] = message.content
    for (const [blockIndex, block] of content.entries()) {
      if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'image') continue
      const mimeType = 'mimeType' in block ? block.mimeType : undefined
      const allowed = model.evidence.visionMediaTypes
      let code: ImageInputFailureCode
      if (!model.input.includes('image')) code = 'COPILOT_IMAGE_INPUT_UNSUPPORTED'
      else if (typeof mimeType !== 'string' || !imageMime.test(mimeType)) {
        code = 'COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE'
      } else if (allowed !== undefined && !allowed.includes(mimeType.toLowerCase())) {
        code = 'COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED'
      } else continue
      const role = 'role' in message && typeof message.role === 'string'
        && ['user', 'assistant', 'system', 'tool', 'toolResult'].includes(message.role) ? message.role : 'unknown'
      const diagnostic: ImageInputFailure['diagnostic'] = {
        model: model.id.length <= 200 && /^[a-z0-9][a-z0-9._:-]*$/iu.test(model.id) ? model.id : 'unavailable',
        projectedMime: diagnosticMime(mimeType),
        allowedMimeTypes: allowed === undefined ? null : allowed.slice(0, 8).map(diagnosticMime),
        allowedMimeTypeCount: allowed?.length ?? null,
        allowedMimeTypesTruncated: allowed !== undefined && allowed.length > 8,
        messageIndex, blockIndex, role, pluginVersion: packageMetadata.version,
      }
      const explanation = code === 'COPILOT_IMAGE_INPUT_UNSUPPORTED'
        ? 'The selected model does not admit image input.'
        : code === 'COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE'
          ? 'The native projected image MIME is missing or invalid; format compatibility cannot be verified.'
          : 'The native projected image MIME is outside the selected model\'s explicit account-advertised formats.'
      return { code, diagnostic, message: `${code}: Request blocked before selected-model dispatch. ${explanation} `
        + 'History images also count, even on a text-only continuation. '
        + 'Auto checks general image capability, not candidate-specific projected formats. '
        + 'For a subsequent turn, explicitly choose a model whose advertised formats accept this projection, '
        + 'or start a separate text-only Session without the old images. '
        + 'If MIME is unavailable, report this diagnostic; filenames do not establish projected format. '
        + 'No automatic retry or model switch was performed. '
        + `Projected transcript positions are zero-based, not durable history IDs. ${JSON.stringify(diagnostic)}` }
    }
  }
  return undefined
}
