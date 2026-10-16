import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/fixtures/alpha4-contracts-core.fixture.ts'],
    passWithNoTests: false,
    execArgv: ['--expose-internals'],
  },
})
