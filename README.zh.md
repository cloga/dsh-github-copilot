# dsh-github-copilot

[![npm version](https://img.shields.io/npm/v/dsh-github-copilot)](https://www.npmjs.com/package/dsh-github-copilot)

面向 DSH Desktop `0.1.1-rc.2` 与 DeepSeek Harness（DSH）`0.1.2-alpha.4` 的单插件 GitHub Copilot 模型与供应方托管搜索集成。

## 安装与登录

```sh
dsh plugin add dsh-github-copilot
```

打开 **Settings → Models**，找到 **GitHub Copilot** 并点击 **Sign in**，然后完成 provider card 展示的 GitHub device-code 流程。插件复用 DSH 内置的 `llm-pi-ai` provider，并通过路径级设置变更创建 reference-free `llm-pi-ai.providers.github-copilot` profile，不会替换其它 provider 设置。

Desktop `0.1.1-rc.2` 尚未提供 Models provider-card 扩展槽，因此登录控件位于独立的 **Settings → GitHub Copilot** 页面；在 `0.1.2-alpha.4` 中，同一组控件直接显示在 GitHub Copilot provider card 内。

不需要运行 `copilot2api`，不需要填写 gateway URL、placeholder API key 或原始 GitHub token，也不需要安装 `dsh-web-search-provider`。

本包会将 `@deepseek-ai/dsh-authorization` 作为运行时依赖安装。Cordis bootstrap 会在只提供 credentials 与 `llm-pi-ai`、但未挂载 authorization 的 rc.2 web/headless profile 中补充该服务；alpha.4 Core 已提供 authorization 时则直接复用，不会重复注册。只有 authorization 与其它全部必需 DSH 服务可用后，主集成才会激活。

## 产品行为

- DSH 的 dormant `llm-pi-ai` mount 负责 Copilot 模型 adapter、catalog、OAuth、credential record 和 token refresh。
- DSH alpha.4 Core 负责 authorization service；仅在 rc.2 等未提供该服务的 profile 中由本包补充。
- 本包只补充 Models provider-card UI、Host-only authorization Remote 和 hosted search。
- 四个 authorization Remote 结果共用一个严格的 Zod v4 codec，因此 rc.2 会验证 status/start/cancel/sign-out view，同时 alpha.4 保持相同 wire contract。
- 登录成功和 Host 启动时都会将账号 credential 中的 `availableModelIds` 与当前安装的 pi-ai catalog 取交集，用于创建或修复 route profile。空、缺字段或过期的 profile 会幂等自愈，包括 Models UI 保存空 provider entry 后的情况；每个模型都写入 catalog `api`，从而在不写 route 级 `api`、`baseURL` 或 `apiKeyEnv` 的情况下保留混合协议。
- Copilot OAuth grant 在写入或复用前，会由 Host adapter 将 pi-ai 文档化字段重建为新的普通 JSON 对象。只要归属字段有效，就可接受跨模块或 null-prototype credential；无关扩展字段会被丢弃，模型 ID 按原顺序去重，归属字段格式错误时也不会在错误中泄露字段值。
- Sign out 只删除 `llm-pi-ai/github-copilot` credential；route profile 和其它设置保持不变。
- Hosted search 使用同一 credential record 的刷新结果直接请求 `api.individual.githubcopilot.com`。
- Inline 路径为符合条件的 agent-loop 请求加入供应方原生 web-search tool；`github-copilot-hosted` 通过 `ctx.web` 暴露相同能力。
- 搜索默认 fail closed：当前 route 必须是 `github-copilot`，账号必须允许该模型，模型协议必须支持原生搜索，且 capability probe 必须成功。Responses probe 仅在有效 2xx 响应缺少 `web_search_call` 时重试，最多按两种受支持拼写执行两轮（共四次请求）；auth、HTTP、响应体格式错误、abort 与网络失败会立即停止，所有尝试共享配置的整段 probe 超时。

仅支持 Chat Completions 的 Copilot 模型仍可通过 DSH 原生 `llm-pi-ai` 使用，但不会宣称 hosted search 可用。

## 职责边界

| 表面 | 负责人 |
|---|---|
| Copilot chat/model transport 与 catalog | DSH `dsh-llm-pi-ai` 与 pi-ai |
| Authorization service 生命周期 | 存在时由 DSH Core 负责，否则由本包的 rc.2 bootstrap 补充 |
| OAuth/device flow 注册 | DSH authorization seam 与 `llm-pi-ai` |
| Credential 存储与刷新 | DSH record `llm-pi-ai/github-copilot` 与 pi-ai |
| Models 登录/状态/登出 UI | 本包 `./client` |
| Browser 到 Host 的授权调用 | 本包 `./remote` 与 Host controller |
| Reference-free route 变更 | 本包通过 DSH settings path mutation |
| Hosted-search probe、inline wire、`ctx.web` bridge | 本包 Host 侧 |
| 模型选择、sandbox、工具、附件与其它 provider | DSH Core |

Credential payload 不会通过 Client Remote。Host adapter 使用 pi-ai 公共 `createModels()` 与 `Models.getAuth()`，刷新仍在 DSH credential-record 的串行 mutation 内完成。严格的 Copilot normalizer 只持久化 `type`、`refresh`、`access`、有限数值 `expires`、可选 `enterpriseUrl` 与可选 `availableModelIds`。

## 设置

`github-copilot` section 只包含 hosted-search 行为：

| 键 | 默认值 | 含义 |
|---|---:|---|
| `enabled` | `true` | 启用 hosted search。 |
| `providers` | `[]` | 可选 route allowlist；空值跟随当前选择。 |
| `includeSources` | `true` | 请求并返回供应方引用。 |
| `stripServerTools` | `true` | 删除 hosted-search tool 的本地 function 变体。 |
| `idleTimeoutMs` | `300000` | Inline stream 空闲超时。 |
| `probe` | `true` | 服务前要求原生 hosted-search 证据。 |
| `probeTimeoutMs` | `30000` | Capability probe 超时。 |

本包不提供 token、API key、model catalog 或 endpoint 设置。

## 迁移

删除旧 Copilot gateway route、`COPILOT_GITHUB_TOKEN` 类 credential reference、`copilot2api` 和 `dsh-web-search-provider`。安装本包后从 **Settings → Models** 登录并选择账号可用的 Copilot 模型；只有显式使用 `ctx.web` 搜索时才需要选择 `github-copilot-hosted`。

## 源码与发行物

- `src/index.ts`：条件式 authorization bootstrap、依赖门控的 Host 组合。
- `src/authorization-controller.ts`：Host authorization/settings bridge。
- `src/copilot-auth.ts`：Host-only DSH credential-record 到 pi-ai refresh adapter。
- `src/client.ts`：Models provider-card UI。
- `src/remote.ts`：Client-safe Typert descriptors 与共享的严格 authorization-view result codec。
- `src/current-provider.ts`、`src/plan.ts`：route 投影与 fail-closed 规划。
- `src/probe.ts`、`src/wire*.ts`、`src/traditional-search.ts`：hosted-search transport。
- `lib/index.js`、`lib/remote.js`：构建生成的 Host/Remote ESM 入口。
- `lib/client.js`：按 DSH 客户端闭包规范生成；通过 `window.__ModuleLoader__.load` 注册 `dsh-github-copilot`，用注入的 `require` 解析 loader-table 外部依赖，并返回 `apply`/`inject`。不要手工修改。

公开入口为 `.`, `./client`, `./remote` 和 `./deployment-baseline.json`。

Peer contract 同时支持 DSH `0.1.1-rc.2` 与 `0.1.2-alpha.4`；authorization 与 Zod v4 都是实际运行时依赖，因此 rc.2 只安装本包即可完整启动并严格验证 Remote 结果。rc.2 的混合协议 route 需要基于 rc.2 tag 的受控 Core commit `a772dbbde82780bff2b9394427e9f0a24cafa1d5`（branch `cloga-pi-ai-model-api`）；原始 tag 尚不能解析 model entry 的 `api`。CI 会分别核验该受控 rc.2 commit 与 alpha.4 commit，并对受控 Core 运行真实 config 接受测试。

## 构建与验证

客户端构建遵循 DSH 标准 `packages/client/tsdown.client.ts` 契约：tsdown 将 CJS 输出封装在 loader factory 中，而不是发布普通浏览器 ESM。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm verify:baseline
pnpm build
pnpm test
pnpm verify:package
pnpm pack --pack-destination artifacts
```

`pnpm verify` 执行完整的 test、typecheck、baseline、build 和 package smoke 路径。仓库不变量与修改工作流见 [AGENTS.md](./AGENTS.md)。
