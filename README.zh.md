# dsh-web-search-provider

为 DeepSeek Harness 的 web 能力接缝（`ctx.web`）提供原生网络搜索的 provider。一个 provider，两种线上协议：

- **OpenAI Responses API** —— `POST {baseURL}/responses`，启用服务端 `web_search` 工具。服务端自行执行完整浏览循环 —— `search` / `open_page` / `find_in_page` 三种 action —— 适配器完整理解这三种 action，以及 `url_citation` / `web_search` / `search_result` 的来源注解词汇。
- **Anthropic 兼容 Messages API** —— `POST {baseURL}/messages`，启用原生 `web_search_20250305` 服务端工具，按现有 `web-search-deepseek` 插件的方式映射 `web_search_tool_result` 块与引文摘录。

与 `include:web-search-deepseek`（仅限 DeepSeek，且不验证端点是否真的执行搜索）不同，本插件探测 harness 当前正在对话的 provider，用一次有界请求**探测**所选端点确实运行原生搜索，无响应时**自动禁用** —— 除非使用者在配置中显式指定协议与端点。

## 选择逻辑

| 配置 | 行为 |
|---|---|
| 设置了 `protocol` | 搜索始终走该协议。`baseURL`、`apiKeyEnv`、`model` 依次回退到当前聊天路由（兼容时）、环境变量（`$DSH_WEB_SEARCH_RESPONSES_BASE_URL` / `$DSH_WEB_SEARCH_ANTHROPIC_BASE_URL`）、DeepSeek 官方默认值。 |
| 未设置 `protocol` | 从默认模型选择（`agent-default-model`）与 `llm-pi-ai` 设置段探测当前聊天路由。路由自身协议可搜索（`openai-responses` / `anthropic-messages`）时走该协议；Chat-Completions 路由的线路上无法搜索，则探测其主机的已知可搜索兄弟协议：DeepSeek 官方（路由 `deepseek` / `deepseek-official`，或 `api.deepseek.com` 主机）依次探测 `openai-responses` 与 `anthropic-messages`；OpenAI 探测 `openai-responses`。未知网关不产生兄弟候选 —— 请显式配置 `protocol`。 |
| 无法解析任何候选 | provider 注册为不可用、不注册任何 tool、启动日志说明原因。 |

探测（默认 `probe: true`）通过 `tool_choice` 强制服务端工具执行，并要求结构化证据返回（`web_search_call` 条目或 `web_search_tool_result` 块）。不少"Responses 兼容"网关会接受 `web_search` 字段却静默忽略 —— 这正是静态协议检查看不到的失效模式。每次探测在 provider 上消耗一次真实搜索，每个计划只跑一次（后台执行，受 `probeTimeoutMs` 约束），设置 `probe: false` 可完全跳过。

## 工具

接缝的 `web_search` 工具（`tool-web`，出厂组合已启用）由本 provider 的 `search()` 在两种协议上提供服务。此外，当计划服务于 Responses API 时，插件注册接缝无法表达的两个浏览工具：

- **`open_page`** —— 通过服务端工具打开指定 URL，返回页面内容摘要。
- **`find_in_page`** —— 在已加载页面内查找模式，返回匹配段落。

因此 Responses-API 部署获得完整的三动作浏览循环：`web_search`（search）、`open_page`、`find_in_page`。两个工具都以计划确实服务于 Responses 协议为前提：探测（或固定配置）落在 `openai-responses` 时注册，否则撤下 —— 已撤下的工具不会被调用。`tools.openPage` / `tools.findInPage` 可分别关闭。

## 安装

```sh
pnpm install
pnpm build        # tsc 产出 lib/types，tsdown 打包 lib/index.js
pnpm test         # vitest 单元测试
```

在 `cordis.yml` overlay 中引用构建产物：

```yaml
- insert:
    - id: web-search-provider
      name: '/absolute/path/to/dsh-web-search/lib/index.js'
      # 全部使用默认值；由当前聊天 provider 决定一切
```

或安装为包后按包名引用。要替换出厂 DeepSeek 搜索，还需把 web 接缝指向本 provider：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: web-search-provider
```

## 配置

所有字段均可选；schema 默认值与当前聊天路由补齐其余部分。

| 键 | 默认值 | 含义 |
|---|---|---|
| `protocol` | 未设置 | 显式协议固定：`openai-responses` 或 `anthropic-messages`。 |
| `baseURL` | 推导 | 端点基地址；追加 `/responses` 或 `/messages`。需要 `protocol`。对 `anthropic-messages`，不含 `/v1` 段的基地址会被补上（`https://api.anthropic.com` → `/v1/messages`）。 |
| `apiKey` | 未设置 | 字面 API 密钥；优先 `apiKeyEnv`，避免密钥进入配置。 |
| `apiKeyEnv` | 路由引用 → `DEEPSEEK_API_KEY` | 每次操作经 `ctx.credentials`（再退回启动环境）解析的凭据引用。 |
| `model` | 路由模型 → `deepseek-v4-flash` | 搜索请求的模型名。 |
| `apiVersion` | `2023-06-01` | `anthropic-version` 请求头值。 |
| `maxTokens` | `4096` | Messages 搜索生成 token 上限。 |
| `maxUses` | `5` | 每次 Messages 请求 `web_search` 服务端工具最大使用次数。 |
| `maxOutputTokens` | `4096` | Responses 搜索生成 token 上限。 |
| `probe` | `true` | 服务前用一次有界请求验证端点确实运行原生搜索。 |
| `probeTimeoutMs` | `30000` | 单次探测请求的时间上限。 |
| `timeoutMs` | `60000` | `open_page` / `find_in_page` 的协作超时预算。 |
| `tools.openPage` / `tools.findInPage` | `true` | 注册仅 Responses 可用的浏览工具。 |

