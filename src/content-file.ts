/** File-content detection shared by the hosted-search preflight. */

import * as dshLlm from '@deepseek-ai/dsh-llm'

/** Structural signature of Core's recursive file-content helper. */
export type ContentHasFile = (content: readonly unknown[]) => boolean

/**
 * Prefer Core's official recursive predicate when the installed release exports
 * it. The structural fallback retains rc.2/rc.1 compatibility and follows the
 * same `tool-result.content` recursion so file context always fails closed.
 */
export function contentHasFileCompat(
  content: readonly unknown[],
  official: ContentHasFile | undefined = (dshLlm as { contentHasFile?: ContentHasFile }).contentHasFile,
): boolean {
  if (official !== undefined) return official(content)
  return content.some((block) => {
    if (typeof block !== 'object' || block === null || !('type' in block)) return false
    if (block.type === 'file') return true
    return block.type === 'tool-result'
      && 'content' in block
      && Array.isArray(block.content)
      && contentHasFileCompat(block.content, undefined)
  })
}
