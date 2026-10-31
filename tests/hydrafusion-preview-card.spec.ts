import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HydraFusionPreviewCard } from '../src/hydrafusion-preview-card.ts'

describe('HydraFusion preview readiness', () => {
  it('states build unavailability without implying an account or login failure', () => {
    const html = renderToStaticMarkup(createElement(HydraFusionPreviewCard))
    expect(html).toContain('Not available in this plugin build.')
    expect(html).toContain('HydraFusion and HydraFusion Max')
    expect(html).toContain('Research Preview')
    expect(html).toContain('Existing Auto choices are unchanged.')
    expect(html).not.toMatch(/<(button|input|select|option|progress)\b/)
    expect(html).not.toMatch(/\b(onClick|onChange|aria-busy|role="alert")\b/)
  })

  it('keeps qualification and preview terms behind a collapsed native disclosure', () => {
    const html = renderToStaticMarkup(createElement(HydraFusionPreviewCard))
    expect(html).toContain('<summary>Preview terms and integration limits</summary>')
    expect(html).not.toMatch(/<details[^>]*\bopen\b/)
    for (const text of [
      'no SLA', 'not for production', 'standard rates', 'Auto discount does not apply',
      'exact selection identities', 'existing DSH login', 'fresh tasks',
      'permissions', 'history', 'Usage', 'Stop acknowledgement is not proof of idle',
      'unavailable, failed, cancelled and completed-with-fallback',
    ]) expect(html).toContain(text)
    expect(html).not.toMatch(/\b\d+%|\$\d|setInterval|hydrafusion-max/)
  })
})
