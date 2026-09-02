import { defineConfig } from 'tsdown'
import type { UserConfig } from 'tsdown'

/**
 * Match DeepSeek Harness packages/client/tsdown.client.ts for a standalone
 * package: emit CJS inside the ModuleLoader factory and leave only requested
 * loader-table modules external. The banner/intro/footer are tsdown output
 * configuration, so generated code owns the handoff rather than source code.
 */
function clientBundle(id: string, entry: string): UserConfig {
  const externals = new Set(['react'])
  const isExternal = (specifier: string): boolean => externals.has(specifier)
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isExternal,
      alwaysBundle: specifier => !isExternal(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  clientBundle('dsh-github-copilot', 'lib/types/client.js'),
  {
    entry: ['lib/types/remote.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
