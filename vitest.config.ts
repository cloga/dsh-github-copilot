import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-typert-protocol': resolve('tests/stubs/typert-protocol.ts'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
