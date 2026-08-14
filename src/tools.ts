/**
 * The two Responses-only browsing tools: `open_page` and `find_in_page`.
 * They drive the same server-side `web_search` tool the search path uses —
 * `tool_choice` pins the tool and the instruction names the action — so the
 * agent can follow a cited URL and dig into a loaded page without the harness
 * fetching anything itself. The seam's `search()` cannot express these, which
 * is why they exist as tools here. Registration is gated on the plan actually
 * serving the Responses protocol; a tool that is gone is never called.
 * @module dsh-web-search-provider/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ParameterSchemaSpec, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { findInPageInstruction, openPageInstruction, runResponsesSearch } from './responses.ts'
import type { WebSearchAction } from './responses.ts'
import type { NativeSearchProviderHooks } from './provider.ts'
import type { SearchPlan, SearchPlanCandidate } from './plan.ts'

/** The hooks one browsing operation resolves its request through. */
export interface NativeToolsHooks extends NativeSearchProviderHooks {
  /** The plan snapshot for the operation, settled before dispatch. */
  readonly planOf: () => SearchPlan
  /** Cooperative tool-call timeout budget attached to each tool definition. */
  readonly timeoutMs: number
  /** Whether the `open_page` tool is registered. */
  readonly openPage: boolean
  /** Whether the `find_in_page` tool is registered. */
  readonly findInPage: boolean
}

/** Display label for a source: its title, else its hostname. */
function sourceLabel(url: string, title: string | undefined): string {
  if (title !== undefined && title.length > 0) return title
  try {
    return new URL(url).hostname
  } catch {
    // A provider should return a valid URL, but never let a malformed one
    // throw out of pure formatting — fall back to the raw string.
    return url
  }
}

/**
 * Format one browsing result as a model-facing text block: the provider's
 * page summary or matching-passage report, the cited sources, and the
 * standing cite-your-sources instruction.
 * @param result - the seam-shaped search outcome.
 * @returns the formatted text.
 */
export function formatBrowseOutput(result: WebSearchResult): string {
  const parts: string[] = []
  if (result.content !== undefined && result.content.length > 0) parts.push(result.content)
  if (result.sources.length > 0) {
    const lines = result.sources.map((source) => {
      const label = sourceLabel(source.url, source.title)
      return `- [${label}](${source.url})`
    })
    parts.push(`Sources:\n${lines.join('\n')}`)
  }
  parts.push('Cite the relevant URLs above as markdown links in your answer.')
  return parts.join('\n\n')
}

/** Pending-call presentation for both browsing tools. */
function presentBrowseCall(title: string, rawInput: unknown, kind: GenericCallView['kind']): GenericCallView {
  return { card: 'generic', title, kind, rawInput }
}

/** Narrow one tool execution to the Responses protocol before dispatch. */
async function settleResponsesPlan(planOf: () => SearchPlan): Promise<SearchPlanCandidate> {
  const plan = planOf()
  const candidate = await plan.settle()
  if (candidate.protocol !== 'openai-responses') {
    throw new WebError(
      'open_page and find_in_page run only when native search serves the OpenAI Responses API; the active plan serves another protocol',
      'WEB_PROVIDER_UNAVAILABLE',
    )
  }
  return candidate
}

/** Project a seam result into the tools' canonical JSON value. */
function projectResult(result: WebSearchResult): {
  content?: string
  sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>
  truncated: boolean
} {
  return {
    ...result.content !== undefined ? { content: result.content } : {},
    sources: result.sources.map(projectSource),
    truncated: result.truncated,
  }
}

/** Project one source, omitting every absent optional field. */
function projectSource(source: WebSearchSource): {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
} {
  return {
    url: source.url,
    ...source.title !== undefined ? { title: source.title } : {},
    ...source.snippet !== undefined ? { snippet: source.snippet } : {},
    ...source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {},
  }
}

