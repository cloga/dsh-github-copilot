# dsh-github-copilot

[![npm version](https://img.shields.io/npm/v/dsh-github-copilot)](https://www.npmjs.com/package/dsh-github-copilot)

面向 DeepSeek Harness（DSH）`0.1.2-alpha.3` 的单插件 GitHub Copilot 模型与供应方托管搜索集成。

## 安装与登录

```sh
dsh plugin add dsh-github-copilot
```

打开 **Settings → Models**，找到 **GitHub Copilot** 并点击 **Sign in**，然后完成 provider card 展示的 GitHub device-code 流程。插件复用 DSH 内置的 `llm-pi-ai` provider，并通过路径级设置变更创建 reference-free `llm-pi-ai.providers.github-copilot` profile，不会替换其它 provider 设置。

不需要运行 `copilot2api`，不需要填写 gateway URL、placeholder API key 或原始 GitHub token，也不需要安装 `dsh-web-search-provider`。

## 产品行为

- DSH 的 dormant `llm-pi-ai` mount 负责 Copilot 模型 adapter、catalog、OAuth、credential record 和 token refresh。
- 本包只补充 Models provider-card UI、Host-only authorization Remote 和 hosted search。
- 新 profile 会将账号 credential 中的 `availableModelIds` 与当前安装的 pi-ai catalog 取交集。
- Sign out 只删除 `llm-pi-ai/github-copilot` credential；route profile 和其它设置保持不变。
- Hosted search 使用同一 credential record 的刷新结果直接请求 `api.individual.githubcopilot.com`。
- Inline 路径为符合条件的 agent-loop 请求加入供应方原生 web-search tool；`github-copilot-hosted` 通过 `ctx.web` 暴露相同能力。
- 搜索默认 fail closed：当前 route 必须是 `github-copilot`，账号必须允许该模型，模型协议必须支持原生搜索，且 capability probe 必须成功。

仅支持 Chat Completions 的 Copilot 模型仍可通过 DSH 原生 `llm-pi-ai` 使用，但不会宣称 hosted search 可用。

## 职责边界

| 表面 | 负责人 |
|---|---|
| Copilot chat/model transport 与 catalog | DSH `dsh-llm-pi-ai` 与 pi-ai |
| OAuth/device flow 注册 | DSH authorization seam 与 `llm-pi-ai` |
| Credential 存储与刷新 | DSH record `llm-pi-ai/github-copilot` 与 pi-ai |
| Models 登录/状态/登出 UI | 本包 `./client` |
| Browser 到 Host 的授权调用 | 本包 `./remote` 与 Host controller |
| Reference-free route 变更 | 本包通过 DSH settings path mutation |
| Hosted-search probe、inline wire、`ctx.web` bridge | 本包 Host 侧 |
| 模型选择、sandbox、工具、附件与其它 provider | DSH Core |

Credential payload 不会通过 Client Remote。Host adapter 使用 pi-ai 公共 `createModels()` 与 `Models.getAuth()`，刷新仍在 DSH credential-record 的串行 mutation 内完成。

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

- `src/index.ts`：Host 插件组合。
- `src/authorization-controller.ts`：Host authorization/settings bridge。
- `src/copilot-auth.ts`：Host-only DSH credential-record 到 pi-ai refresh adapter。
- `src/client.ts`：Models provider-card UI。
- `src/remote.ts`：Client-safe Typert descriptors。
- `src/current-provider.ts`、`src/plan.ts`：route 投影与 fail-closed 规划。
- `src/probe.ts`、`src/wire*.ts`、`src/traditional-search.ts`：hosted-search transport。
- `lib/`：构建生成的发行物，不要手工修改。

公开入口为 `.`, `./client`, `./remote` 和 `./deployment-baseline.json`。

Peer contract 精确目标是 DSH `0.1.2-alpha.3`。由于配置的 npm registry 尚未发布这些 scoped package，rc.2 dev dependency 只作为编译脚手架；CI 会另外 checkout 精确 alpha.3 commit 并核验本插件依赖的 public seam。

## 构建与验证

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm verify:baseline
pnpm build
pnpm verify:package
pnpm pack --pack-destination artifacts
```

`pnpm verify` 执行完整的 test、typecheck、baseline、build 和 package smoke 路径。仓库不变量与修改工作流见 [AGENTS.md](./AGENTS.md)。
