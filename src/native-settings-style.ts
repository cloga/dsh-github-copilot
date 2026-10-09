import type { CSSProperties } from 'react'

// Match the public rc.2 Models/primitive roles without reaching into Core CSS.
export const nativeSettingsStyle: CSSProperties = {
  fontFamily: 'var(--dsw-font-family, system-ui)', fontSize: 14, lineHeight: '22px',
  fontWeight: 400, color: 'var(--dsw-alias-label-primary, CanvasText)', minWidth: 0,
  colorScheme: 'inherit',
}
export const nativeHeadingStyle: CSSProperties = {
  margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 500,
}
export const nativeCaptionStyle: CSSProperties = {
  fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, GrayText)',
}
export const nativeButtonStyle: CSSProperties = {
  appearance: 'none', boxSizing: 'border-box', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', gap: 4, justifySelf: 'start',
  fontFamily: 'var(--dsw-font-family, system-ui)', fontSize: 14, lineHeight: '22px', fontWeight: 400,
  minHeight: 36, padding: '0 14px', maxWidth: '100%', whiteSpace: 'normal',
  overflowWrap: 'anywhere', cursor: 'pointer', color: 'var(--dsw-alias-label-primary, CanvasText)',
  background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l3, ButtonBorder)',
  borderRadius: 'var(--dsw-radius-md, 12px)', colorScheme: 'inherit',
}
export const nativeCompactButtonStyle: CSSProperties = {
  ...nativeButtonStyle, fontSize: 12, lineHeight: '18px', minHeight: 28,
  padding: '0 10px', borderRadius: 'var(--dsw-radius-sm, 8px)',
}
export const nativeInputStyle: CSSProperties = {
  fontFamily: 'var(--dsw-font-family, system-ui)', fontSize: 14, lineHeight: '22px', fontWeight: 400,
  minHeight: 32, padding: '0 10px', boxSizing: 'border-box', minWidth: 0,
  border: '0.5px solid var(--dsw-alias-border-l4, ButtonBorder)',
  borderRadius: 'var(--dsw-radius-md, 12px)', colorScheme: 'inherit',
  background: 'var(--dsw-alias-bg-layer-1, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)',
}
export const nativeCardStyle: CSSProperties = {
  ...nativeSettingsStyle, padding: '12px 14px',
  border: '0.5px solid var(--dsw-alias-settings-card-stroke, ButtonBorder)',
  borderRadius: 'var(--dsw-radius-xl, 20px)',
  background: 'var(--dsw-alias-settings-card-fill, Canvas)',
}
export const nativeSettingsCss = `
[data-copilot-native-ui] :is(h3, strong, th) { font-weight: 500; }
[data-copilot-native-ui] button:not(:disabled):hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-specific-settings-secondary-hover-solid, ButtonFace));
}
[data-copilot-native-ui] :is(button, input, select, textarea, summary, a):focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, Highlight); outline-offset: 2px;
}
[data-copilot-native-ui] :is(button, input, select, textarea):disabled { opacity: 0.4; cursor: not-allowed; }
[data-copilot-native-ui] summary {
  width: fit-content; max-width: 100%; padding: 2px 4px; margin-left: -4px;
  border-radius: var(--dsw-radius-sm, 8px); cursor: pointer;
  font: inherit; font-weight: 500;
  color: var(--dsw-alias-label-secondary, GrayText); list-style: none;
}
[data-copilot-native-ui] summary::-webkit-details-marker { display: none; }
[data-copilot-native-ui] summary::before {
  content: ''; display: inline-block; width: 5px; height: 5px; margin-right: 8px;
  border-right: 1px solid currentColor; border-bottom: 1px solid currentColor;
  transform: rotate(-45deg); transition: transform 120ms ease;
}
[data-copilot-native-ui] details[open] > summary::before,
[data-copilot-native-ui][open] > summary::before { transform: rotate(45deg); }
[data-copilot-native-ui] summary:hover { background: var(--dsw-alias-interactive-bg-hover, ButtonFace); }
@media (prefers-reduced-motion: reduce) {
  [data-copilot-native-ui] summary::before { transition: none; }
}
`
