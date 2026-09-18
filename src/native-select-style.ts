import type { CSSProperties } from 'react'

// Native popups do not reliably inherit the select's surface. Pair each option's
// opaque surface and foreground using app-theme tokens, not OS theme detection.
// System-color fallbacks keep older hosts without these tokens readable.
const optionStyle: CSSProperties = {
  backgroundColor: 'var(--dsw-alias-bg-layer-1, Canvas)',
  color: 'var(--dsw-alias-label-primary, CanvasText)',
}
const disabledOptionStyle: CSSProperties = {
  ...optionStyle,
  color: 'var(--dsw-alias-label-secondary, GrayText)',
}
const selectStyle: CSSProperties = {
  ...optionStyle,
  width: '100%', minWidth: 0, boxSizing: 'border-box',
  padding: '9px 11px', borderRadius: '9px',
  border: '1px solid var(--dsw-alias-border-l2, ButtonBorder)',
  font: 'inherit',
}
const disabledSelectStyle: CSSProperties = {
  ...selectStyle,
  color: 'var(--dsw-alias-label-secondary, GrayText)',
}

export function nativeSelectStyle(disabled = false): CSSProperties {
  return disabled ? disabledSelectStyle : selectStyle
}
export function nativeOptionStyle(disabled = false): CSSProperties {
  return disabled ? disabledOptionStyle : optionStyle
}
