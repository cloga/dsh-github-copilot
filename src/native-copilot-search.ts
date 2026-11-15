import type { Context } from '@deepseek-ai/cordis'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { WebError, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { createModels } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createAccountModelSource } from './account-model-source.ts'
import type { AccountModelDescriptor } from './account-model-catalog.ts'
import { createGitHubCopilotCredentialStore, normalizeGitHubCopilotOAuthCredential,
  trustedGitHubCopilotBaseUrl } from './copilot-auth.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY } from './copilot-identity.ts'
import { abortable } from './http.ts'
import { captureNativeCopilot, NATIVE_COPILOT } from './native-copilot-access.ts'
import { copilotPublicHeaders } from './preview-provider.ts'
import { onSettingsNamespaceUpdated, readSettingsNamespace } from './settings-reader.ts'
import { normalizeSearchResponse } from './traditional-search.ts'
import type { NativeCopilotSearchModels } from './native-copilot-search-remote.ts'

const unavailable = () => new WebError('COPILOT_NATIVE_SEARCH_UNAVAILABLE', 'WEB_PROVIDER_UNAVAILABLE')
const failed = () => new WebError('COPILOT_NATIVE_SEARCH_FAILED', 'WEB_PROVIDER_ERROR')
const modelUnavailable = () => new WebError('COPILOT_NATIVE_SEARCH_MODEL_UNAVAILABLE', 'WEB_PROVIDER_UNAVAILABLE')

interface NativeCopilotSearch extends WebSearchProvider {
  models(): Promise<NativeCopilotSearchModels>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    githubCopilotNativeSearch: NativeCopilotSearchController
  }
}

export class NativeCopilotSearchController extends TypertRemoteService {
  constructor(ctx: Context, private readonly provider: Pick<NativeCopilotSearch, 'models'>) {
    super(ctx, 'githubCopilotNativeSearch')
  }

  @Remote
  models(): Promise<NativeCopilotSearchModels> { return this.provider.models() }
}

/** One bounded read; cancellation also releases an uncooperative response reader. */
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.redirected || !response.ok || !response.body) {
    void response.body?.cancel().catch(() => undefined)
    throw failed()
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal)
      signal.throwIfAborted()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > 1024 * 1024) throw failed()
      text += decoder.decode(part.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { void reader.cancel().catch(() => undefined) }
}

function hasSearchEvidence(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || !('output' in value) || !Array.isArray(value.output)) return false
  return value.output.some(item => item !== null && typeof item === 'object'
    && item.type === 'web_search_call' && item.status === 'completed')
}

