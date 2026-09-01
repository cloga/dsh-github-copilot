# dsh-github-copilot

[![npm version](https://img.shields.io/npm/v/dsh-github-copilot)](https://www.npmjs.com/package/dsh-github-copilot)

面向 DeepSeek Harness（DSH）**主 Agent** 的一体化 GitHub Copilot 模型集成。它为 DSH Core 组合 OpenAI 兼容的 GitHub Copilot 网关路由和模型元数据，并保留由模型供应方在同一轮请求中执行的托管搜索。

## 范围与职责边界

本包提供：

- 带 GitHub Copilot 能力元数据的失败保护型 `/v1/models` 发现；
- 可由安装器直接写入的 OpenAI Responses 与 Chat Completions 路由；
- 推理强度、上下文/输出限制以及文本/图片能力映射；
- Responses 托管搜索和传统 `ctx.web` 搜索桥；
- DSH replay item 规范化以及 SSE 到 `StreamChunk` 的兼容转换；
- 启动时 API 兼容性检查和机器可读部署基线。

模型选择、plan/code/tool 模式、工具呈现、sandbox 策略、凭证、官方图片/视觉附件路由和 Desktop Core 选择仍由 DSH Core 负责。带图片的请求会原样绕过托管搜索 wire，交由 Core 官方视觉路由处理。本包明确**不提供 ACP 或 subagent 支持**。

## 兼容范围

- Node.js：`>=22.0.0`
- DSH 正式基线：`0.1.1-rc.2`
- DSH 开发基线：`0.1.2-alpha.3`
- DSH peer 范围：`^0.1.1-rc.2 || ^0.1.2-alpha.2`

插件注册任何 effect 前会运行 `assertDshCompatibility()`；缺失必要 DSH API 时会用明确错误拒绝启动。`pnpm verify:baseline` 还会校验 peer 范围、源码/测试证据、单入口 bundle patch、包导出以及仅主 Agent 的边界。

## 安装

```sh
dsh plugin add dsh-github-copilot
```

Bundle patch 只安装一个入口：

```yaml
- insert:
    - id: github-copilot
      name: dsh-github-copilot
```

## 网关模型路由

运维安装器负责网关发现和设置持久化：

1. 解析网关 `baseURL` 与 `COPILOT_GITHUB_TOKEN` 凭证引用。
2. 以锁定的静态目录作为 fallback 调用 `synchronizeGitHubCopilotModelCatalog()`。
3. 调用 `composeGitHubCopilotProviderRoutes()`。
4. 将返回的 `providers` 合并到 `llm-pi-ai.providers`，不得覆盖其它路由。
5. 通过现有 DSH default-model 服务选择返回的 provider/model。

```ts
import {
  composeGitHubCopilotProviderRoutes,
  synchronizeGitHubCopilotModelCatalog,
} from 'dsh-github-copilot'

const models = await synchronizeGitHubCopilotModelCatalog({
  baseURL: gatewayBaseURL,
  headers: { authorization: `Bearer ${gatewayToken}` },
  fallback: pinnedModels,
})

const { providers } = composeGitHubCopilotProviderRoutes({
  baseURL: gatewayBaseURL,
  apiKeyEnv: 'COPILOT_GITHUB_TOKEN',
  models,
})

settings['llm-pi-ai'].providers = {
  ...settings['llm-pi-ai'].providers,
  ...providers,
}
```

安装器写入的精确路由字段：

| 路由 | `api` | 其它字段 |
|---|---|---|
| `github-copilot` | `openai-responses` | `baseURL`、`apiKeyEnv`、`models` |
| `github-copilot-chat` | `openai-completions` | `baseURL`、`apiKeyEnv`、`models` |

同时支持两个端点的模型会出现在两条路由。目录条目保留 `id`、`name`、首选 `api`、全部 `apis`、`input`、`contextWindow`、`maxTokens`、`reasoning` 和 `reasoningEfforts`。发现失败时原样返回 fallback；辅助函数不会修改 DSH 设置。

## 托管搜索配置

实时设置命名空间为 `github-copilot`：

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 托管搜索总开关。 |
| `providers` | `[]` | 允许的 `llm-pi-ai` 路由 ID；空值跟随当前主 Agent 路由。 |
| `baseURL` | 当前路由 | 搜索端点覆盖。 |
| `model` | 当前模型 | 探测和托管搜索模型覆盖。 |
| `apiKeyEnv` | 当前路由 | DSH 凭证引用。 |
| `includeSources` | `true` | 请求托管搜索来源元数据。 |
| `stripServerTools` | `true` | 删除供应方托管工具的本地函数变体。 |
| `idleTimeoutMs` | `300000` | Inline stream 空闲超时。 |
| `probe` | `true` | 服务前验证原生托管搜索。 |
| `probeTimeoutMs` | `30000` | 能力探测超时。 |

插件还会注册搜索 provider `github-copilot-hosted`。需要时将现有 DSH web 服务的 `searchProvider` 设为该 ID。本包不会注册 fetch provider。

## 从 `dsh-web-search-provider` 迁移

1. 删除旧 `dsh-web-search-provider` bundle/package 入口。
2. 安装 `dsh-github-copilot`，并把 bundle ID 从 `web-search-provider` 改为 `github-copilot`。
3. 将设置命名空间 `web-search-provider` 迁移为 `github-copilot`，字段值保持不变。
4. 将 web `searchProvider` 从 `copilot-hosted` 改为 `github-copilot-hosted`。
5. 新增上述两条 `llm-pi-ai.providers` 路由，并通过 Core 选择 Copilot 模型。
6. 用 `cloga.dsh-github-copilot`、`dsh-github-copilot` 和新归档元数据替换旧基线/包/tarball pin。
7. 删除 ACP/subagent 专用组合；它不属于本包契约。

旧导出 `COPILOT_HOSTED_SEARCH_PROVIDER_ID` 仅作为源码迁移辅助保留；新代码应使用 `GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID`。

## 构建与验证

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm verify:baseline
pnpm build
pnpm pack --pack-destination artifacts
```

每个归档都会导出 `./deployment-baseline.json`。使用方必须锁定源码 commit、tarball 文件名和 SHA-256，并在基线不匹配时拒绝安装。