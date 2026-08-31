# dsh-web-search-provider

[![npm version](https://img.shields.io/npm/v/dsh-web-search-provider)](https://www.npmjs.com/package/dsh-web-search-provider)

为 Deepseek Harness 引入基于模型供应方服务器能力的**网络搜索支持**。

本插件使用时要求模型供应方使用 **OpenAI Responses API** 或 **Anthropic 兼容 Messages API** ，**同时提供网络搜索能力**。

> [!TIP]
> Anthropic 兼容 Messages API 仅提供了搜索能力，而 OpenAI Responses API 则支持在查看 URL 对应网页内容/从 URL 对应网页查找特定内容。**推荐使用 OpenAI Responses API 供应方**。

> [!TIP]
> 经实测，Deepseek 官方 Messages API（即 DSH内置的 Deepseek 供应方）、OpenCode Go Messages API、OpenCode Go Response API 和某 OpenAI 中转站 Response API 均能与本插件配合工作。

> [!WARNING]
> DSH 内置的 OpenCode Go 供应方对不同模型使用的 API 类型不同。如对于其提供的 Deepseek V4 Flash/Pro 模型，如期望使用本插件提供的能力，需要手动添加 Response / Message API 类型的自定义供应方。

> [!WARNING]
> 部分模型供应方对本插件使用的网络搜索能力可能进行额外收费。

本插件不通过 Deepseek Harness 内的 `web_search` 工具提供支持，因而你可以将本插件与其它 web search provider 插件（如内置的 `web-search-deepseek`）配合使用。

## 比较 web-search-deepseek

> TL;DR 本插件相比 `web-search-deepseek` ，在消耗词元、消耗时间上均有明显优势。

`web-search-deepseek` 是 Deepseek Harness 内置的搜索插件，当会话中模型调用 `web_search` 工具时，其会在内部新建一个会话进行搜索，并返回若干个网址及其内容摘要。

本插件相比 `web-search-deepseek` ， 会话中 AI 直接向服务器发起网络搜索请求，**单次搜索速度更快**。同时，模型可以直接查看/搜索网页内容（仅 **OpenAI Responses API** 支持），减少 AI 为了查看网页所有内容，使用 bash/curl 消耗的词元。


使用 Deepseek 官方 Messages API 的 `deepseek-v4-flash model with high think` ，分别使用两个插件，每次进行5次指定的搜索，测试十次：

| 插件                  | 平均消耗词元 | 平均消耗时间 |
|:-------------------:|:------:|:------:|
| web-search-deepseek | 4,446  | 47.5s  |
| **web-search-provider** | **822**    | **14.5s**  |

消耗时间统计自 Deepseek Harness 中显示的回答耗时。消耗词元统计自 Deepseek 开放平台取"输出"词元平均数，通过使用两个不同的 API 令牌（因为 Deepseek Harness 不统计工具调用内消耗的词元）。

测试结果仅供参考。在需要更多网络搜索内容的任务中，预期本插件有更明显的优势。

## 安装
```sh
dsh plugin add dsh-web-search-provider
```

### Cloga DSH Windows/Copilot 部署基线

分支版本 `0.2.3-cloga.4` 是部署基线，并非上游正式版本；这些修复的长期归属仍是
上游。使用方必须同时锁定 PR commit 与生成的
`dsh-web-search-provider-0.2.3-cloga.4.tgz`，不能只用包名识别构建。

从锁定的 commit 构建 tarball，并在安装器旁保存 commit 与压缩包 SHA-256：

```sh
git checkout <pinned-commit>
pnpm install --frozen-lockfile
pnpm verify:baseline
pnpm test
pnpm typecheck
pnpm build
pnpm pack --pack-destination artifacts
git rev-parse HEAD
```

每个 tarball 都导出 `./deployment-baseline.json`。安装器必须验证：
`schemaVersion` 为 `1`，`baseline.id` 为
`cloga.dsh-windows-copilot.web-search`，`package.version` 为
`0.2.3-cloga.4`，`supportedBaselines.dsh.release` 为 `0.1.1-rc.2`，
`supportedBaselines.dsh.developmentRelease` 为 `0.1.2-alpha.2`，并且以下能力
ID 均存在且为 `required: true`：
`responses-replay-item-id-normalization`、`grounded-sandbox-escalation`、
`image-attachment-bypass`、`failure-safe-copilot-model-catalog`、
`orphaned-replay-item-filtering`、`traditional-search-compatibility-bridge`、
`nonempty-reasoning-blocks` 与 `settings-provider-instance-api`；
否则应拒绝安装。源码 checkout 可运行
`pnpm verify:baseline`，同时校验包导出、源码标记和具名测试。

------

或从源代码安装：
```sh
pnpm install
```

在 `cordis.yml` 覆盖层中引用构建后的插件：

```yaml
- insert:
    - id: web-search-provider
      name: 'dsh-web-search-provider'
      config:
        enabled: true
        probe: true
```

## 配置

设置段 `web-search-provider`（实时命名空间：改动对下一次请求生效）。除注明外所有字段均可选。

插件还会注册仅搜索的 `ctx.web` provider `copilot-hosted`，复用相同且已验证的
OpenAI Responses 路由、凭证与超时设置。安装其他搜索 provider 时，请在
`@deepseek-ai/dsh-web` 服务中配置 `searchProvider: copilot-hosted`。该插件不会
注册 fetch provider。

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` 时所有请求走普通适配器路径。 |
| `providers` | `[]` | Provider 白名单（llm-pi-ai 路由键）。请求的 provider 必须是当前聊天路由（计划从该路由推导端点事实）才会被服务；白名单只限制该路由中哪些 provider 可被服务。空 = 服务当前聊天路由。 |
| `baseURL` | 路由 | 路由候选的端点基址覆盖；追加 `/responses` 或 `/messages`。 |
| `model` | loop 模型 | 模型覆盖；探测和实际 wire 请求都使用它。 |
| `apiKeyEnv` | 路由引用 | 每次操作经凭证引用解析。 |
| `includeSources` | `true` | 向 Responses wire 请求追加 `include: ['web_search_call.action.sources']`。 |
| `stripServerTools` | `true` | 从 wire 工具中剔除函数工具变体（`web_search`/`open_page`/`find_in_page`）。 |
| `idleTimeoutMs` | `300000` | 单次 inline 请求的空闲上限（毫秒）。 |
| `probe` | `true` | 服务前用一次有界请求验证端点确实执行原生搜索。 |
| `probeTimeoutMs` | `30000` | 单次探测请求的上限（毫秒）。 |

```yaml
- id: web-search-provider
  name: 'dsh-web-search-provider'
  config:
    enabled: true
    probe: true
```

### 可选模型目录同步

拥有 OpenAI 兼容 provider 配置的宿主可以调用
`synchronizeOpenAICompatibleModelCatalog()`，从 `/v1/models` 刷新可选择模型。
该辅助函数同时支持标准 OpenAI 列表和更丰富的 Copilot 元数据；只有可选元数据
明确表示模型被禁用、不显示在选择器中、不是聊天模型、不支持工具调用，或只支持
非交互端点时，才会过滤该模型。存在相应元数据时，它还会映射视觉、上下文窗口、
最大输出和推理能力。

该辅助函数具有失败保护：把 provider 的静态目录作为 `fallback` 传入后，任何网络、
HTTP、JSON 或校验失败都会原样返回该 fallback。它不会修改 `llm-pi-ai` 设置。本插件
只消费该命名空间，并不拥有它；provider/设置集成需要自行决定何时以及如何持久化
成功结果。

```ts
import { synchronizeOpenAICompatibleModelCatalog } from 'dsh-web-search-provider'

const models = await synchronizeOpenAICompatibleModelCatalog({
  baseURL: provider.baseURL,
  fallback: provider.models,
  headers: provider.headers,
})
```


## 已知限制

- 包含图片附件的请求会原样绕过本插件的自定义 wire，由 Deepseek Harness 官方的视觉/附件通道继续处理。
- 对于使用 Response API / Message API **但不提供搜索能力**的供应方，在**首次使用时会话会报错**。继续发送消息/新开会话即可在无本插件能力的同时继续使用 DSH。
- AI 使用本插件提供的网络搜索能力时，**无显示搜索调用 UI**。可能的使用表现为多端连续的思考内容，段思考尾部包含“*Let me make search queries*” 等字样。 

## 参与贡献

### 编译
```sh
pnpm install
pnpm build        # tsc 产出 lib/types，tsdown 打包 lib/index.js
pnpm test         # vitest 单元测试
```
