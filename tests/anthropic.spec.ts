/**
 * Unit tests for the Anthropic-compatible Messages adapter: request building,
 * result-block mapping with citation-snippet joining, and strict mode.
 */

import { describe, expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  buildAnthropicSearchBody,
  citationSnippets,
  mapAnthropicResponse,
} from '../src/anthropic.ts'
import type { AnthropicSearchOptions } from '../src/anthropic.ts'
import type { AnthropicResponse, ContentBlock } from '../src/types.ts'

const OPTIONS: AnthropicSearchOptions = {
  baseURL: 'https://api.deepseek.com/anthropic/v1',
  model: 'deepseek-v4-flash',
  apiVersion: '2023-06-01',
  maxTokens: 4096,
  maxUses: 5,
  apiKey: 'key-1',
}

function blocks(...blocks: ContentBlock[]): AnthropicResponse {
  return { content: blocks }
}

describe('buildAnthropicSearchBody', () => {
  it('enables the web_search_20250305 server tool with the configured cap', () => {
    const body = buildAnthropicSearchBody(OPTIONS, 'news') as {
      model: string
      max_tokens: number
      messages: unknown[]
      tools: Array<{ type: string; name: string; max_uses: number }>
    }
    expect(body.model).toBe('deepseek-v4-flash')
    expect(body.max_tokens).toBe(4096)
    expect(body.messages).toHaveLength(1)
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }])
  })
})

describe('citationSnippets', () => {
  it('maps each cited URL to its first excerpt', () => {
    const snippets = citationSnippets([
      { type: 'text', text: 'a', citations: [{ url: 'https://x.example/1', cited_text: 'first' }] },
      { type: 'text', text: 'b', citations: [{ url: 'https://x.example/1', cited_text: 'later' }] },
    ])
    expect(snippets.get('https://x.example/1')).toBe('first')
  })

  it('ignores uncited locations', () => {
    const snippets = citationSnippets([
      { type: 'text', text: 'a', citations: [{ url: '', cited_text: 'x' }, { cited_text: 'y' }, { url: 'https://x.example/1' }] },
    ])
    expect(snippets.size).toBe(0)
  })
})

describe('mapAnthropicResponse', () => {
  it('joins web_search_result items with their citation snippets', () => {
    const result = mapAnthropicResponse(blocks(
      { type: 'text', text: 'summary', citations: [{ url: 'https://x.example/1', cited_text: 'excerpt' }] },
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://x.example/1', title: 'One', page_age: '2 days ago' },
          { type: 'web_search_result', url: 'https://x.example/2' },
        ],
      },
    ))
    expect(result.sources).toEqual([
      { url: 'https://x.example/1', title: 'One', snippet: 'excerpt', publishedAt: '2 days ago' },
      { url: 'https://x.example/2' },
    ])
    expect(result.content).toBeUndefined()
    expect(result.truncated).toBe(false)
  })

  it('dedupes sources by URL across multiple result blocks', () => {
    const result = mapAnthropicResponse(blocks(
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://x.example/1' }] },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://x.example/1', title: 'dup' }] },
    ))
    expect(result.sources).toEqual([{ url: 'https://x.example/1' }])
  })

  it('is strict: no result block means native search did not run', () => {
    const response = blocks({ type: 'text', text: 'an answer from memory' })
    expect(() => mapAnthropicResponse(response)).toThrowError(WebError)
    try {
      mapAnthropicResponse(response)
      expect.unreachable()
    } catch (error) {
      expect((error as WebError).code).toBe('WEB_PROVIDER_ERROR')
    }
  })

  it('skips non-result items inside a result block', () => {
    const result = mapAnthropicResponse(blocks({
      type: 'web_search_tool_result',
      content: [
        { type: 'text', url: 'https://x.example/1' },
        { type: 'web_search_result', url: '' },
        { type: 'web_search_result', url: 'https://x.example/2' },
      ],
    }))
    expect(result.sources).toEqual([{ url: 'https://x.example/2' }])
  })
})
