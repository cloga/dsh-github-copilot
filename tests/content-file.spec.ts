/** Tests for Core-aware recursive FileBlock detection. */

import { describe, expect, it, vi } from 'vitest'
import { contentHasFileCompat } from '../src/content-file.ts'

describe('contentHasFileCompat', () => {
  it('uses the official Core contentHasFile helper when available', () => {
    const official = vi.fn(() => true)
    const content = [{ type: 'text', text: 'delegated to Core' }]

    expect(contentHasFileCompat(content, official)).toBe(true)
    expect(official).toHaveBeenCalledOnce()
    expect(official).toHaveBeenCalledWith(content)
  })

  it('recurses through tool-result content for older supported Core releases', () => {
    expect(contentHasFileCompat([{
      type: 'tool-result',
      content: [{ type: 'file', attachment: { attachmentId: 'a', name: 'a.txt', bytes: 1 } }],
    }], undefined)).toBe(true)
  })
})
