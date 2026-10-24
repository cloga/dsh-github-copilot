# dsh-github-copilot

[![CI](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cloga/dsh-github-copilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cloga/dsh-github-copilot)](https://github.com/cloga/dsh-github-copilot/releases)
[![License](https://img.shields.io/github/license/cloga/dsh-github-copilot)](./LICENSE)

[English](./README.md) | **简体中文**

为 DSH 提供 GitHub Copilot 账号模型发现、上下文 Auto 选模和 hosted search。插件复用 DSH 公开的原生适配器，保留 profile 全局默认账号，并支持 Session 后续 turn 指定独立账号；不修改 Core，也不维护第二套模型目录。

**历史稳定版：[`0.4.1`](https://github.com/cloga/dsh-github-copilot/releases/tag/v0.4.1)；DSH rc.3 适配候选：`0.1.0-alpha.1.dsh.0.2.1.rc.3`。** DSH `0.2.1-rc.3` 是预发布版本。本插件线是兼容性候选，不是生产 Core 升级建议；Desktop 制品／签名尚未核验。每个精确 DSH Core 版本都从独立插件序列 `0.1.0-alpha.1.dsh.<Core>` 开始；同一 Core 内修复递增 `alpha.N`。后缀将 Core `0.2.1-rc.3` 规范化为 `dsh.0.2.1.rc.3`，但兼容性仍须核对明确元数据，不能只猜版本名。既有已发布版本和 tag 不变。已发布、已安装、已加载仍是不同状态。

按**精确 Core**选版本，不按全局 SemVer 最大值或 npm `latest`／`alpha`。
只读命令 `node scripts/select-core-release.mjs 0.2.0-rc.2` 先读取
`deployment-baseline.json` 映射，再核验精确 GitHub Release、原始 tarball／校验和资产，
以及 npm 版本中的 `engines.dsh`，全部匹配后才返回安装规格。rc.2 对应 alpha.15，
Core alpha.4 对应 alpha.16，alpha.5 保留其历史线，rc.3 对应当前待验证候选；任一渠道尚不可见时，
会报告待发布或未完成，不给安装建议。未知目标明确失败。沿用的 npm `alpha` 渠道是全局指针，
不感知兼容性；`latest` 仍指历史稳定版。不承诺原生自动更新会使用此映射，
也不承诺维护旧 Core 分支。参见[版本选择](./docs/npm-distribution.md#exact-core-release-lines)。

**原生刷新保护：**0.4.1 引入了窄范围保护：仅在插件拥有的原生刷新被精确验证，且账号、端点与权限连续时，保留已发出的 HTTP 流。但截至 0.4.2-alpha.13，真实 Cordis 服务代理身份不一致仍会导致保护证据匹配失败；0.4.2-alpha.14 修复此问题。后续请求重新验证认证与模型元数据。未知／外部凭据通知、撤销、取消与供应商拒绝仍明确报错，不承诺所有刷新无感，也不自动重试。参见[刷新边界](./docs/copilot-accounts.md#native-oauth-refresh-and-dispatched-requests-385)。

**压缩规划：**alpha.15 修复独立选择的恢复引擎将字节数与 token 预算直接比较的问题，改用公开的原生 token meter，保留完整工具关系和最终原生准入。真正超大的配对历史单元仍明确失败；这不是历史修复，也不保证恢复成功。参见[压缩恢复](./docs/manual-compaction-recovery.md)。

**历史 DSH alpha.5 适配：**公开 API 对齐 pi-ai `1.1.0`、官方 Cordis／schemastery peer，
以及 storage-domain 的 Zod `4.4.3`。
[固定目标的 official-first 调研](https://github.com/cloga/dsh-github-copilot/blob/main/docs/official-first-021-alpha5.md)
逐项记录保留／迁移／退役／延期决定。alpha.4 原生隐藏空白 Thinking 折叠行，
因此移除重复的插件 renderer 与来源投影，不改变消息或 replay。
精确原生 reviewer 身份、动态 system／tool 转换、
replay、账号／Remote／压缩与真实 selector 挂载回归共同约束准入。
不修改 Core，不豁免版本，不新增 wire／目录、迁移策略或持久决策记录。

rc.3 候选还适配公开 `WebRuntime` Volatile provider getter，并要求精确 reviewer 包版本及回调身份。[CI 40098031196](https://github.com/cloga/dsh-github-copilot/actions/runs/40098031196) 已在 Windows/Linux 通过 tagged-source、published-artifact、完整验证和打包门禁；当前不声称 rc.3 Desktop runtime 已验证。

alpha.5 资格验证同时保留代码优先的 PTC 参数顺序和函数体/REPL 指引。新增内联模型标签插槽仅作为后续机会记录：本次不新增标签 UI，也不据此推断历史模型执行。alpha.4 主机可保留 alpha.16。

## 你可以做什么

**高成本 Auto：**在 **Manage → Model preferences** 中用 **High cost** 标记
模型。成本与任务难度正交：所有分类中合格且可容纳输入的候选保留非零机会。
任务分类只影响权重，不再硬筛选分类：目标、第二、第三分类分别乘 `1 / 0.25 / 0.05`，
分类未知明确使用 `0.02`，再乘成本与近期权重。这些系数是未校准试验，不是固定分类概率配额；
各分类模型数量也影响份额。非目标分类抽中不表示目标模型不存在或已经失败。
普通权重 `1` 可获得上一轮 `1.5×` 有限加权；高成本基础权重 `0.2`，
若上一轮用了该模型，本轮权重十倍衰减到 `0.02`，而不是获得连续性奖励。
这是一轮近期惩罚的声明试行参数，不是经过校准的质量判断；
标记不改变手动选择或已接纳的 turn。这是路由政策，不是价格／质量排名，也不证明节省费用。

现有 turn 选择说明内提供 **Auto allocation observations**，显示当前 Session
保留的候选机会、预期份额与实际选择，并提供只读 JSON 导出；此视图仍仅在 Host
生命周期内保留。为了持久评估，默认关闭的 **Local diagnostics** 还会按策略／模型／类别、
需求与评估来源、高成本／连续性状态汇总预期／实际选择及 no-fit 决策，保留 14 天。
可在插件详情设置页单独启用，不会因此采集账号／Checking 或压缩汇总。不记录
Session／turn ID、对话内容，也不推断执行／结果，不自动调参或上传。
`autoAllocationEvidence: false` 会停止 turn 选择视图的后续候选证据，但不改变路由。
辅助分类器独立优先使用未标记的合格 Lightweight 模型。顾问求助尚未实现。参见
[完整需求](./docs/auto-high-cost.md)、[本地诊断](./docs/plugin-diagnostics.md)
与[强制迭代评审流程](./docs/evidence-driven-iteration.md)。

[本地诊断试点](./docs/plugin-diagnostics.md)记录有界的账号／Checking、压缩与 Auto 分配
汇总，**默认关闭**。安装并加载已发布版本后，进入插件详情设置页 →
**Local diagnostics → Read status → Enable local collection**，开启本地持久化；
仅用于账号／Checking 与压缩汇总，不上传或启用每日分析。另行启用
**Auto allocation observation** 才会单独收集 Auto 分配汇总。第三个独立、默认关闭的
**Enable request observations** 开关保留最多 128 条托管适配器的物理请求观测，保留 24 小时：
仅包含模型、JSON／传输字节数、耗时、HTTP 状态和终止分类，不记录正文、headers、
凭据或 Session／turn ID。本地写出完成不证明供应方收到了请求；诊断不会修复超时，
也不改变重试或 Usage。最高 32 MiB 的大 JSON 请求可通过有界、协作式扫描获得组成计数，
不完整解析 payload 对象图；约 20.4 MiB 的请求不再必然落入旧 16 MiB 诊断盲区。
耗时／工作量／取消限制仍明确可见，已结束的记录可能在之后读取时才补齐计数。
不自动启用 gzip、截断历史或增加重试，参见[请求观测](./docs/plugin-diagnostics.md#content-free-physical-request-observations-392)。
Local diagnostics 区域内各诊断组均默认独立折叠，Auto 也只按需展开。
请求观测同意范围还包含最多 128 条凭据变更通知／提交观测，保留 24 小时：
仅记录固定资格判定原因码和活动请求计数。未知来源仍是未知，不还原过去故障，
也不推断账号或 Session 归属，参见[凭据变更证据](./docs/plugin-diagnostics.md#credential-change-decisions-402)。
包内另提供显式离线分析器，
只处理调用者指定的持久化单元或经审阅的聚合视图，并且只新建本地报告文件；不会扫描、
上传或更改采集设置。暂停保留证据，清除需单独确认。Client／Host 分开统计，未覆盖路径、
报告丢失与存储故障明确显示。描述性计数不是历史重建、错误率，也不表示优化效果已被验证。诊断页默认显示按 UTC 日期、
策略、模型和 cohort 划分的 Auto 分配每日汇总表，包含候选机会、预期选择、实际选择及
no-fit 决策；只能在匹配 cohort 内比较预期与实际选择。新 cohort 区分评估超时、不可用／无效
结果、上下文缺失、评估关闭及本地／语义判断确实未知；旧数据原因保持 **not recorded**，
不倒推。按 Selected 加 No-fit 计任务数，不按候选机会计数。这是诊断覆盖，不改变选模策略，
也不证明供应商根因。账号／Checking 和压缩报告、采集控制、
详细范围／限制／JSON 位于折叠区；清除仍需单独确认。

在已构建的包或源码 checkout 内，显式分析已核验的文件：

```sh
node scripts/analyze-diagnostics.mjs --input "ABSOLUTE_UNIT_FILE.json" --mode persisted-unit --profile-name "PROFILE_NAME" --output "NEW_LOCAL_REPORT.json"
```

请把占位符替换为经审阅的文件／profile 和新的绝对输出路径。分析经审阅的聚合视图导出时，使用 `--mode reviewed-view`，不传 `--profile-name`。[读取核验与解释限制](./docs/plugin-diagnostics.md#explicit-offline-analysis-368)说明格式、边界及仅持久化证据的含义；不包含每日定时任务。

| 任务 | 入口 |
|---|---|
| 登录并管理账号模型 | **设置 → 模型 → GitHub Copilot → Sign in** |
| 添加／切换 GitHub 账号 | **Manage → 账号管理 → 切换**；仅限托管路由 profile |
| 指定本 Session 后续 turn 的账号 | **Credits → Switch account**；仅选择已保存授权 |
| 让本 Session 恢复跟随全局默认账号 | **Credits → Follow global default**；仅改变账号选择，不是模型 |
| 排除／恢复单个模型 | **Manage → Model preferences** |
| 自动选择模型 | 选择 **Auto · Balance / Efficiency / Intelligence** |
| 让受支持子代理跟随父模型 | **插件 → dsh-github-copilot → 详情 → Follow parent model** |
| 设置搜索主 provider 与最终 fallback | **插件详情 → Web search** |
| 设置新 Session 的可见历史默认 | **设置 → 模型 → GitHub Copilot → Manage → New Session continuation default** |
| 为已有 Session 开启可见历史续聊 | 选择托管 Copilot 模型，在输入框点 **Credits/usage** → **Visible-history continuation** → **Session policy → On** |
| 查看账号 Credits 与上下文证据 | Copilot 会话输入框；原生 Turn Usage 独立保留 |

![Client 账号控件与模型偏好](./docs/images/copilot-model-preferences.png)

此截图来自 0.4.0 候选版构建的 Client，账号与模型均为模拟数据。它展示 Models 账号控件、展开后的 **New Session continuation default** 以及精确 ID 模型偏好（包括 High cost）。默认值仅由策略 epoch 之后创建的合格 Session 继承，不会追溯授权已有或 seeded 历史。图片不证明真实登录、模型可用性或 Desktop 已加载。

![在 Models 中切换已保存的 GitHub 账号](./docs/images/copilot-accounts.png)

![Credits 中的会话账号选择与账号周期额度](./docs/images/copilot-accounts-credits.png)

![composer 的 Credits 弹层中已有 Session 的可见历史策略](./docs/images/copilot-session-continuation.png)

这些 Credits 截图使用 0.4.0 候选版 Client 构建，以及模拟身份、额度和 Session 状态。账号截图展示本 Session 账号选择的 **Follow global default**；续聊截图展示持久的 **Session policy → On**、同账号也适用的损失说明及下一轮边界。不含真实账号或账单数据，不会发送或重试消息。[截图来源](./docs/images/copilot-current-provenance.json)随图片一同分发。

## 安装与登录

使用已校验的固定版本、指定 profile 和获准的包源。不需要 `copilot2api`、外部网关、手工粘贴 GitHub token、占位 key 或另装 `dsh-web-search-provider`。

安装前，解包已核验 checksum 的归档，以绝对路径运行包内**只读组合预检**：

```sh
node package/scripts/check-search-composition.mjs --profile-dir /absolute/profile --home /absolute/DSH_HOME --install-anchor /absolute/dsh/package.json
```

启动 patch 用重复的 `--patch /absolute/file` 提供。必须得到 `supported: true`；安装器不会自动执行此预检。不支持的／自定义 Web 组合及 `NONEMPTY_DISPOSABLE_PROFILE_ROOT` 均须停止。先保全非空 root，并核对公开组合能否完整重建，再另行批准规范化；不能默认清空。检查实际共享 peer 解析，避免旧 profile-local 包遮蔽官方 Desktop peer。

**独立具名 profile**：

```sh
dsh plugin --profile web add https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.1.dsh.0.2.1.rc.3/dsh-github-copilot-0.1.0-alpha.1.dsh.0.2.1.rc.3.tgz
```

上面的命令是准备发布的示例，仅在发布且所需 CI 通过后可用；目标是官方 DSH 预发布版 `0.2.1-rc.3`。**不要把此候选安装到生产 Desktop profile。** Desktop 制品／签名及 profile peer 组合仍未核验；rc.2 应保留现有兼容插件。[历史 rc.2 随附 CLI 核验](./docs/npm-distribution.md#desktop-bundled-cli-on-official-rc2)不代表 rc.3 验收；全局／普通 `dsh` shim 不等价。本次不授权安装或重启。

Desktop 原生包管理器和已核验的随附 CLI 都有 profile 边界。
[独立 profile 离线维护](./docs/npm-distribution.md#controlled-offline-cli-maintenance-for-standalone-profiles)
不能用来绕过 Desktop 托管／保留 profile 的限制。

经批准 reload/restart 后：

1. 打开**设置 → 模型 → GitHub Copilot**，选择 **Sign in with GitHub**。不需要添加原生 provider 或手工定义模型。
2. 复制一次性验证码，在自己的浏览器完成 GitHub device flow。Desktop 交给系统浏览器；未打开时仍可复制界面中的验证网址。
3. 等待 **Signed in** 和账号发现完成，再选择模型。打开 Models 和正常使用会确保缺失／过期元数据；**Manage → Refresh models**用于有意强制刷新，不是日常设置前提。

退出须显式操作，只删除活动账号的授权，保留其它授权与路由设置。升级保留已有原生 Copilot profile；在[显式单路由迁移](./docs/single-route-migration.md)前，仍可能存在两个分组。安装不迁移会话或默认模型。

在 **Manage → 账号管理**内，添加或重新授权前先选择**登录环境**：**GitHub.com**，或 **GitHub Enterprise Cloud（GHE.com）**并填写数据驻留租户，例如 `company.ghe.com`。不接受任意域名、端口或 URL 路径。重新授权必须保留已保存主机；其他环境请添加新账号。已验证的租户主机名会显示在账号名旁。**不支持 GitHub Enterprise Server 和 Enterprise 额度查询。** 插件身份请求拒绝重定向；原生 pi-ai OAuth 没有重定向控制接口，因此不宣称 OAuth 拒绝重定向。参见[登录环境边界](./docs/copilot-accounts.md#github-login-environments-424)。

**切换**下拉菜单列出已保存账号，底部为**添加 GitHub 账号**。添加不会替换全局默认。设备授权期间显示验证网址、一次性授权码、**复制授权码**和**取消添加账号**；随后单独验证身份和模型。确认切换只影响后续继承默认的新 turn，不改变运行中 turn 或 Session 已指定账号。**管理已保存授权**包含**重新授权**和**移除**；移除仅影响非默认的本地已保存授权，不改变运行中 turn 锁定的账号或 GitHub 端访问。**刷新账号信息**只更新身份，不操作授权。原生路由或不完整证据阻止切换；账号缺失／失效不会自动回退。新账号可能缺少已选模型，旧加密 replay 也可能绑定原账号；不自动替换模型或删除历史。参见[账号需求](./docs/copilot-accounts.md)。

已完成的托管 turn 在原生 Usage 旁显示 **Account**，记录实际请求账号，不是计费归因或子 Agent 汇总。准入时冻结已验证名称；缺失时针对本轮固定账号执行现有的有界、非强制查询，不阻塞模型输出，只能在同一 turn 仍运行时补齐身份。没有原生流返回就没有账号执行证据。未查到的身份仍显示不可用；不会根据当前设置补写已完成历史。证据仅在 Host 生命周期内有界保留，重启及冷历史显示未知。Credits 对身份未知的原始／已保存授权显示可读标签，不显示不透明账号 ID。

读取已保存账号名称不必激活账号。名称在 Host 生命周期内缓存，凭据变更或验证失败会失效，也不证明授权或模型可用。全局切换需要新鲜身份／模型验证及设置持久化确认。切换被阻止时，等待授权或锁定工作结束，再**刷新账号信息**；未知路由／活动证据仍是阻塞。选择入口是下拉菜单，不是每个已保存账号旁的按钮。

**Desktop 生命周期：**当前 rc.3 公共 Loader 测试中，单步添加可保留正在使用的 Web 消费者；但分阶段添加或移除后重新添加，可能导致全局 `web` 服务不可用及依赖它的账号集成无法启动。目前没有功能等价的插件侧恢复 API；[#371](https://github.com/cloga/dsh-github-copilot/issues/371) 仍保持开放。没有原生 HMR 时，原生管理器会明确返回 `restart-required`；应遵循该结果。合成测试本身不构成反复切换或重启的依据。参见 [rc.3 生命周期证据](./docs/web-lifecycle-rc3.md)。

## Auto 与模型偏好

**保存偏好：**Exclude/Restore 和 High cost 即时保存，并等待设置读回确认。其它行仍可操作：最多 32 个不同行的修改显示 **Waiting…**，同时只有一个 **Saving…**。结果不明确或作用域变更时取消尚未发送的修改；**Retry** 只读取已保存设置，不重放写入。卸载后不保留队列。

**模型目录加载失败：**原生 Models 的 `llm/listProviders failed: Failed to fetch` 属于 Client 到 Host／网关的传输失败，不能证明强制 Copilot 发现。连接恢复后使用原生页面的 **Retry**；插件不以过期或空目录替代。

三档 Auto 共用账号验证、未排除的合格模型池。输入／图片能力等硬门槛先于任务偏好。

| 任务需求 | Efficiency | Balance | Intelligence |
|---|---|---|---|
| 已证实简单 | Lightweight | Lightweight | Lightweight |
| 常规 | Lightweight | Versatile | Powerful |
| 复杂 | Powerful | Powerful | Powerful |
| 未知 | Versatile | Versatile | Powerful |

分类来自认证后的供应方元数据，不按模型名、上下文容量或臆测质量排名。上表是偏向的目标分类，不是硬筛选；所有分类中合格且可容纳的模型均按正权重抽选。惩罚只针对上一轮高成本模型，不影响其它已标记模型；换用其它模型一轮后恢复基础权重。可容纳不证明能解决任务，非目标分类抽中不表示目标模型已经失败，不自动升级求助。目标分类实际缺少可容纳候选时明确说明。同一已准入 turn 的工具步骤和重试保持同一真实回答模型；压缩保留独立解析的原生摘要路由。

语义判断**默认开启，仅用于本地需求未知的任务**。最多一次辅助请求，**默认 30 秒端到端期限、128 tokens 输出预算**。可用 `github-copilot.autoSemanticAssessment: false` 关闭。原生插件配置提供 `autoSemanticAssessmentTimeoutMs`（1000–120000 毫秒，`8000` 恢复旧预算）和 `autoSemanticAssessmentModel`（空字符串自动选择，或当前账号的精确模型 ID）。只影响后续评估，不改变已准入 turn 的重试。指定分类模型不存在／被排除／不合适时明确报告 unavailable，不偷偷换模型。自动选择依据元数据，不代表实测最优；30 秒是试验默认值，不证明过去主要因超时。参见[评估配置](./docs/auto-task-routing.md#using-auto)。

超时／无效结果保留未知，再按偏好兜底，不解释为简单，也不换分类模型重试。用户取消和账号失效仍终止请求。辅助调用增加延迟与供应方费用，不计入原生回答 Usage。

准备、原生请求和结果边界均用单调时钟检查期限，不依赖定时器及时执行。事件循环延迟可能推迟结束，但不授权超期发起请求或接受结果。Lightweight 分类候选必须由当前账号元数据明确声明禁用 reasoning 的模式：`off`，或 Responses/Completions 的 `none`、Anthropic 的 `disabled`，再按确定性 ID 顺序选择。字段缺失或空列表不证明模型不会 reasoning。这不是实测速率排名。解释分别说明该分类的可容纳候选数和上一模型连续性，不将保留上一模型说成语义优选。

请求内严格选模证据包含候选总数、可用数和每个模型的首个固定排除原因计数：被排除、指定 ID 不匹配、类别、文本输入、禁用能力未证实或预算。不在计数中新增模型 ID。无候选日志仅输出固定原因码，并区分原生适配器无法准备 off 的情况；不记录正文、凭据或原始错误。这是临时证据，不新增持久诊断采集；旧记录缺字段仍为未知。

辅助分类器始终请求协议明确的关闭推理模式（Responses/Completions 为 `none`，Anthropic 为 `disabled`），且不传工具。只有账号元数据和隔离后的公开适配器模型都支持此能力时才发送请求；否则关闭分类请求并按不可用处理。分类器不继承配置的 Chat reasoning effort，关闭映射也不会加到共享账号模型。合成测试验证出站载荷，不证明供应商内部实现。单次调用、有界文本输入和 128 tokens 请求输出预算限制额外开销，但不承诺额度硬上限；普通 Chat 的思考与工具保持不变。

分类输入优先保留当前请求与有界的实质续接任务目标，再填入近期执行内容。仅省略旧历史
不再强制把有效的 simple／routine 改成 unknown；目标缺失、任务文本受限或任务依赖非文本
时仍阻止降级。提示词不预填 unknown 答案。判断详情区分文本投影限制与分类器实际返回值。
unknown 仍是有效结果；文本保留与合成回归不证明准确率已校准，也不证明真实 unknown 比例已下降。

回复的选模说明展示捕获的理由和可选的不含内容的辅助里程碑。`uncertain`、`insufficient-evidence` 不等于会话没有上下文。**Selection unknown**表示记录未保留，**Selection unavailable → Retry**表示读取失败；Retry 只重读该 turn，不重新推理。证据有界且仅限 Host 生命周期，重启／淘汰可能丢失。

失败／不完整轮次的原生 Usage 没有模型行时，沿用现有 ⓘ 打开**本轮模型与选择记录**：本轮成功消息来源显示**已记录模型**并提示失败尝试归属不完整；可靠的本轮已记录请求配置仅显示**请求模型**，不证明发送、执行或计费。缺失证据显示**未知**，不从当前选择、全局默认或相邻轮次倒推。原选模说明折叠在下方；原生完整模型记录不重复展示，没有关闭消息的轮次没有现有入口。原生 Usage 与重试保持不变。[证据边界](./docs/automatic-model-routing.md#attribution-and-explanation)。

**模型排除**将精确 ID 移出托管 picker 与新 turn 的 Auto 候选。已选模型也能排除：已准入 turn 保持原模型，但新 turn／直接调用不得使用；固定选择不会静默替换。偏好状态未知时只读，不伪装为已启用。保存采用窄范围原生 CAS，不读凭据、不发现模型、不扫描会话。

详见[任务判断](./docs/auto-task-routing.md)与[路由合同、排除和历史恢复](./docs/automatic-model-routing.md)。

显式 Auto 意图通过插件对现有选择事件的独立投影保留，不因原生 pending 被消费或冷恢复而丢失。后续显式固定选择仍从未来轮次生效，已准入轮次保持原路由。不会补写历史选择理由，也不会把未知证据猜成 Auto。

## 子代理与搜索

![父模型跟随及 Web search 控件](./docs/images/copilot-search-routing.png)

此截图来自 0.4.0 候选版构建的 Client，展示父模型跟随、Web search 路由和默认关闭的本地诊断。设置／provider 为模拟，诊断为暂停且无数据。截图没有发起搜索、采集或调用真实服务；参见[来源记录](./docs/images/copilot-current-provenance.json)。

**Follow parent model**默认关闭，在当前 profile 内作用于托管 Copilot 父会话的受支持原生子代理／Team mate。固定父模型从子会话下一 turn 生效；Auto 父会话传递准确偏好，子会话按自己的上下文选模。子会话的显式选择优先。运行中 turn、root、fork、其它 provider、旧专用策略不被改写；关闭宽泛开关也不移除旧绑定。[父模型跟随合同](./docs/parent-model-follow.md)。

**Web search**位于插件详情页，仅有两个常规路由选项：主 provider 与最终 fallback。无需 Copilot 登录或发现账号模型即可保存路由，但选项必须是已注册的搜索 provider。保存只记录路由，不证明 Copilot 搜索能力；实际搜索时才检查能力。Auto 在存在对应搜索注册时跟随发起 Chat provider；固定 provider 不随 Chat 模型改变。最多尝试一个不同的最终 fallback，明确提示可能费用；取消或账号 proof 失效不授权 fallback。

Copilot 搜索要求当前账号／协议证据及能力 proof。固定／fallback Copilot 保留非空旧 `searchModel`；否则最多考虑三个账号 Responses 候选。最终用户查询只发送一次，不跨候选重放。设置保存或 Chat 成功不证明 hosted search 可用。[搜索路由与组合](./docs/session-search-routing.md)。

旧 `github-copilot.searchFallback` 只控制独立的 canonical inline 路径，不是路由搜索的第三层 fallback；网页抓取不变。

## 用量、请求限制与恢复

**Credits**展示已验证账号计费周期数据，不是上下文 tokens 或会话成本。过期、组织共享及不可用数据保留真实语义。仅额度请求在保持 TLS 验签下合并 Node 与系统 CA；不改变登录、模型、搜索或整个 Desktop 的信任配置。

原生上下文占用与 Turn Usage 由 Core 所有。插件原样转发 usage，包括失败／取消时的零样本。普通请求进行中或暂时没有新采样时保持安静；只有明确的失败零采样或无效采样事件才显示可关闭的独立上下文警告。保留的计数只标记为历史证据，不推断当前占用或替代百分比。**Turn Usage incomplete**解释缺失样本／生命周期及已记录本地阻断，不编造零用量或部分总和。取消可以保留 usage，但不保证收到供应方最终回执。[用量边界](./docs/copilot-usage.md)。

插件恢复 timeout／replay 结构化错误前会保留原生 usage，包括非零采样。失败的零采样仍可能让原生圆环显示 `0%`，不代表请求上下文为空。重试条目的耗时表示退避等待，不是失败请求耗时；用量修复不等于解决供应方 HTTP 408，也不改变重试策略。

压缩规划只估算模型可见内容和工具，不把原生 ID／来源信息或不透明 replay 信封计入预算，避免元数据导致耗尽 16 次调用。原消息和 replay 保持不变，最终原生准入仍检查转换后的输入。明确容量错误的兜底保留固定前缀和完整工具调用组，不原样重发不可拆分的失败输入。这是保守规划，不是供应商精确 token 计量。

托管请求准入保留真实输入／输出上限和原生事务。自动压力使用发起 Agent 真正绑定的压缩服务；preset 无引擎时不能借用全局恢复。另行选用的[恢复引擎](./docs/manual-compaction-recovery.md)默认对已超限摘要或明确的摘要上下文超限错误启用自动分段兜底。能一次完成的摘要仍走原生流程；超时／408／认证／额度错误不会触发分段。最多 16 次调用可能增加耗时和费用，取消或恢复未完成不会提交半成品摘要。`automaticRecovery: false` 仅关闭自动分段，原生 `auto: false` 仍关闭自动压缩。仅安装插件不会选用该引擎：需按文档显式替换同一作用域的引擎配置，保留 preset／自定义引擎所有权及原有策略。

同一轮后续步骤已有托管路由、且没有待切换模型时，已知输入压力会在 Core 开始下次模型尝试之前压缩。原生压缩成功可避免一次无 usage 样本的本地压力拒绝导致整轮 Usage 不可用。首次步骤、待切换模型、新增固定前缀膨胀与最终硬预算拒绝仍保留原有准入；不会修复历史总量或虚构缺失用量。

**“降级续聊”也覆盖本 Session 的原生托管 Responses 压缩，包括自动摘要**：开启后不需要额外手动恢复命令，也不必先失败再重试。发出的输入省略旧加密 reasoning 及其内嵌摘要，隐藏上下文可能丢失；可见消息、工具调用／结果关系和原历史保留，仅由原生事务提交更小的检查点。输入区提示降级，并区分已提交、失败和取消。关闭时，明确的回放作用域拒绝提供同一个带损失说明的开启入口；未知错误不授权降级。`/copilot-compact visible-history` 保留为已选用恢复引擎的一次性高级入口。参见[授权与恢复限制](./docs/manual-compaction-recovery.md#explicit-visible-history-summary-recovery)；这不启用缺失的引擎，也不修复容量、额度或超时问题。

输入区在原有八秒结果窗口内分别说明**压缩已完成**和**后续请求已成功**，不会把普通请求进度或暂时没有新采样变成常驻警告。后续明确的采样事件可独立出现，并可展示标记清楚的历史计数，但绝不推算占用百分比。插件不额外发送测试请求、不增加重试，保留原生圆环、Usage 记账及可展开的压缩历史。参见[上下文证据](./docs/copilot-usage.md#historical-context-evidence)。

可见历史压缩进行中时提示持续可见。确认成功后从首次观察起八秒自动消失；失败、取消、状态不可用和开启提示保留至手动**关闭**（或原有**取消**）。关闭仅隐藏当前 Session／操作／状态的提示，不改变授权、历史或原生证据，不发送或重试。Client 注册范围内的有界状态使临时重挂载和会话切换不会重置期限；注册销毁或记录淘汰后不保留。

严格核验的 `408 / user_request_timeout`诊断给出有界请求构成和可观察耗时，不证明供应方 payload 上限或根因。图片统计包括原生 Responses 工具输出中的图片；旧的已存诊断可能把这些图片算作剩余历史。字节不是 tokens，耗时不是上传时长；小型无图请求也可能超时。参见[预算与超时指导](./docs/copilot-compaction.md)，不要自动裁剪历史、禁用 proof、切换模型或增加重试。

实验性配置 `github-copilot.responsesRequestCompression` **默认关闭**。显式开启后，仅通过现有原生 Fetch 接口对符合条件的托管 HTTP Responses 请求进行无损 gzip 编码。请求至少 256 KiB；超过 32 MiB 的压缩工作会跳过，且必须同时节省至少 5% 和 4 KiB；任何跳过都会发送原始请求。这只改变准备发送的 HTTP body 字节，不改变 context/token 准入。自定义 Fetch、显式 `auto`／WebSocket 和其他协议维持原生行为；gzip 被拒绝后绝不会自动改成未压缩请求重发。严格核验的 408 诊断会区分原始 JSON 组成字节与准备发送的 gzip body 大小；两者均不证明请求已送达，也不保证消除超时。安装不会启用此选项。

同一失败还可包含请求级原生客户端的本地请求体写入／响应头里程碑、协商出的 TLS ALPN 与 Node 写缓冲字节数。这些只是本地提交观测，不是内核 ACK 或供应方接收证明；缺失事件不代表上传未完成。不支持或存在歧义的传输会明确报告证据不可用。不记录请求内容，也不改变连接、代理、dispatcher 或重试。

HTTP/SSE liveness 默认区分 5 分钟字节 idle 和有界的 10 分钟助手输出静默，排除消费者工作；WebSocket／显式 `auto`仍仅使用原生路径。这不修复供应方 HTTP 408。图片按原生实际投影 MIME 证据准入；插件不负责转换，也不按文件名猜格式支持。[图片兼容](./docs/image-input-compatibility.md)。

原生 rc.2 Auto 授权审查以 `temperature: 0` 请求模型。插件现在**仅对身份已验证的官方 Auto reviewer 根上下文、账号发现的托管 OpenAI Responses 请求自动省略此参数**，无需开启开关。同一 Session／模型的并发普通 Chat 仍保留 temperature。身份由公开 Loader 回调与同 profile 包归属共同验证；未知身份、别名、子上下文、其它协议／供应方以及 Core 所有的 canonical Copilot 保持原生行为，未验证的 reviewer 范围只报告有界诊断。不会从 `supports.thinking` 推断兼容性。冻结输入、账号／取消约束、严格 verdict 和失败关闭的工具拒绝保持不变；没有重试、权限变更或设置迁移。独立的旧兼容覆盖项 `github-copilot.responsesOmitTemperature` 仍默认 `false`；显式 `true` 才影响**所有**托管 Responses 请求，不限于 review。参见[公开范围与验证限制](./docs/auto-review-sampling.md)。

## 设置与排障

配置位于 `github-copilot`。凭据、endpoint 和静态模型目录不是插件设置。

| Key | 默认值 | 用途 |
|---|---:|---|
| `autoSemanticAssessment` | `true` | 本地未知任务的一次辅助判断 |
| `followParentModel` | `false` | 受支持子代理跟随，子会话显式选择优先 |
| `excludedModelIds` | `[]` | Model preferences 保存的精确排除 |
| `accountModelTtlMs` | `86400000` | 最多复用元数据 24h，不延长 token/proof |
| `accountModelFailureCooldownMs` | `300000` | 非强制发现失败冷却 5min |
| `chatStreamLiveness` | `true` | 托管 HTTP/SSE 字节观察 |
| `chatStreamIdleTimeoutMs` | `300000` | 字节 idle 期限，与搜索独立 |
| `responsesRequestCompression` | `false` | 实验性托管 HTTP Responses 无损 gzip |
| `responsesOmitTemperature` | `false` | 从每个托管 Responses 请求显式省略 temperature |
| `chatMaxRequestImageBytes` | `20971520` | 原生 20 MiB 出站图片预算，非总 JSON 上限 |
| `requestBudgetSafetyTokens` | `4096` | 估算输入安全余量 |
| `requestBudgetPressureRatio` | `0.9` | 启用受支持恢复时的提前压力 |
| `compactionReasoning` | `prefer-low` | 未解析 effort 时采用受支持低档 |
| `enabled` / `probe` | `true` / `true` | Hosted search／能力 proof |
| `providers` | `[]` | 可选显式搜索路由 allowlist |
| `includeSources` / `stripServerTools` | `true` / `true` | Inline 引用／托管工具 schema 处理 |
| `idleTimeoutMs` / `probeTimeoutMs` | `300000` / `30000` | 搜索请求／probe 期限 |

| 现象 | 安全下一步 |
|---|---|
| 无登录控件 | 核对活动 profile 与已加载 Host/Client；不要只为显示登录而添加原生 provider |
| 已登录但缺模型 | 查看发现诊断，使用 Retry 或有意 Refresh，不反复登录 |
| 两个 Copilot 分组 | 审核[显式迁移](./docs/single-route-migration.md)，不会自动移除 |
| 选模未知／不可读 | 区分记录丢失与读取失败；Retry 只重读 |
| 缺失／取消后的 Turn Usage | 查看[用量限制](./docs/copilot-usage.md)，不推断零计费 |
| 历史加载报 `github-copilot/auto-model-decision` | 使用[独立副本、先检查的恢复](./docs/automatic-model-routing.md#recovering-affected-histories)；未经批准且未停写不得替换实际历史 |
| AUTH、Responses replay scope 或 TLS 错误 | 查看[请求诊断](./docs/model-compatibility-acceptance.md#authentication-replay-and-request-diagnostics)及[额度 TLS 边界](./docs/copilot-usage.md#account-data-boundary)。精确 scope 拒绝后，**回放恢复**使用同一个持久 Session 降级续聊策略：关闭时说明损失并提供**开启降级续聊**／取消，已开启时只显示诊断，不重复授权。不再选择授权范围或仅下一轮；失败证据过期不会关闭策略。需另行使用原生重试，不自动发送／重试、不改磁盘历史，也不是 408 修复。不自动重置凭据或关闭 TLS。 |
| Hosted search 不可用 | 检查账号／协议／probe 诊断；旧 override 保留至显式 reset |

账号保存确认后立即恢复控件，不等待额度读取。同账号仅改变跟随方式时保留已确认归属的额度，不重复读取；真正换账号时清除旧额度，独立加载新快照，不阻塞后续账号编辑。额度读取失败不会撤销已经确认的账号选择。

Credits 账号面板显示当前账号和 **切换**，下拉菜单只列已有账号，为当前实际账号打勾，长列表内部滚动。**跟随全局默认**是独立复选框，跟随的是全局默认**账号**，不是全局默认模型：开启时清除本 Session 的账号指定，关闭时固定当前账号；手动选择账号也会固定，即使所选恰好是当前全局默认。该选择只影响本 Session 后续 turn，不影响运行中的 turn 或其它 Session。两种操作均保持续聊确认和 revision 校验保存。添加账号只留在 Models，其 **管理** 展开账号管理与共享模型偏好，菜单底部添加账号但不自动选中，并保留重新授权与受保护的本地账号移除。两处都没有账号搜索框。按精确模型 ID 共享排除偏好，可用性仍按账号验证。参见[已确认体验与交互 mock](./docs/account-management-experience.md)。

[可见历史续聊模式](./docs/session-continuation.md)有两个控件：**Manage → New Session continuation default** 设置符合条件的新 Session 如何继承默认；**Credits → Visible-history continuation → Session policy** 控制当前 Session。首次成功激活时记录初始默认开启 epoch，只有在该 epoch 后创建的非 seeded 新 Session 才继承；已有、seeded／forked 或状态未知的历史不会追溯启用。更改全局默认只影响未来 Session。

“New Session”说的是默认继承对象，并非只处理第一条消息：启用的 Session policy 会在每个后续托管 Copilot turn 准入时冻结，并同样控制该 Session 的托管原生压缩摘要。为已有且符合条件的 Session 开启时，选择托管 Copilot 模型，点击输入框的 **Credits/usage** 控件，展开 **Visible-history continuation**，再于 **Session policy** 选择 **On**。此控件只出现在仍打开且使用托管账号发现路由的 Session；canonical/native 路由不显示。选择前可见有损说明。开启即明确同意省略旧加密推理及内嵌摘要，同账号也适用；隐藏细节可能丢失，可见消息、工具关系和原历史保留。该策略跨账号切换与重启持久保留，直到更改；从下一 turn 生效，已准入 turn 保持原先冻结的策略。关闭时切换到不同账号会提供持续开启、保持关闭或取消，没有仅下一轮模式。`/copilot-compact visible-history` 是通过已选恢复引擎执行的另一种一次性操作，不等同于持久 Session 设置。两者都不会自动发送／重试，也不解决额度或上下文超限；精确回放失败仍使用同一个持久策略，用户另行点击原生重试。当前 Core 没有公开 Models 直达 API，Chat 不展示不可用的管理入口。

上下文证据与回放恢复以紧凑、居中提示显示在输入框上方，宽度遵循原生输入框。模型、项数和状态刷新收进默认折叠的技术详情；有损恢复仍需明确确认。上下文采样只在明确事件时告警，可按 Session／事件关闭，且不会断言原生仪表当前值；原生统计不变。切换账号不会让旧加密推理自动变得可跨账号使用。简短 scope 错误指向显式恢复或新会话；有界、脱敏的请求结构计数留在 Host 诊断中，不挤占主错误。**已授权**只表示授权已准备好，不表示消息已发送或恢复已成功。

定时／后台任务失败后，打开任务原来的 Session 查看**回放恢复**。最近一次已记录的精确 scope 拒绝，在临时请求诊断过期、Host 重启或更换模型选择后仍保留入口。不可用的项数／账号诊断保持未知；复制的 fork 历史不会创建入口。开启仍须用户确认有损 Session 策略，不会重发任务。自行选择原生重试前，请先检查失败任务可能已产生的副作用；后续原生轮次开始时清除旧失败提示。

## 所有权与深入阅读

DSH Core 所有会话、工具、sandbox、附件、原生计量和其它 provider；`llm-pi-ai`所有 OAuth、token 交换／刷新和普通模型传输。插件以认证后的账号元数据组合公开适配器，受支持的新模型 ID 无需名称路由补丁。凭据仅在 Host：`llm-pi-ai/github-copilot` 是 canonical 兼容记录；额外账号在同一 DSH 凭据服务的插件所有记录中独立授权，不复制 grant。

公开接口不能替换 Core Edit/Delete、重构平铺 picker 或把原生 Add 变成单路由强制机制。已退役的[Model roles](./docs/dual-model.md)仅保留兼容。修复须遵循[plugin-only](./AGENTS.md#plugin-only-implementation-boundary)。

| 指南 | 范围 |
|---|---|
| [兼容验收](./docs/model-compatibility-acceptance.md) | 元数据、reasoning、replay 及公开接口限制 |
| [当前兼容性评估](./docs/official-first-021-rc3.md) | 精确 rc.3 WebRuntime 契约、reviewer 身份和源码／制品资格证据 |
| [历史 rc.2 official-first](./docs/official-first-020-rc2.md) | 旧 rc.2 seam 与保留差距 |
| [迁移](./docs/single-route-migration.md) | 新鲜只读就绪证据及显式 config-only 维护 |
| [分发](./docs/npm-distribution.md) | 同字节 GitHub/npm 发布和合格安装入口 |
| [Agent 指南](./AGENTS.md)、[贡献](./CONTRIBUTING.md) | owner、任务计划、gate 与交付政策 |

版本沿革见[CHANGELOG.md](./CHANGELOG.md)与不可变[Releases](https://github.com/cloga/dsh-github-copilot/releases)，不再混入安装步骤。`deployment-baseline.json`保留历史 pin，但不准入为当前支持。

## 构建与验证

开发使用 Node 24 LTS 和 `package.json`指定的 pnpm；runtime Node 至少 22.19.0。

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
pnpm verify:tarball -- artifacts/dsh-github-copilot-<package-version>.tgz
```

`pnpm verify`覆盖合同、类型、baseline、build、测试和构建入口 smoke。必需 CI 已在 Windows/Linux 使用未修改的官方 rc.3 源码与发布制品通过，见[资格证据](./docs/official-first-021-rc3.md)。此候选尚未发布、安装或通过 Desktop 验收。模拟测试通过不证明真实账号／模型／搜索可用。

Agent 从 `node scripts/agent.mjs describe --json`、`doctor --json`及`plan <task> --json`开始；计划仅返回未执行 argv，不授权副作用。完整变更／发布政策见[AGENTS.md](./AGENTS.md)。重要更新必须经受保护合并与双渠道发布；纯文档默认不发包。Profile 安装、退出和中断会话的重启另需许可。

提交以 `Assisted-by` 标明实际使用的工具，不用模型供应商或未经核实的协作者身份。

## Release 与 checksum

GitHub Releases 和 npm 分发同一原始已校验 tarball。固定版本并核验 Release SHA-256 或 npm `dist.integrity`；不重打包不可变 Release、不移动／复用 tag。

```sh
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.1.dsh.0.2.1.rc.3/dsh-github-copilot-0.1.0-alpha.1.dsh.0.2.1.rc.3.tgz
curl -LO https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.1.dsh.0.2.1.rc.3/SHA256SUMS
sha256sum --check SHA256SUMS
```

```powershell
$expected = (Get-Content .\SHA256SUMS).Split()[0]
$actual = (Get-FileHash .\dsh-github-copilot-0.1.0-alpha.1.dsh.0.2.1.rc.3.tgz -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $expected) { throw 'Release checksum mismatch' }
```

Checksum 检测损坏／漂移；受保护 workflow 和仓库控制建立发布来源。漏洞请通过[SECURITY.md](./SECURITY.md)私下报告。
