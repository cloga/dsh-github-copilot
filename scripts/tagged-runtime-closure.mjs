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
  const imageOffload = blocks.findIndex(block => /^        run: pnpm install --frozen-lockfile --filter '@deepseek-ai\/dsh-compaction-image-offload\.\.\.'\s*$/m.test(block))
  if (imageOffload < 0 || imageOffload >= prepare) {
    throw new Error('tagged runtime requires the image-offload dependency closure before preparation')
  }
  if (!/^        working-directory: dsh-upstream\s*$/m.test(blocks[imageOffload])) {
    throw new Error('tagged image-offload closure must be installed in the pinned Core checkout')
  }
  const search = blocks.findIndex(block => /^        run: pnpm install --frozen-lockfile --filter '@deepseek-ai\/dsh-tool-web\.\.\.' --filter '@deepseek-ai\/dsh-web-search-deepseek\.\.\.'\s*$/m.test(block))
  if (search < 0 || search >= prepare) {
    throw new Error('tagged runtime requires the search dependency closure before preparation')
  }
  if (!/^        working-directory: dsh-upstream\s*$/m.test(blocks[search])) {
    throw new Error('tagged search closure must be installed in the pinned Core checkout')
  }
  const compaction = blocks.findIndex(block => /^        run: pnpm install --frozen-lockfile --filter '@deepseek-ai\/dsh-agent-loop\.\.\.' --filter '@deepseek-ai\/dsh-compaction-basic\.\.\.'\s*$/m.test(block))
  if (compaction < 0 || compaction >= prepare) {
    throw new Error('tagged runtime requires the compaction dependency closure before preparation')
  }
  if (!/^        working-directory: dsh-upstream\s*$/m.test(blocks[compaction])) {
    throw new Error('tagged compaction closure must be installed in the pinned Core checkout')
  }
  const jobs = blocks.findIndex(block => /^        run: pnpm install --frozen-lockfile --filter '@deepseek-ai\/dsh-jobs-local\.\.\.' --filter '@deepseek-ai\/dsh-commands\.\.\.'\s*$/m.test(block))
  if (jobs < 0 || jobs >= prepare) {
    throw new Error('tagged runtime requires the background jobs dependency closure before preparation')
  }
  if (!/^        working-directory: dsh-upstream\s*$/m.test(blocks[jobs]) || /^        if:/m.test(blocks[jobs])) {
    throw new Error('tagged background jobs closure must run unconditionally in the pinned Core checkout')
  }
  const presets = blocks.findIndex(block => /^        run: pnpm install --frozen-lockfile --filter '@deepseek-ai\/dsh-agent-preset-registry\.\.\.' --filter '@deepseek-ai\/cordis-plugin-group\.\.\.'\s*$/m.test(block))
  if (presets < 0 || presets >= prepare) {
    throw new Error('tagged runtime requires the isolated preset dependency closure before preparation')
  }
  if (!/^        working-directory: dsh-upstream\s*$/m.test(blocks[presets]) || /^        if:/m.test(blocks[presets])) {
    throw new Error('tagged isolated preset closure must run unconditionally in the pinned Core checkout')
  }
  return true
}
