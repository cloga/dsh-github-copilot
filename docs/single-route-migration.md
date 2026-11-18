# Retiring the duplicate Copilot model route

[English guide](../README.md) · [中文操作说明](#中文操作说明)

## Current behavior

The production plugin contributes account controls and account-discovered
metadata, but registers no `github-copilot-preview` language-model provider.
DSH's native `github-copilot` provider owns model selection, catalog, request
transport and conversation execution. Account metadata is used only by explicit
native model synchronization and account-related enhancements; discovery does
not silently modify the native catalog or a selected model.

No profile cleanup or migration is required to stop the plugin from creating a
second provider. This change does not automatically rewrite existing provider
settings, credentials, selections or conversation history. Account switches
and model sync retain their separate confirmation requirements. An existing
`github-copilot-preview` selection may be unavailable because that provider is
no longer registered. Choose a supported native model explicitly if needed.
Do not silently map the old route to a native model: matching names do not
prove equivalent protocol, capability or account entitlement.
The old Models new-Session continuation default applied only to the retired
route and is no longer shown; its saved settings remain untouched.

Existing Web settings are also left untouched. If a Web provider explicitly
names `github-copilot-hosted`, removing the plugin can leave that configured
provider unavailable; DSH reports the missing configured provider rather than
silently switching to another search backend.

## Account and catalog ownership

The plugin may continue to provide account management, quota presentation and
account-advertised metadata through public APIs. Native Copilot OAuth and
ordinary model calls remain owned by DSH's canonical `github-copilot` provider.
An account switch is a separate, explicit operation and does not imply a model
catalog sync. The optional native model sync is separately previewed and
confirmed, writes the existing native model-list path, and never creates a
provider profile.

Model sync submits all enabled account IDs as `{ id }` entries, without a
second capability filter or a native-catalog intersection (#508). Missing
native IDs are advisory only. Native configuration resolves definitions from
its own catalog and existing route settings; it may reject an unresolved ID and
therefore the entire write. For missing IDs only, if no route API is configured,
the preview may propose a provider-wide API when every enabled account model
has the same verified protocol and every matching native catalog entry agrees.
This applies to the whole route and must be disclosed before confirmation.
Existing route APIs are preserved; mixed, incomplete or conflicting evidence
blocks the sync. The model list and authorized route API are written together.
Native validation remains authoritative; the plugin never guesses a protocol
or claims model-call compatibility from a matching name.

Confirming sync replaces per-model customizations, including explicit output
request defaults. The preview discloses updated and removed entries, and the
saved list is checked against both user and effective Settings. Failures and
uncertain outcomes remain errors, with no automatic retry. Successful ID-only
lists remain saved after plugin unload; that persistence does not prove supplier
capability or successful inference.

On the pinned native adapter, ID-only models absent from the installed catalog
do not inherit its per-model IDE headers. A route-wide API selects a generic
protocol provider, not an alternative Copilot wire. The plugin supplements
missing `Editor-Version`, `Editor-Plugin-Version` and `Copilot-Integration-Id`
through the public `llm-pi-ai/request-headers` waterfall, taking values and
eligible default endpoints from the published pi-ai Copilot provider. It does
not copy capabilities, mutate the catalog, replace credentials or implement
another transport. Explicit request headers and native User-Agent attribution
remain unchanged; other providers and custom endpoints receive no contribution.
The listener is removed on disposal, without deleting the saved model list.
Consequently, affected models can fail again after unload. A synthetic native
stream regression covers missing-header rejection and successful header
delivery; it does not certify supplier acceptance or all model capabilities.

The account controls cannot replace DSH's native provider **Edit/Delete**
controls. Saving another native provider group remains a native DSH action; the
plugin does not intercept it or claim to enforce a single group.

## Rollback and support

Removing or disabling the plugin does not restore the retired provider or alter
stored selections. Reinstalling an older plugin version may register
`github-copilot-preview` again, but is not a migration or a safe automatic
rollback for every stored selection. Review any explicit account, model, Web or
profile changes independently and preserve unrelated later edits.

Synthetic tests verify that the plugin does not add a second provider alongside
the native provider. They do not prove a specific Desktop version is installed,
loaded or making successful supplier calls.

The read-only `githubCopilot.migrationStatus()` reports
`historyScope: live-agents-only`; it cannot rule out old selections in cold
stored histories. The previously planned `tools/migrate-copilot-managed-route.ps1`
is not required for this change; this guide does not attest its publication or execution.

## 中文操作说明

生产插件保留账号界面和账号发现的元数据，但不再注册
`github-copilot-preview` 语言模型 provider。模型选择、目录、请求传输和对话执行
由 DSH 原生 `github-copilot` provider 所有。账号元数据仅供显式原生模型同步及
账号增强功能使用；发现元数据不会静默修改原生目录或当前模型。

无需清理 profile 或执行迁移，插件即可停止创建第二个 provider。此变更不会自动改写现有
provider 设置、凭据、模型选择或对话历史；账号切换和模型同步仍需分别确认。
已有的 `github-copilot-preview` 选择可能因 provider 不再注册而不可用；需要时请显式选择
受支持的原生模型。不要按名称自动映射旧路线，名称相同不能证明协议、能力或账号权限等价。
Models 中旧的“新 Session 续接默认项”仅适用于退役路线，现已不再显示；已保存的设置保持不变。

Web 设置也不会被改写。如果 Web 明确配置了 `github-copilot-hosted`，卸载插件后该
provider 可能不可用；DSH 会报告已配置 provider 缺失，不会静默切换搜索后端。

插件仍可通过公开 API 提供账号管理、额度展示和账号模型元数据。原生 Copilot OAuth
及普通模型请求仍由 DSH canonical `github-copilot` provider 所有。账号切换是独立的
显式操作，不代表同步模型目录。可选的原生模型同步需单独预览并确认，写入已有的
原生模型列表路径，不会创建 provider profile。仅对原生目录缺失的 ID，如果尚未配置
route API，且所有启用账号模型的已验证协议一致、目录中匹配的原生模型协议也一致，
预览才会建议设置 provider 级 API，并明确披露它影响整条路由。已有 route API 不覆盖；
协议混合、证据缺失或冲突时阻止同步。模型列表和获准的 API 会在同一写入中提交，
原生校验仍是最终依据。

当前固定版本的原生适配器中，不在内置目录的 ID-only 模型不会继承模型级 IDE 请求头。
插件通过公开 `llm-pi-ai/request-headers` 钩子，从已发布 pi-ai Copilot provider 补齐
缺失的 `Editor-Version`、`Editor-Plugin-Version`、`Copilot-Integration-Id`，
仅适用于原生 Copilot 路由及该 provider 公布的默认端点。保留显式请求头和原生
User-Agent；不改目录、能力、凭据或设置，不新增传输，也不自动重试。
卸载插件会移除该补充而保留模型列表，因此受影响模型可能再次出现缺少请求头错误。
合成原生流回归覆盖缺头拒绝和补齐后的交付，不代表所有模型能力或真实供应商调用均已验证。

账号界面不能替代 DSH 原生 provider 的 **Edit/Delete** 控件。新增原生 provider 组仍是
DSH 操作；插件不拦截，也不声称能强制只保留一个组。

移除或停用插件不会恢复已退役的 provider，也不会改动已保存的选择。重新安装旧版本
可能再次注册 `github-copilot-preview`，但不代表完成迁移，也不一定能安全恢复所有旧选择。
如需处理账号、模型、Web 或 profile 变更，应分别审核并保留之后的无关修改。

合成测试验证插件不会在原生 provider 之外添加第二个 provider；不能证明特定 Desktop
版本已安装、加载或成功调用供应商。

只读的 `githubCopilot.migrationStatus()` 报告
`historyScope: live-agents-only`，无法排除冷存储历史中的旧选择。此前规划的
`tools/migrate-copilot-managed-route.ps1` 并非此变更的必要步骤；本文不证明其已发布或执行。
