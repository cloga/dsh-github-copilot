import type { CSSProperties } from 'react'

export const composerNoticeStyle: CSSProperties = {
  width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box',
  fontFamily: 'var(--dsw-font-family, inherit)',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)', fontWeight: 400,
  lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
  color: 'var(--dsw-alias-label-secondary, GrayText)', overflowWrap: 'anywhere',
}
export const composerNoticeParagraphStyle: CSSProperties = {
  marginBlock: 8, maxWidth: '38rem',
}
export const composerNoticeButtonStyle: CSSProperties = {
  fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit',
  color: 'var(--dsw-alias-label-primary, CanvasText)', maxWidth: '100%',
  background: 'transparent', border: '1px solid var(--dsw-alias-border-main, GrayText)',
  borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
}
