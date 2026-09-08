# Optional migration to the account-discovered Copilot route

[English guide](../README.md) · [中文操作说明](#中文操作说明)

## Result and boundaries

New installations use **GitHub Copilot**, with the stable actual route ID `github-copilot-preview`. The planned `0.4.0-alpha.7` UI embeds login, status, **Refresh models** and **Manage** in an existing configured canonical `github-copilot` provider card while suppressing the separate footer account controller. When no such row is mounted, footer fallback or the old-Core settings section remains usable. The shared account-state owner survives transfer only while another eligible surface remains mounted. Unmounting the last surface or replacing declarations without overlapping mounts stops polling. A later controller reads status and separately ensures missing/idle/stale/error/loading signed-in metadata, without replaying the old forced-login action. Manual **Refresh models** is inside **Manage**; errors expose **Retry**. This is account-control integration, not a merger or removal of the two actual routes; credentials, configuration, history and selection stay unchanged by that integration.

Normal discovery needs neither manual model definitions nor routine refresh clicks; the additive slot still cannot replace Core **Edit/Delete**, and the native editor remains. Successful explicit UI sign-in/account switch forces one discovery. Opening Models separately uses non-forcing `ensureModels()` for missing/idle/stale/error/loading signed-in metadata; error re-entry can retry after shared cooldown, never in a same-mount loop; loading joins the existing Host flight without extra network. Fresh ready cache makes no request, and true unavailable/empty models do not auto-retry. Status/details remain network-free. Defaults under `github-copilot` are `accountModelTtlMs: 86400000` (24h maximum reuse) and `accountModelFailureCooldownMs: 300000` (5min); shared Host single flight, no periodic metadata polling. A separate mounted 60-second display-only timer updates the relative timestamp without RPC/status/discovery calls. Background credential/reset events clear Client state and read status, not force every token event; next open/use ensures metadata.

The alpha.7 last-success timestamp (`snapshot.discoveredAt`) appears once beside the count outside **Manage**: English relative text with a full local date/time/zone tooltip and accessible semantic `time`. Missing/invalid timestamps or no account hide it; future values use absolute text. Pending/error preserves the last success, a successful refresh supplies a new time and sign-out clears it. The display timer is disposed with the timestamp or unmount; it does not alter cache/discovery behavior.

Last same-account metadata may display during TTL refresh/loading/error, never authorize requests. Credential/account/permission invalidation or proof expiry immediately revokes evidence; TTL does not extend tokens. Definitive `UNKNOWN_MODEL` triggers one bounded metadata refresh, with no message replay or model switching; generic HTTP/network errors are not guessed to mean unknown models. New models still require supported account metadata. The README's primary alpha.7 model-freshness/model-refreshing PNGs show the built Client in isolated Edge with synthetic Remote/provider-shell data, not live Core or production authorization. Host TTL/cooldown timing requires unit tests, not screenshots. The provider-entry/authorization PNGs remain historical alpha.5 and older compact-account GIF/PNGs alpha.3.

Existing `llm-pi-ai.providers.github-copilot` profiles are not automatically removed. Until you explicitly remove a reviewed legacy profile, both real routes may remain listed. This guide removes that configuration, not merely its display: after removal and catalog refresh, the composer picker and `/model` both list only the managed Copilot group. Discovery failures produce diagnostics; they do not enable a fallback static catalog.

There is still only one OAuth record, `llm-pi-ai/github-copilot`. Keep the `llm-pi-ai` plugin and authorization services mounted: an empty provider configuration does not mean the OAuth method must be removed. **Do not sign out, delete credentials, remove the companion or remove the native authorization plugin to hide a model group.** Do not use `models: []` as a disable mechanism; it can mean the default catalog, not no models.

This is a manual migration with separate approvals for installation, any real model request, default/session changes, Host interruption and configuration edits. Reading this guide or installing a new package does not authorize those changes.

## Review before removal

1. **Run the updated plugin first.** Confirm the active profile has actually loaded the absence-preserving plugin and matching Host/Client artifacts targeted by `0.4.0-alpha.7`. The provider-integrated UI does not require this optional route removal. Installed-on-disk is not loaded-runtime evidence. Do not remove the profile while an older plugin is running: older versions may recreate it during login, startup or authentication refresh. Use a published, checksum-verified release when available; a planned version number is not proof of publication.
2. **Verify account discovery.** Open Models, confirm sign-in, let automatic ensure complete if needed, and inspect accepted models, rejected IDs and capability warnings. Use **Retry** on error or **Manage → Refresh models** only for an intentional forced update. Confirm the intended model exists on `github-copilot-preview`. Metadata acceptance is not a successful transport test. An optional explicit test request needs the user's approval and consumes the provider's normal resources; report its result separately. Do not repeatedly sign in or disable validation to force a missing model.
3. **Choose defaults and current sessions deliberately.** Select an accepted managed model for every active conversation you intend to continue and, separately, the desired default for new conversations. Keep the same model ID and reasoning effort only when the managed route actually advertises and supports them. Otherwise ask for a supported choice; do not guess a replacement or silently change effort. Verify the selections before removing their previous route.
4. **Inspect other references.** Review presets, task configurations and paused conversations for selections of `github-copilot`. Do not bulk-rewrite conversation records, replay state, provenance, presets or task files. Change each future-use selection explicitly where supported. Paused historical sessions that still select the old route will require a new model selection when resumed. Keeping their history intact is not a guarantee that the old route remains runnable after removal.
5. **Check configuration ownership.** Review the effective canonical profile and its source. If a base composition or another settings layer still supplies it, an ownership journal is present or conflicted, or another process is editing settings, stop for review. Do not delete a journal/marker, override inherited configuration or patch Core to force the result. Verified legacy journal restoration remains its own conservative process; migration does not grant ownership of arbitrary user fields.

If any prerequisite is uncertain, keep the existing profile until resolved. Merely showing two groups is safer than silently losing a usable route.

## Apply the reviewed settings change

1. Obtain permission to stop the Host using this profile and shared settings. Finish or pause affected work first. Do not edit the settings file concurrently with a running writer or start a replacement Host to bypass it.
2. With the Host stopped, create a **private backup of `settings.yaml` only**, in a user-approved local location outside Git and shared documentation. Settings can contain sensitive fields: do not print, upload or commit the file or backup. **Do not read or copy the OAuth credential file** for this migration.
3. Re-read the current settings and confirm they still match the reviewed state. Remove **only** `llm-pi-ai.providers.github-copilot`. Preserve the `llm-pi-ai` section, every other provider, the explicitly chosen defaults and all unrelated user settings. Do not replace the whole document with an example or an old backup. Do not remove the top-level `github-copilot` companion settings section or the `llm-pi-ai` plugin mount.
4. If that path is already absent, do not repeat a deletion. If it is inherited, an unresolved journal exists or concurrent edits appeared, stop rather than guessing a destructive workaround.
5. Restart the intended Host with permission and refresh the existing GUI. Confirm the updated plugin is loaded and the canonical profile remains absent. Open Models and let automatic ensure complete; then check both composer and `/model`. The managed route should be the only Copilot group when no other composition supplies a legacy profile.
6. Verify login remains configured and your intended defaults/current selections are unchanged. `route: not-configured` describes the absent optional canonical configuration and is normal in managed-only mode; it neither means sign-in failed nor proves account discovery/model calls are ready.

A previously stuck **Deleting…** dialog is not proof the configuration was or was not removed. This change does not establish a fix for that hang. Do not click Delete repeatedly; inspect persisted configuration after the authorized stop before deciding whether any edit is required.

## History, search and rollback

- The route ID `github-copilot-preview` does not change, preserving existing managed-route selections. This migration does not create a transparent alias from `github-copilot`, rewrite history or guarantee seamless continuation of old canonical sessions. Select a supported managed model explicitly when resuming those sessions, or retain/restore the canonical profile if its availability is still required.
- Managed conversations use the published native adapter. Provider-hosted `ctx.web` search remains Responses-only with account/discovery/probe checks. The custom inline search path applies only to a still-configured legacy canonical route; removing that route does not turn managed conversations into the legacy inline transport.
- For rollback, stop the relevant Host with permission and compare current settings with the private backup. Restore only the reviewed canonical profile fields and any default changes the user explicitly wants reversed. Do not overwrite the entire current settings file over unrelated later edits. Preserve unresolved journals for review. Restart with permission and verify registration, credentials and selections separately; a restored profile is not proof of a successful model call.
- Downgrading to older plugin code can recreate a canonical profile. Record that behavior before an approved package rollback; do not mistake the reappearing group for a second OAuth account.

## 中文操作说明

### 目标与限制

新安装使用显示为 **GitHub Copilot** 的账号发现路由，真实 ID 保持 `github-copilot-preview`。计划版本 `0.4.0-alpha.7` 在已有配置的 canonical `github-copilot` provider card 挂载时，将登录、状态、**Refresh models** 和 **Manage** 嵌入其中，抑制独立页脚账号控制器；没有此类行挂载时仍保留页脚或旧 Core settings section fallback。只有另一个符合条件的表面仍保持挂载时，切换才会保留共享账号状态 owner。最后一个表面卸载，或声明替换前后没有挂载重叠时，轮询会停止。之后新建控制器会读状态并另行确保缺失／idle／过期／error／loading的已登录元数据，不重放旧的强制登录动作。手动 **Refresh models** 位于 **Manage** 内，错误提供 **Retry**。这只是账号控件集成，不是合并／移除两条真实路由，也不会因此改写凭据、配置、历史或选择。

正常发现无需手工定义模型或常规手动刷新；公开 slot 仍不能替换 Core **Edit/Delete**，原生编辑器保留。显式界面登录／切换账号成功后强制发现一次；打开 Models 会另外通过非强制 `ensureModels()` 确保缺失／idle／过期／error／loading的已登录元数据，error 重开可在共享冷却结束后重试，但无同次挂载循环；loading 加入已有 Host 请求，不增加网络请求。新鲜 ready 不拉取，真正 unavailable 且空模型不自动重试。状态／详情本身仍无网络。`github-copilot` 默认 `accountModelTtlMs: 86400000`（24 小时最大复用）、`accountModelFailureCooldownMs: 300000`（5 分钟失败冷却），Host 合并为一个在途发现，不设周期元数据轮询；另有挂载期间每 60 秒更新相对时间文字的纯显示定时器，不调用 RPC／status／discovery。后台凭据／reset 事件清状态并只读查询，不对每个 token 事件强制发现；下次打开／使用再确保元数据。

alpha.7 的上次成功时间（`snapshot.discoveredAt`）只在模型数量旁、**Manage** 外显示一次：相对文字为英文，tooltip 和可访问语义 `time` 提供完整本地日期、时间及时区。缺失／无效／无账号时隐藏，未来时间显示绝对值。等待／失败保留上次成功时间，刷新成功才更新，退出登录清除；时间消失或卸载时清理显示定时器。缓存和发现生命周期不变。

同账号旧元数据可在 TTL 刷新／loading／error 时展示，但不能授权请求。凭据／账号／权限失效或 proof 到期立即撤销证据，TTL 不延长 token。明确 `UNKNOWN_MODEL` 只触发一次有界元数据刷新，不重放消息或切换模型；普通 HTTP／网络错误不能猜成模型不存在。新模型仍需支持的账号元数据。README 首先展示的 alpha.7 model-freshness／model-refreshing PNG 来自实际构建 Client 的隔离 Edge 与合成 Remote／provider-shell 数据，不是真实 Core 或生产授权。Host TTL／冷却时序需单元测试，不能靠截图证明。provider-entry／authorization PNG 仍为 alpha.5 历史示意，旧紧凑账号 GIF／PNG 为 alpha.3。

升级不会自动删除已有 `llm-pi-ai.providers.github-copilot`。只有用户真正移除经过审核的旧配置后，composer 与 `/model` 才都会只列出托管 Copilot 分组，不是仅隐藏第二条路由。始终保留 `llm-pi-ai` 插件、授权服务和唯一 OAuth record `llm-pi-ai/github-copilot`；不要退出登录、删除凭据或卸载授权插件来隐藏分组，也不要用 `models: []` 冒充禁用。

安装、真实测试请求、默认模型／会话选择修改、停止 Host 和离线配置修改都需要各自明确授权。本文不是自动执行这些操作的许可。

### 移除前审核

1. **先实际运行新版本。** 确认目标 `0.4.0-alpha.7` 中保留 canonical 缺失的插件已在活动 profile 加载，Host 与 Client 匹配。provider 集成界面不要求执行这项可选路由移除。使用已发布且校验通过的制品；计划版本和磁盘安装都不是已发布／已加载的证明。旧版本可能在启动、登录或认证刷新时重建被删 profile，不能先删除再期待旧进程保留缺失。
2. **验证发现结果。** 打开 Models 确认登录，等待按需自动 ensure 完成，检查目标模型是否在 `github-copilot-preview` 的接受列表及能力警告中。错误可点 **Retry**；有意强制更新时使用 **Manage → Refresh models**。元数据成功不等于真实调用成功；可选测试请求须明确批准，正常消耗供应方资源，结果单独报告。不要重复登录或关闭校验强行恢复模型。
3. **有意迁移选择。** 分别为需要继续的活动会话和新会话默认值选择托管模型。只有账号明确公布且 SDK 支持时才保留同一模型 ID／思考强度；否则请用户选择，不猜测替代项。检查 preset、定时任务和暂停会话的 canonical 引用，逐项审核未来选择，不批量改写历史、回放、来源记录或 preset 文件。
4. **检查所有权与并发。** 若 base composition／其它配置层仍提供 canonical profile，存在 journal 冲突，或其它进程正在编辑 settings，停止并审核。不强删 marker，不覆盖继承配置，不修改 Core。旧 journal 的精确恢复流程仍需保留其安全检查。

### 执行明确批准的配置变更

1. 取得许可后停止使用该 profile／共享 settings 的 Host，先完成或暂停受影响任务。不要在 Host 仍写入时离线改配置。
2. 停止后，仅将 **`settings.yaml` 私密备份**到用户批准的本地位置，置于 Git 和公开资料之外。设置本身也可能含敏感信息，不打印、上传或提交。迁移不需要、也不得读取或复制 OAuth 凭据文件。
3. 重新读取当前设置、核对审核内容，只移除 **`llm-pi-ai.providers.github-copilot`**。保留其它 provider、`llm-pi-ai` section、已选默认值和所有无关用户设置；不使用整份示例／备份覆盖当前文件，不移除顶层 companion `github-copilot` settings 或 `llm-pi-ai` 插件挂载。
4. 路径已不存在时不重复删除；遇到继承配置、未解决 journal 或并发改动时停止。此前一直显示 **Deleting…** 不证明删除成功或失败，本次修改也不证明该卡住问题已修复，必须停机后检查实际持久化状态。
5. 经许可重启目标 Host、刷新原 GUI，确认新版已加载且 canonical 仍缺失；打开 Models 等待自动 ensure 完成，再核对 composer 与 `/model` 均只有托管分组。确认登录、默认值和当前选择分别符合预期。
6. 已登录情况下 `route: not-configured` 表示可选 canonical 配置不存在，是正常托管单路由模式，不是登录错误，也不是发现就绪或调用成功的证明。

### 历史、搜索与回退

旧 `github-copilot-preview` ID 保持不变。canonical 历史不改写，也不会被自动别名映射；仍选旧路由的暂停会话恢复时须显式选择支持的托管模型。如果必须继续原路由，应暂缓移除或恢复其 profile，不能宣称旧路由仍无缝可用。

托管普通对话交给原生 adapter；`ctx.web` 托管搜索仍只支持具备有效账号元数据且通过 probe 的 Responses 模型。自定义 inline 只用于仍配置的旧 canonical 路由，删除旧路由不会把托管对话变成旧 inline 路径。

回退同样先取得停止 Host 的许可，对照私密备份，只恢复经过审核的 canonical profile，以及用户明确要撤回的默认值变更。不要用整份旧文件覆盖后来无关改动；保留冲突 journal 以供审核。获准重启后分别验证注册、登录和选择；配置恢复不等于模型调用成功。降级旧插件可能重新创建 canonical profile，须事先说明，不能将再出现的分组当成第二个 OAuth 账号。
