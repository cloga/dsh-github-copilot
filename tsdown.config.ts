import { defineConfig } from 'tsdown'

/**
 * Bundle the TypeScript-emitted entry into one ESM artifact, mirroring the
 * DeepSeek Harness package build: `tsc` (rewriteRelativeImportExtensions)
 * emits `lib/types/*.js` plus declarations, tsdown bundles the entry into
 * `lib/index.js` so `files` ships one runtime file.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
