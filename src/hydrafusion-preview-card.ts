import { createElement } from 'react'
import type { ReactElement } from 'react'
import { nativeCardStyle, nativeCaptionStyle, nativeHeadingStyle, nativeSettingsCss } from './native-settings-style.ts'

/** Build readiness only, never an account entitlement or runtime availability check. */
export function HydraFusionPreviewCard(): ReactElement {
  return createElement('section', {
    'data-dsh-hydrafusion-preview': true,
    'data-copilot-native-ui': true,
    'aria-label': 'HydraFusion integration status',
    style: { ...nativeCardStyle, marginTop: 12, overflowWrap: 'anywhere' },
  },
  createElement('style', null, nativeSettingsCss),
  createElement('h3', { style: nativeHeadingStyle }, 'HydraFusion Research Preview'),
  createElement('p', { style: { margin: '6px 0' } }, 'Not available in this plugin build.'),
  createElement('p', { style: { ...nativeCaptionStyle, margin: '0 0 8px' } },
    'HydraFusion and HydraFusion Max are GitHub orchestration experiences, not ordinary base models. Existing Auto choices are unchanged.'),
  createElement('details', null,
    createElement('summary', null, 'Preview terms and integration limits'),
    createElement('p', null,
      'Research Preview: no SLA; not for production. Usage is billed at the standard rates of the underlying models actually used. The Auto discount does not apply.'),
    createElement('p', null,
      'Choices remain hidden until supported account/runtime descriptors provide exact selection identities and the DSH execution bridge is qualified. There is no account availability check on this page.'),
    createElement('p', null,
      'Qualification starts with fresh tasks using the existing DSH login. Native permissions, tools, history, cancellation and Usage must retain their owners; existing conversations are not imported or flattened.'),
    createElement('p', null,
      'Progress and final-answer details require actual runtime evidence. Outcomes must distinguish unavailable, failed, cancelled and completed-with-fallback. Stop acknowledgement is not proof of idle or whole-run cancellation.')))
}
