import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/fixtures/auto-review-copilot-core.fixture.ts'],
    execArgv: ['--expose-internals'],
  },
})
