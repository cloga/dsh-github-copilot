/** Use Desktop's public v1 navigation handoff instead of WebView popup creation. */
export function externalLinkTarget(): '_self' | '_blank' {
  if (typeof window !== 'undefined' && 'dshDesktop' in window) {
    const desktop = window.dshDesktop
    if (typeof desktop === 'object' && desktop !== null
      && 'protocolVersion' in desktop && desktop.protocolVersion === 1) return '_self'
  }
  return '_blank'
}
