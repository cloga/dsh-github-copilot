export function importsRuntimePackage(source, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*|\\b(?:import|require)\\s*\\(\\s*)['"]${escaped}(?:\\/[^'"]*)?['"]`, 'u').test(source)
}
