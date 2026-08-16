import { defineConfig } from 'tsdown'

/**
 * Bundle the TypeScript-emitted entry into one ESM artifact, mirroring the
 * DeepSeek Harness package build: `tsc` (rewriteRelativeImportExtensions)
 * emits `lib/types/*.js` plus declarations, tsdown bundles the entry
 * into `lib/index.js` so `files` ships one runtime file. The build script
 * `rm -rf lib` first, so artifacts of sources deleted since the last build
 * never leak into the package; tsdown itself must NOT clean, because its
 * outDir is also the tsc output it bundles as its entry.
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