/**
 * Build one browsing tool definition. The output contract mirrors `web_search`
 * (content plus sources) because the underlying server tool produces the same
 * shape; only the instruction and argument schema differ per action.
 * @param hooks - operation hooks and registration flags.
 * @param action - the server-side action this tool forces.
 * @param name - the tool name.
 * @param description - the model-facing description.
 * @param args - the argument schema fields.
 * @param instruction - builds the user-message instruction from parsed args.
 * @param callView - pending-call presentation from parsed args.
 * @returns the tool definition.
 */
function browseTool(
  hooks: NativeToolsHooks,
  action: WebSearchAction,
  name: string,
  description: string,
  args: ParameterSchemaSpec,
  instruction: (input: Record<string, string>) => string,
  callView: (input: Record<string, string>) => GenericCallView,
): ToolDefinition {
  return defineTool({
    name,
    description,
    parameters: args,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                snippet: { type: 'string' },
                publishedAt: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatBrowseOutput(value as WebSearchResult) }],
    },
    timeoutMs: hooks.timeoutMs,
    // Provider reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = args as Record<string, string>
      const candidate = await settleResponsesPlan(hooks.planOf)
      const apiKey = hooks.apiKeyOf()
      const result = await runResponsesSearch(
        {
          baseURL: candidate.baseURL,
          model: candidate.model,
          ...apiKey !== undefined ? { apiKey } : {},
          resolveApiKey: () => hooks.resolveApiKey(candidate.apiKeyEnv),
          apiKeyEnv: candidate.apiKeyEnv,
          maxOutputTokens: candidate.maxOutputTokens,
          ...hooks.recordRequest === undefined ? {} : { recordRequest: hooks.recordRequest },
        },
        { action, text: instruction(input) },
        exec.signal,
      )
      return projectResult(result)
    },
    presentCall: (args) => callView(args as Record<string, string>),
  })
}

/** Validate the argument both browsing tools share: non-blank strings. */
function assertNonBlank(input: Record<string, string>, key: string): void {
  if ((input[key] ?? '').trim().length === 0) throw new Error(`${key} must be a non-empty string`)
}

/**
 * Register the enabled browsing tools and their system-prompt guidance;
 * the returned disposer unregisters everything.
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on dispose.
 * @param hooks - operation hooks, registration flags, and timeout budget.
 * @returns the disposer for all registrations made here.
 */
export function applyNativeTools(ctx: Context, hooks: NativeToolsHooks): () => void {
  const disposers: Array<() => void> = []
  if (hooks.openPage) {
    disposers.push(ctx.tools.register(browseTool(
      hooks,
      'open_page',
      'open_page',
      'Open a specific URL through the model provider\'s server-side web tool and return the page\'s content summary. Use after web_search to read the full content of a cited result.',
      { url: { type: 'string', required: true, description: 'The URL of the page to open.' } },
      (input) => {
        assertNonBlank(input, 'url')
        return openPageInstruction(input['url'] ?? '')
      },
      (input) => presentBrowseCall('Open page', input['url'], 'fetch'),
    )))
  }
  if (hooks.findInPage) {
    disposers.push(ctx.tools.register(browseTool(
      hooks,
      'find_in_page',
      'find_in_page',
      'Search within a specific page for a text pattern through the model provider\'s server-side web tool and report the matching passages. Use after open_page when the page is loaded.',
      {
        url: { type: 'string', required: true, description: 'The URL of the page to search within.' },
        pattern: { type: 'string', required: true, description: 'The pattern or text to search for within the page.' },
      },
      (input) => {
        assertNonBlank(input, 'url')
        assertNonBlank(input, 'pattern')
        return findInPageInstruction(input['url'] ?? '', input['pattern'] ?? '')
      },
      (input) => presentBrowseCall('Find in page', input['pattern'], 'search'),
    )))
  }
  if (disposers.length > 0) {
    disposers.push(ctx.systemPrompt.section({
      name: 'tool:web-search-provider-browse',
      order: 115,
      text: 'Use the open_page tool to read the full content of a specific page the web search cited, and find_in_page to search within a page the server-side web tool already loaded. Cite the relevant URLs as markdown links.',
    }))
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}
