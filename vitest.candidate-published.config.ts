import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/fixtures/alpha4-contracts-core.fixture.ts',
      ...process.env.DSH_PUBLISHED_CORE_RELEASE === '0.2.1-rc.3' ? ['tests/fixtures/hydrafusion-tool-entry-core.fixture.ts'] : []],
    passWithNoTests: false,
    poolOptions: { forks: { execArgv: ['--expose-internals'] } },
  },
})
