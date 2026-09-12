/** Drift guard for the repository's explicit single-line Core closure steps. */
export function assertTaggedRuntimeClosure(workflow) {
  const normalized = workflow.replaceAll('\r\n', '\n')
  const blocks = normalized.split(/(?=^      - )/m)
  const prepare = blocks.findIndex(block => /^        (?:run: |  )node scripts\/verify-tagged-core\.mjs prepare\b/m.test(block))
  if (prepare < 0) throw new Error('tagged runtime preparation step is missing')
  const closure = blocks.findIndex(block => /^        run: pnpm install --frozen-lockfile --filter '@deepseek-ai\/dsh-api-session-controller\.\.\.'\s*$/m.test(block))
  if (closure < 0 || closure >= prepare) {
    throw new Error('tagged runtime requires the Session/Remote dependency closure before preparation')
  }
  if (!/^        working-directory: dsh-upstream\s*$/m.test(blocks[closure])) {
    throw new Error('tagged runtime closure must be installed in the pinned Core checkout')
  }
  const search = blocks.findIndex(block => /^        run: pnpm install --frozen-lockfile --filter '@deepseek-ai\/dsh-tool-web\.\.\.' --filter '@deepseek-ai\/dsh-web-search-deepseek\.\.\.'\s*$/m.test(block))
  if (search < 0 || search >= prepare) {
    throw new Error('tagged runtime requires the search dependency closure before preparation')
  }
  if (!/^        working-directory: dsh-upstream\s*$/m.test(blocks[search])) {
    throw new Error('tagged search closure must be installed in the pinned Core checkout')
  }
  return true
}
