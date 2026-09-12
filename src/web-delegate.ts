import type { Context } from '@deepseek-ai/cordis'
import type { WebRuntime } from '@deepseek-ai/dsh-web'

declare module '@deepseek-ai/cordis' {
  interface Context {
    githubCopilotOriginalWeb: WebRuntime
  }
}

/** Expose the unchanged official service from the bundle's named web isolate. */
export const name = 'github-copilot-web-delegate'
export const inject = ['web']

export function apply(ctx: Context): void {
  ctx.provide('githubCopilotOriginalWeb', ctx.web)
}