/** Add only a backend to the existing Web service; never select it or replace native tools. */
export function createNativeCopilotSearch(ctx: Context): NativeCopilotSearch {
  let active = true
  const selected = () => {
    const value = readSettingsNamespace(ctx, 'web')
    return value !== null && typeof value === 'object' && 'searchProvider' in value
      && value.searchProvider === 'github-copilot-hosted'
  }
  const pending = new Map<AbortController, string | undefined>()
  ctx.effect(() => () => {
    active = false
    for (const controller of pending.keys()) controller.abort()
  })
  const revoke = () => { for (const controller of pending.keys()) controller.abort() }
  ctx.on('credentials/record-updated', key => { if (key === GITHUB_COPILOT_CREDENTIAL_KEY) revoke() })
  ctx.on('llm/adapters-updated', revoke)
  ctx.on('llm/models-updated', provider => { if (provider === NATIVE_COPILOT) revoke() })
  ctx.effect(() => onSettingsNamespaceUpdated(ctx, namespace => {
    for (const [controller, owner] of pending) {
      if (owner === namespace || namespace === 'web' || namespace === 'github-copilot') controller.abort()
    }
  }))

  const searchModel = (): string => {
    const config = readSettingsNamespace(ctx, 'github-copilot')
    if (config === null || typeof config !== 'object' || Array.isArray(config)) throw unavailable()
    const value = 'nativeSearchModel' in config ? config.nativeSearchModel : undefined
    if (value === undefined) return ''
    if (typeof value !== 'string' || value.length > 512 || value !== value.trim()
      || /[\p{Cc}\p{Cf}]/u.test(value)) throw modelUnavailable()
    return value
  }

  async function prepare(controller: AbortController, signal: AbortSignal, requireSelection: boolean,
    modelSetting?: string): Promise<{ eligible: AccountModelDescriptor[]; headers: Headers; baseURL: string; check: () => void }> {
    const route = await abortable(captureNativeCopilot(ctx), signal)
    if (!route) throw unavailable()
    pending.set(controller, route.namespace)
    const check = () => {
      signal.throwIfAborted()
      if (!active || requireSelection && (!selected() || searchModel() !== modelSetting)) throw unavailable()
      route.assertCurrent()
    }
    check()
    const store = createGitHubCopilotCredentialStore(ctx)
    const models = createModels({ credentials: store })
    models.setProvider(githubCopilotProvider())
    const credential = await abortable(store.read(NATIVE_COPILOT), signal)
    if (credential?.type !== 'oauth') throw unavailable()
    const auth = await abortable(models.getAuth(NATIVE_COPILOT), signal)
    check()
    if (!auth?.auth.apiKey) throw unavailable()
    const current = await abortable(store.read(NATIVE_COPILOT), signal)
    check()
    const grant = normalizeGitHubCopilotOAuthCredential(current)
    if (grant.access !== auth.auth.apiKey || grant.expires <= Date.now()) throw unavailable()
    const baseURL = trustedGitHubCopilotBaseUrl(auth.auth.baseUrl, grant)
    const apiKey = auth.auth.apiKey
    const headers = new Headers({ ...copilotPublicHeaders(), ...attributionHeaders() })
    for (const [name, value] of Object.entries(auth.auth.headers ?? {})) {
      if (value !== null) headers.set(name, value)
    }
    headers.set('authorization', `Bearer ${apiKey}`)
    headers.set('content-type', 'application/json')
    headers.set('accept', 'application/json')
    headers.set('X-Initiator', 'user')
    headers.set('Openai-Intent', 'conversation-edits')
    const source = createAccountModelSource({
      resolveAuth: async () => ({ apiKey, baseURL,
        accountKey: 'native-canonical-operation', availableModelIds: grant.availableModelIds }),
      assertAuthCurrent: check,
      nativeApis: new Map([...route.models].map(([id, model]) => [id, model.api])),
      headers: copilotPublicHeaders(), timeoutMs: 10000,
    })
    try {
      const catalog = await abortable(source.load({ signal }), signal)
      check()
      const eligible = catalog.models.filter(model => model.api === 'openai-responses'
        && route.models.get(model.id)?.api === 'openai-responses').sort((a, b) => a.id.localeCompare(b.id))
      return { eligible, headers, baseURL, check }
    } finally { source.dispose() }
  }

  return {
    id: 'github-copilot-hosted',
    title: 'GitHub Copilot',
    description: { en: 'Optional Copilot hosted search using the native account. Choose a search model in the Copilot plugin settings. Each search runs a capability probe; both calls may incur supplier charges.',
      zh: '使用原生账号的可选 Copilot 搜索。可在 Copilot 插件设置中选择搜索模型。每次先执行能力探测，两次调用均可能产生供应商费用。' },
    // Never turn a previously unique implicit native backend into an ambiguous set.
    available: () => active && selected(),
    async ready() {
      if (!active || !selected()) return false
      try {
        const signal = AbortSignal.timeout(10000)
        const route = await abortable(captureNativeCopilot(ctx), signal)
        if (!route) return false
        const credential = await abortable(createGitHubCopilotCredentialStore(ctx).read(NATIVE_COPILOT), signal)
        if (!active || credential?.type !== 'oauth') return false
        route.assertCurrent()
        return true
      } catch {
        ctx.logger.warn('github-copilot: COPILOT_NATIVE_SEARCH_READINESS_UNAVAILABLE')
        return false
      }
    },
    async models() {
      if (!active || pending.size >= 4) throw unavailable()
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
      pending.set(controller, undefined)
      try {
        const { eligible, check } = await prepare(controller, signal, false)
        check()
        return { models: eligible.map(model => ({ id: model.id })) }
      } catch {
        throw unavailable()
      } finally {
        controller.abort()
        pending.delete(controller)
      }
    },
    async search(request, callerSignal) {
      if (callerSignal?.aborted) throw new WebError('web search aborted', 'ABORTED')
      if (!active || !selected() || pending.size >= 4) throw unavailable()
      if (typeof request.query !== 'string' || request.query.length > 16384 || request.query.trim().length === 0
        || new TextEncoder().encode(request.query).byteLength > 16384) throw failed()
      const controller = new AbortController()
      const deadline = AbortSignal.timeout(25000)
      const signal = AbortSignal.any([controller.signal, deadline, ...(callerSignal ? [callerSignal] : [])])
      pending.set(controller, undefined)
      try {
        const configured = searchModel()
        const { eligible, headers, baseURL, check } = await prepare(controller, signal, true, configured)
        const model = configured === '' ? eligible[0] : eligible.find(candidate => candidate.id === configured)
        if (!model) throw configured === '' ? unavailable() : modelUnavailable()
        const dispatch = async (query: string, probe: boolean) => {
          check()
          const callSignal = probe ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : signal
          const response = await abortable(fetch(`${baseURL}/responses`, {
            method: 'POST', redirect: 'error', signal: callSignal,
            headers,
            body: JSON.stringify({
              model: model.id, input: [{ role: 'user', content: [{ type: 'input_text', text: query }] }],
              tools: [{ type: 'web_search' }], tool_choice: 'required', stream: false,
              include: ['web_search_call.action.sources'], max_output_tokens: probe ? 64 : Math.min(4096, model.maxTokens),
            }),
          }).then(response => {
            if (callSignal.aborted) { void response.body?.cancel().catch(() => undefined); throw failed() }
            return response
          }), callSignal)
          // json owns the reader even if invalidation wins immediately after headers.
          const body = await json(response, callSignal)
          check()
          if (!hasSearchEvidence(body)) throw unavailable()
          return body
        }
        await dispatch('Probe web search capability.', true)
        const body = await dispatch(request.query, false)
        const result = normalizeSearchResponse(body)
        return { ...result, sources: result.sources.filter(source => {
          try {
            const url = new URL(source.url)
            return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
          } catch { return false }
        }).slice(0, 64), truncated: result.sources.length > 64 }
      } catch (error) {
        if (callerSignal?.aborted) throw new WebError('web search aborted', 'ABORTED')
        if (controller.signal.aborted || !active) throw unavailable()
        if (deadline.aborted) throw new WebError('web search timed out', 'WEB_PROVIDER_ERROR')
        if (error instanceof WebError) throw error
        throw failed()
      } finally {
        controller.abort()
        pending.delete(controller)
      }
    },
  }
}
