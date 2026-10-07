import { describe, expect, it } from 'vitest'
import type { AccountModelDescriptor } from '../src/account-model-catalog.ts'
import { imageInputFailure } from '../src/image-input-admission.ts'

const model: AccountModelDescriptor = {
  id: 'fixture-vision', name: 'Fixture vision', api: 'openai-responses',
  contextWindow: 128_000, maxTokens: 16_000, input: ['text', 'image'],
  reasoning: { advertisedEfforts: [], unmappedEfforts: [] },
  evidence: {
    endpoints: ['/responses'], unsupportedEndpointCount: 0, selectedEndpoint: '/responses',
    apiSource: 'advertised-priority', policySource: 'server-enabled',
    contextWindowSource: 'max_context_window_tokens', visionMediaTypes: ['image/png', 'image/jpeg'],
  },
}

describe('projected image admission', () => {
  it.each(['user', 'toolResult'])('checks actual %s image MIME before dispatch', role => {
    const messages = [{ role, content: [{ type: 'image', mimeType: 'image/webp', data: 'synthetic' }] }]
    const before = structuredClone(messages)
    expect(imageInputFailure(model, messages)).toBe('COPILOT_IMAGE_MEDIA_TYPE_UNSUPPORTED')
    expect(messages).toEqual(before)
  })

  it('accepts projected JPEG even when the durable image or filename was WebP', () => {
    expect(imageInputFailure(model, [
      { role: 'user', content: [{ type: 'image', mimeType: 'image/jpeg', data: 'synthetic' }] },
    ])).toBeUndefined()
  })

  it('does not invent a format restriction when the account omits its list', () => {
    const { visionMediaTypes: _formats, ...evidence } = model.evidence
    expect(imageInputFailure({ ...model, evidence }, [
      { role: 'user', content: [{ type: 'image', mimeType: 'image/webp' }] },
    ])).toBeUndefined()
  })

  it('rejects missing or malformed native MIME without leaking image data', () => {
    for (const mimeType of [undefined, '', 'application/pdf', 'image/png;bad', 1]) {
      expect(imageInputFailure(model, [{ content: [{ type: 'image', mimeType, data: 'private' }] }]))
        .toBe('COPILOT_IMAGE_MEDIA_TYPE_UNAVAILABLE')
    }
  })

  it('requires vision for actual images and ignores text, files and tool arguments', () => {
    const textOnly = { ...model, input: ['text'] as const }
    expect(imageInputFailure(textOnly, [{ content: [{ type: 'image', mimeType: 'image/png' }] }]))
      .toBe('COPILOT_IMAGE_INPUT_UNSUPPORTED')
    expect(imageInputFailure(textOnly, [{ content: [
      { type: 'text', text: 'image.webp' }, { type: 'file' },
      { type: 'toolCall', arguments: { type: 'image' } },
    ] }])).toBeUndefined()
  })
})
