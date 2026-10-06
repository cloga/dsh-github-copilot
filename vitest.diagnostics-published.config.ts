import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/fixtures/diagnostics-*-core.fixture.ts'],
    env: { DSH_CORE_EVIDENCE: 'published-artifact-runtime' },
    testTimeout: 30_000,
  },
})
