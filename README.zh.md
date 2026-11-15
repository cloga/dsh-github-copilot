# dsh-github-copilot

[![CI](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cloga/dsh-github-copilot)](https://github.com/cloga/dsh-github-copilot/releases)
[![License](https://img.shields.io/github/license/cloga/dsh-github-copilot)](./LICENSE)

[English](./README.md) | **简体中文**

为 DeepSeek Harness（DSH）接入当前 GitHub Copilot 账号可用的模型。插件复用
DSH 的 GitHub Copilot OAuth 和已发布的模型适配器，不新增登录、模型 wire、
静态目录或 AgentLoop。

**仅在插件内实现：**所有改动都遵循 plugin-only 边界，且只能使用已发布的
DSH 公共 API。插件不会修改、补丁化、重建或替换 DSH Core 及其依赖制品。

## 范围与所有权

- DSH 负责应用认证、模型选择、Auto、工具、Web、子代理、权限、历史、
  上下文管理和 Usage。
- 父子代理关系、继承与调度遵循 DSH 原生行为。插件只增加模型，
  不新增自己的子代理或子代理账号策略。
- 插件负责接入 GitHub Copilot 授权、发现授权账号可用的模型及能力，并通过
  已发布的原生适配器组合经验证的 Copilot 专属兼容处理。
- 保留 GitHub Copilot 账号额度展示；它与 DSH 原生 token Usage 分开计算。
- 原生子代理选择并实际调用账号可用的 Copilot 模型是必需的兼容目标。
  仅在选择器显示模型不算验证通过。端点或能力元数据缺失／不完整时必须明确失败，
  不得猜测。
- HydraFusion 与 HydraFusion Max 不在范围内。插件不检查 DeepSeek 凭据，
  不静默切换 provider，也不把失败的 Copilot 请求重试到其它 provider。

当前候选版仍挂载旧规划／执行角色兼容逻辑和可选恢复、诊断功能；有价值的增强
会保留，仅对明确不必要的功能进行退役。这些不是独立的子代理运行时。

预期使用环境是正常配置的 DSH 应用，使用其既有 DeepSeek 能力，并额外授权
GitHub Copilot 模型。插件不会读取或强制检查用户的 DeepSeek 账号状态。

## 兼容状态

当前版本线的目标是官方 DSH `0.2.2-rc.3`。源码 checkout 或待发布的版本映射
不能证明资格验证或发布已完成。安装前请确认精确版本已通过必要门禁，且
Release 与 npm 制品均已发布。已发布、已安装、已加载是不同状态。

插件 `0.1.0-alpha.14.dsh.0.2.2.rc.3` 已通过 Windows/Linux 源码及已发布制品
[CI](https://github.com/cloga/dsh-github-copilot/actions/runs/43691055529)，
并已发布到 GitHub Releases 和 npm。这不代表 Desktop 制品、安装、加载或供应商
实时调用已验证。

可在经过验证的源码 checkout 中，用只读的精确 Core 选择器检查发布映射：

```sh
node scripts/select-core-release.mjs 0.2.2-rc.3
```

选择器只检查 Release／npm 元数据和指定资产；不会运行 CI、校验下载字节，
也不会验证 Desktop 已加载。安装建议还需单独核实这些证据。参见
[版本选择与分发](./docs/npm-distribution.md)和
[模型兼容验收标准](./docs/model-compatibility-acceptance.md)。

## 使用

精确兼容版本发布且通过验证后，在空目录下载原始制品并校验：

```sh
curl -fLO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.20.dsh.0.2.2.rc.3/dsh-github-copilot-0.1.0-alpha.20.dsh.0.2.2.rc.3.tgz
curl -fLO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.20.dsh.0.2.2.rc.3/SHA256SUMS
sha256sum --check SHA256SUMS
```

例如安装到 `web` profile：

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.20.dsh.0.2.2.rc.3/dsh-github-copilot-0.1.0-alpha.20.dsh.0.2.2.rc.3.tgz
```

请明确选择目标 profile，然后：

1. 打开**设置 → 模型**；如果尚未配置原生 GitHub Copilot provider，请先添加。
   插件不会自动创建此 profile。
2. 在 GitHub Copilot 账号面板中使用 GitHub 登录。
3. 在 DSH 原生模型选择器中选择该账号实际可用的 Copilot 模型。
4. 子代理使用 DSH 原生模型选择流程；兼容范围以账号公布且经过测试的协议能力为准。

无需手工定义 Copilot 模型、粘贴 token、使用外部网关或安装
`copilot2api`。账号登录成功不代表所有模型及其能力都可用。
插件不再注册第二个 `github-copilot-preview` 模型 provider。
自动发现的账号模型元数据可用于显式审核后同步到原生 `github-copilot` 模型列表；
仅发现元数据不会更改原生目录或模型选择。

如需在已配置的原生 provider 中选择当前已验证账号的启用模型 ID，请打开
**Manage → Model preferences**，查看显示的新增、更新、移除以及原生目录未收录的 ID，
然后选择 **Sync models**。页面使用当前已验证的账号快照准备这些信息，不强制
重新发现；如果快照不可用，请使用 **Refresh models**。此显式单次快照只通过
Settings CAS 和回读替换 `llm-pi-ai.providers.github-copilot.models`。
提交的列表包含账号中所有启用模型的 `{ id }` 引用，不再与原生内置目录取交集。
成功保存的列表在卸载或停用插件后仍然保留。容量、协议、图像能力和推理控制
交由原生解析，不再复制或认证账号元数据中的能力。
账号输入上限、图像格式或推理元数据的差异不再成为排除模型的条件。
原生目录未收录的 ID 只做提示，不会跳过；如果原生无法解析某个模型的协议，
原生设置校验可能拒绝整次更新。插件不会猜测协议或自动更改路线 API 来绕过拒绝。
失败写入不会显示为成功，请检查已保存设置后再重试。
**同步会用原生定义替换已有的模型自定义参数，包括单次请求输出默认值。**
确认前请检查更新和移除项。路线级设置保持不变。这只是模型列表选择，不代表供应商
兼容性已经验证，也不会强制执行账号特有的限制；传输、校验和错误处理仍由原生拥有。
原生 provider 存在自定义认证、端点、请求头、非空模型覆盖或无法验证的
路线兼容性覆盖时，同步会停止，不会修改这些设置。已有的 `compat.supportsStrictMode: false`
会保留，但至少一个同步模型必须使用支持该设置的 Responses 或 Completions 协议。已有的
原生默认推理级别会保留并交由原生解析。仅含 ID 的条目不添加模型级 `maxTokens`
请求默认值。同步不修改凭据、选择或历史，也不会自动
跟随后续账号变化。

在原生 GitHub Copilot 账号面板的 **Manage → 账号管理 → 切换** 中选择账号，
会将该账号应用到 DSH canonical 凭据槽 `llm-pi-ai/github-copilot`，供此 profile
后续的原生请求使用。首次切换会将原有原生 OAuth 授权保留为已保存账号。
切换不会重定向正在进行的请求，也不会更改模型选择、provider 设置或历史。
原生 provider 的内置/配置模型目录不会因此按账号权限过滤。插件不再添加单独的 Copilot
模型路线。已有的 `github-copilot-preview` 选择不会自动迁移，可能变为不可用；已保存的设置和
对话历史保持不变。旧 preview 路线专用的 Session 账号覆盖和续接控件不适用于原生模型请求；
旧的“新 Session 续接默认项”不再显示，已有设置会保留。
启动插件或完成登录时，不会自动修复原生 provider 设置。
插件在 DSH 现有 Web 服务中注册可选的 `github-copilot-hosted` 搜索后端。
请在原生 Web 设置中明确选择，并按需启用原生搜索工具；安装不会改变默认后端。
搜索只使用 canonical OAuth 账号，以及原生配置目录与当前账号元数据共同支持的模型。
在 **插件 → dsh-github-copilot → 详情 → Copilot search model** 中可选择“Automatic”（默认）
或指定一个符合条件的模型。打开或重新加载此控件会获取账号模型元数据，可能刷新原生 OAuth；
元数据本身不证明支持搜索。如果指定模型不再符合条件，搜索会明确失败，不会自动换模型。
每次先发送一个固定能力探测，证明可用后才发送一次用户查询；两者均可能产生费用。
自定义端点、凭据或传输覆盖，以及无法确认的模型，保持不可用。没有自动换模型重试、
Web 服务替换或旧插件路由 UI。
原生 Auto reviewer 的 Copilot Responses 请求只有在资格验证通过时才会省略 `temperature`；
普通聊天和原生 allow/deny/error/cancel 行为不变。即使插件解析到另一份 pi-ai，
资格判断也使用原生适配器的目录；无法确认协议时仍不可用。
原生 Schema 自动生成的空 `chatTemplateKwargs`／`chatTemplateArgs` 映射及布尔型
`supportsStrictMode` 不会使路线失去资格，逐模型配置也遵守同一规则；其他兼容覆盖仍不获准。
无须改写设置来删除 Schema 默认值，也不应通过关闭审核或搜索能力探测来绕过故障。
CI 验收和 Desktop 实际加载属于不同证据层级。参见
[审核兼容说明](./docs/auto-review-sampling.md)。

截至 alpha.12 的插件发布版本可能错误拒绝 DSH schema 默认兼容性映射，
使原生托管搜索及 reviewer 省略 temperature 的资格验证失败
（[#483](https://github.com/cloga/dsh-github-copilot/issues/483)）。
alpha.13 发布版本修复了该资格判断；实际运行状态仍需单独核实。
注册成功或存在模型元数据不代表这两项能力实际可用。

原生路线的额度和可选身份显示只使用 canonical OAuth 账号；如果 provider 指定了其他凭据、
端点或非空请求头，或无法确认其配置，则显示额度不可用，不会将其他账号的额度归到原生路线。
这不证明单次请求实际计费的账号。
原生 provider 的已完成轮次也会记录账号证据，但仅在对应请求实际返回原生流数据后记录。
记录的是绑定到 canonical 凭据的 profile 全局账号，不是 Session 覆盖、计费归属或子 Agent 汇总。
账号不匹配、原生路线无法确认，或返回数据前凭据发生变化时，账号证据显示未知。
已明确配置的原生模型 ID 即使不在内置目录中，也可用于账号证据；这不证明模型可用，
也不会放宽搜索或 reviewer 的协议资格要求。
证据仅保留在 Host 内存中；更早的历史，以及重启或淘汰后缺失的记录仍显示未知。
原生上下文异常诊断不依赖可选的托管续接服务，也不会替代 DSH 的上下文计量。
Local diagnostics 已移除；现有诊断数据和设置均不改动。若旧版插件重新加载，且原有开关仍开启，
它可能恢复采集。参见[功能退役说明](./docs/plugin-diagnostics.md)。

### 其他可选能力

- 托管路线的 Credits 可为当前 Session 的后续 turn 选择已保存账号。
  [可见历史续接](./docs/session-continuation.md)是明确披露的有损 Responses 策略；
  不会静默为已有 Session 开启，也不会自动发送或重试。
- [分段压缩恢复](./docs/manual-compaction-recovery.md)需要明确选择对应引擎；
  安装插件不会替换 Core 的引擎。
- 托管 Responses gzip 默认关闭。支持 GitHub Enterprise Cloud 租户登录，
  不支持 GHES 和 Enterprise 额度查询。

### 移除增强

卸载插件只撤销插件自己的路线、界面和监听，不删除原生 Copilot 凭据、配置、模型选择或历史。
原生 **GitHub Copilot** 继续使用最近一次明确应用到 canonical 凭据槽的账号。卸载不是退出登录；
显式退出或移除原始授权是另一项操作，会影响原生登录。

已有的 `github-copilot-preview` 模型选择不会自动迁移，可能变为不可用；需要时请显式选择原生模型。
如果 Web 选中了 `github-copilot-hosted`，请先在原生 Web 设置中选择其他可用后端。
卸载不会改写 Web 设置；
保留已缺失的后端会返回 `WEB_PROVIDER_CONFIGURED_MISSING`，不会自动回退。
附加账号管理和插件专属搜索仍然依赖插件；最近选中的原生 OAuth 授权会保留在 DSH canonical 凭据记录中。

Desktop 原生包管理器及其内置 CLI 与独立 profile 的操作约束不同。安装前请阅读
[Desktop CLI 证据](./docs/npm-distribution.md#desktop-bundled-cli-on-official-rc2)及
[独立 profile 维护流程](./docs/npm-distribution.md#controlled-offline-cli-maintenance-for-standalone-profiles)；
rc.2 的证据不能证明 rc.3 的行为。安装不会自动运行预检：
只读的 `scripts/check-search-composition.mjs` 可发现冲突的旧 Web 配置，
但不能证明运行状态。请保留并审查现有 profile 数据；安装和重启均需单独授权。

## 开发与交付

精确开发目标见 `deployment-baseline.json`；修改代码前请阅读
[AGENTS.md](./AGENTS.md)。完整验证及打包／发布门禁由 GitHub Actions 执行。
本地源码检查、合成 fixture、发布、profile 安装和 Desktop 实际加载属于不同的证据层级，
应分别如实报告。
可选的[离线自主性评测工具](./docs/agent-autonomy-evaluation.md)仅分析明确提供的脱敏轨迹，
不会运行或控制 agent。
PR 需要说明文档影响，由 agent 或人工审阅者核实语义准确性和覆盖范围，不额外要求人工审批；
见[贡献指南](./CONTRIBUTING.md#change-workflow)。
提交归因必须用 `Assisted-by` 标记实际使用的工具；不得虚构共同作者身份。

更多行为和验收限制见[账号接入](./docs/copilot-accounts.md)、
[模型兼容](./docs/model-compatibility-acceptance.md)及
[分发说明](./docs/npm-distribution.md)。
