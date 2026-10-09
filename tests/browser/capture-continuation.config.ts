import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'readme-continuation-capture',
  entry: { continuation: 'continuation-capture-entry.ts' },
  outDir: '../../artifacts/readme-capture',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: false,
  clean: true,
  deps: {
    neverBundle: specifier => specifier === 'react',
    alwaysBundle: specifier => specifier !== 'react',
  },
  outputOptions: {
    entryFileNames: 'continuation.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-github-copilot-continuation-capture", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