```yaml
- id: web-search-provider
  name: 'dsh-web-search-provider'
  config:
    # 聊天用什么 provider 都行，搜索始终走网关的 Responses API。
    protocol: openai-responses
    baseURL: https://gateway.internal/v1
    apiKeyEnv: GATEWAY_API_KEY
    model: gpt-5.6
    probe: true
```

该段是活跃的用户设置命名空间（`web-search-provider`）：修改无需重启即影响下一次搜索；只有当解析出的候选真正变化时才重新探测；进行中的搜索保持其启动时的计划。

## 发布

推荐走 [npm 可信发布](https://docs.npmjs.com/trusted-publishers)（OIDC）：[发布工作流](.github/workflows/publish.yml) 在 GitHub Actions 中完成发布，仓库内不需要任何 npm token，npm 自动附加 provenance 出处证明（要求公开包 + 公开仓库）。`repository.url` 必须与 GitHub 仓库完全一致。

**首次发布（基于 token）。** 可信发布按包在 npmjs.com 上配置，所以包需要先存在。先用 token 登录并发布一次：

```sh
npm login --registry https://registry.npmjs.org
pnpm publish        # 自动运行 prepublishOnly（测试 + 构建）后发布
```

**配置可信发布者。** 在 npmjs.com：Packages → `dsh-web-search-provider` → Settings → Trusted publishing → GitHub Actions，填写：

| 字段 | 值 |
|---|---|
| Organization or user | `hiyms` |
| Repository | `dsh-web-search-provider` |
| Workflow filename | `publish.yml`（即 `.github/workflows/` 中的文件） |
| Environment | 留空（之后可加 GitHub environment 做审批门禁） |
| Allowed actions | `npm publish` |

npm 保存时不会校验配置 —— 工作流文件名与仓库 URL 大小写敏感、必须完全一致，否则首次发布报 `ENEEDAUTH`。

**后续发布。** 提升 `package.json` 版本号、提交、打 tag、推送：

```sh
pnpm version patch   # 升版本、提交并打 v0.1.1 标签
git push --follow-tags
```

工作流通过 `prepublishOnly` 运行测试与构建，用 OIDC 发布，自动生成 provenance。发布后可验证出处：

```sh
npm attestations dsh-web-search-provider
```

注意：provenance 要求**公开**仓库（私有仓库即使发布公开包也不生成）；只能用 GitHub 托管 runner（暂不支持自托管 runner）；npm CLI 侧的 OIDC 需要 npm ≥ 11.5.1 / Node ≥ 22.14，工作流使用的 Node 24 满足。本地基于 token 的 `pnpm publish` 仍可作为后备，但正常情况下不再需要。

## 失败语义

- provider 失败表现为 `WebError` `WEB_PROVIDER_ERROR`；调用方取消为 `WEB_ABORTED`；缺少凭据为 `WEB_PROVIDER_CREDENTIAL_MISSING` 并指明引用。
- **严格模式**：2xx 响应中缺少 `web_search_call`（Responses）或 `web_search_tool_result`（Messages）即为错误，绝不退化为从散文里刮取 URL。
- 重定向在联系 `Location` 目标之前被拒绝（凭据绝不跟随）。
- 响应读取有 4 MiB 上限；可解析时保留非 2xx 响应的错误消息。
- 每次请求在分发前以无密钥的 `web/search-native-llm-request` 会话事件记入发起 Agent 的会话日志。

## 模型体验

一次独立的辅助模型请求（绝不进入对话上下文）携带查询文本与原生服务端工具定义。Responses 模式把模型回答作为 `content`、引用 URL 作为 `sources` 返回；Messages 模式返回结构化结果块并拼接引文摘录，不信任 `content`。每次搜索产生输入/输出 token；`maxOutputTokens` / `maxTokens` 限制生成输出，`maxUses` 限制服务端工具使用次数。

## 已知限制与后续工作

- **一次搜索消耗一整轮模型调用** —— 延迟加生成 token；两种协议都没有专用检索端点。
- **一次探测消耗一次真实搜索**（完整服务端搜索，约等于一次大输入的价钱），计划每次变化时执行；端点已知可用时可设 `probe: false` 关闭。
- **`open_page` / `find_in_page` 各消耗一轮模型调用**，且确定性受服务端模型限制：`tool_choice` 只固定工具、不固定 action，URL/模式由指令携带。
- **超量来源仍消耗 token** —— 两种线路上都没有结果数旋钮，`maxResults` 只能由接缝事后截断。
- **兄弟协议推导只覆盖已知主机** —— DeepSeek 与 OpenAI 官方端点；其他网关需要显式 `protocol`（及 `baseURL`）。
