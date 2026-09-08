# Optional migration to the account-discovered Copilot route

[English guide](../README.md) · [中文操作说明](#中文操作说明)

## Result and boundaries

**V3 target:** one global Copilot account, many shared account models, and independent explicitly selected/history-backed Sessions. Plugin alpha.8 does not auto-migrate configuration or enforce a single registration. Actual managed-only deployment is an approved Ops step after release: choose the approved Sessions/default, CAS-remove only the reviewed user-native profile, and verify registry readback. No bulk history/settings/credential mutation or hidden groups.

The new native Copilot draft warns that **Save** adds another real model group, not a second account. Public additive APIs cannot veto native **Add** or disable **Save**. This is warning-only; users can recreate a native group after migration. Public `session.selectModel` also saves the future global default, so unselected empty Sessions may inherit it even while other selected/history-backed Sessions retain their own context. There is no global current-model/search-status card.

New installations use **GitHub Copilot**, with the stable actual route ID `github-copilot-preview`. The planned `0.4.0-alpha.8` UI embeds login, status, **Refresh models** and **Manage** in an existing configured canonical `github-copilot` provider card while suppressing the separate footer account controller. When no such row is mounted, footer fallback or the old-Core settings section remains usable. The shared account-state owner survives transfer only while another eligible surface remains mounted. Unmounting the last surface or replacing declarations without overlapping mounts stops polling. A later controller reads status and separately ensures missing/idle/stale/error/loading signed-in metadata, without replaying the old forced-login action. Manual **Refresh models** is inside **Manage**; errors expose **Retry**. This is account-control integration, not a merger or removal of the two actual routes; credentials, configuration, history and selection stay unchanged by that integration.

Normal discovery needs neither manual model definitions nor routine refresh clicks; the additive slot still cannot replace Core **Edit/Delete**, and the native editor remains. Successful explicit UI sign-in/account switch forces one discovery. Opening Models separately uses non-forcing `ensureModels()` for missing/idle/stale/error/loading signed-in metadata; error re-entry can retry after shared cooldown, never in a same-mount loop; loading joins the existing Host flight without extra network. Fresh ready cache makes no request, and true unavailable/empty models do not auto-retry. Status/details remain network-free. Defaults under `github-copilot` are `accountModelTtlMs: 86400000` (24h maximum reuse) and `accountModelFailureCooldownMs: 300000` (5min); shared Host single flight, no periodic metadata polling. A separate mounted 60-second display-only timer updates the relative timestamp without RPC/status/discovery calls. Background credential/reset events clear Client state and read status, not force every token event; next open/use ensures metadata.

The alpha.7 last-success timestamp (`snapshot.discoveredAt`) appears once beside the count outside **Manage**: English relative text with a full local date/time/zone tooltip and accessible semantic `time`. Missing/invalid timestamps or no account hide it; future values use absolute text. Pending/error preserves the last success, a successful refresh supplies a new time and sign-out clears it. The display timer is disposed with the timestamp or unmount; it does not alter cache/discovery behavior.

Last same-account metadata may display during TTL refresh/loading/error, never authorize requests. Credential/account/permission invalidation or proof expiry immediately revokes evidence; TTL does not extend tokens. Definitive `UNKNOWN_MODEL` triggers one bounded metadata refresh, with no message replay or model switching; generic HTTP/network errors are not guessed to mean unknown models. New models still require supported account metadata. The README's primary alpha.7 model-freshness/model-refreshing PNGs show the built Client in isolated Edge with synthetic Remote/provider-shell data, not live Core or production authorization. Host TTL/cooldown timing requires unit tests, not screenshots. The provider-entry/authorization PNGs remain historical alpha.5 and older compact-account GIF/PNGs alpha.3.

Existing `llm-pi-ai.providers.github-copilot` profiles are not automatically removed. Until you explicitly remove a reviewed legacy profile, both real routes may remain listed. This guide removes that configuration, not merely its display: after removal and catalog refresh, the composer picker and `/model` both list only the managed Copilot group. Discovery failures produce diagnostics; they do not enable a fallback static catalog.

There is still only one OAuth record, `llm-pi-ai/github-copilot`. Keep the `llm-pi-ai` plugin and authorization services mounted: an empty provider configuration does not mean the OAuth method must be removed. **Do not sign out, delete credentials, remove the companion or remove the native authorization plugin to hide a model group.** Do not use `models: []` as a disable mechanism; it can mean the default catalog, not no models.

This is a manual migration with separate approvals for installation, any real model request, default/session changes, Host interruption and configuration edits. Reading this guide or installing a new package does not authorize those changes.

## Review before removal

1. **Run the updated plugin first.** Confirm the active profile has actually loaded the absence-preserving plugin and matching Host/Client artifacts targeted by `0.4.0-alpha.8`. The provider-integrated UI does not require this optional route removal. Installed-on-disk is not loaded-runtime evidence. Do not remove the profile while an older plugin is running: older versions may recreate it during login, startup or authentication refresh. Use a published, checksum-verified release when available; a planned version number is not proof of publication.
2. **Verify account discovery.** Open Models, confirm sign-in, let automatic ensure complete if needed, and inspect accepted models, rejected IDs and capability warnings. Use **Retry** on error or **Manage → Refresh models** only for an intentional forced update. Confirm the intended model exists on `github-copilot-preview`. Metadata acceptance is not a successful transport test. An optional explicit test request needs the user's approval and consumes the provider's normal resources; report its result separately. Do not repeatedly sign in or disable validation to force a missing model.
3. **Choose defaults and current sessions deliberately.** Select accepted managed models only for the Sessions explicitly approved for migration, then confirm the approved future default. Core `session.selectModel` also writes that default; do not assume an empty unselected Session is unaffected. Keep the same model ID and reasoning effort only when the managed route actually advertises and supports them. Otherwise ask for a supported choice; do not guess a replacement or silently change effort. Verify the selections before removing their previous route.
4. **Inspect other references.** Review presets, task configurations and paused conversations for selections of `github-copilot`. Do not bulk-rewrite conversation records, replay state, provenance, presets or task files. Change each future-use selection explicitly where supported. Paused historical sessions that still select the old route will require a new model selection when resumed. Keeping their history intact is not a guarantee that the old route remains runnable after removal.
5. **Check configuration ownership.** Review the effective canonical profile and its source. If a base composition or another settings layer still supplies it, an ownership journal is present or conflicted, or another process is editing settings, stop for review. Do not delete a journal/marker, override inherited configuration or patch Core to force the result. Verified legacy journal restoration remains its own conservative process; migration does not grant ownership of arbitrary user fields.

If any prerequisite is uncertain, keep the existing profile until resolved. Merely showing two groups is safer than silently losing a usable route.

## Apply the reviewed Ops migration after release

1. Confirm the released plugin is installed and loaded with approval. Record the approved Session selections and future default before mutation; do not broaden the approved Session set. Any required Host interruption still needs explicit permission and an active-session check.
2. Preserve a **private settings-only backup** in a user-approved location outside Git/shared docs; do not print/upload it or read/copy OAuth credentials. Read the current user-native profile, namespace revision, effective base layers and ownership journal. Stop if inherited/base configuration, journal ambiguity or concurrent change prevents a safe removal.
3. Through the reviewed public settings path, **compare-and-swap (CAS)** against the observed revision and remove only the user-native `llm-pi-ai.providers.github-copilot` path. Preserve the `llm-pi-ai` mount/section, companion settings, credentials, all other providers and user fields. A conflict or already-absent path is not permission to retry blindly, rewrite whole settings, delete a journal or patch Core.
4. Read back persisted/effective settings and the real provider registry. Then check the composer and `/model` lists: only report a single managed group when the canonical registration is actually absent and no other layer supplies it. A hidden card or successful write alone is not this evidence. Cold `listModels()` can ensure shared discovery without opening Settings first.
5. Separately review any nonempty hosted-search `providers` allowlist. Ops may replace the reviewed legacy route entry with `github-copilot-preview` when approved; keep unrelated entries and never clear/broaden the list implicitly. Plugin code does not make this migration for you.
6. Confirm credentials remain configured, approved selections/default match the review, and other selected/history-backed Sessions and histories are intact. Public `session.selectModel` also saves the future default, so unselected empty Sessions may inherit it. `route: not-configured` describes optional canonical absence, not login failure or proof of successful model/search calls.

A previously stuck **Deleting…** dialog is not proof the configuration was or was not removed. This change does not establish a fix for that hang. Do not click Delete repeatedly; inspect persisted configuration after the authorized stop before deciding whether any edit is required.

## History, search and rollback

- The route ID `github-copilot-preview` does not change, preserving existing managed-route selections. This migration does not create a transparent alias from `github-copilot`, rewrite history or guarantee seamless continuation of old canonical sessions. Select a supported managed model explicitly when resuming those sessions, or retain/restore the canonical profile if its availability is still required.
- Managed conversations use the published native adapter. Provider-hosted `ctx.web` search remains Responses-only with account/discovery/probe/allowlist checks, using the captured initiating Session's effective request-header/config or explicit `GenerateOptions`, with per-owner plans rather than a global default. `Agent.options` is only the activation seed, not selected-model evidence. Without proven request context, traditional search is unavailable; a pending new selection must not reuse old headers as current prompt guidance. Cold managed search ensures shared metadata first. Missing `agents.currentInitiator` makes traditional search unavailable; explicit marked request paths remain guarded. OAuth notification during initial discovery can fail the first search closed before probe/wire; a later user/driver request may retry, not automatically. The custom inline search path applies only to a still-configured legacy canonical route; removing that route does not turn managed conversations into the legacy inline transport.
- For rollback, stop the relevant Host with permission and compare current settings with the private backup. Restore only the reviewed canonical profile fields and any default changes the user explicitly wants reversed. Do not overwrite the entire current settings file over unrelated later edits. Preserve unresolved journals for review. Restart with permission and verify registration, credentials and selections separately; a restored profile is not proof of a successful model call.
- Downgrading to older plugin code can recreate a canonical profile. Record that behavior before an approved package rollback; do not mistake the reappearing group for a second OAuth account.

## 中文操作说明

### 目标与限制

**V3 目标：**一个全局 Copilot 账号、多个共享账号模型，已显式选择／有历史选择的 Session 独立。alpha.8 插件不自动迁移配置、不强制唯一注册；实际只保留托管路由是发布后获准的 Ops 步骤：选择批准的 Session／默认值，CAS 仅移除审核过的 user-native profile，并回读 registry。禁止批量改写历史／设置／凭据或隐藏分组。

新建原生 Copilot draft 警告：**Save** 增加另一真实模型分组，而非第二账号。公开追加式 API 无法否决 **Add** 或禁用 **Save**；它只是警告，用户在迁移后仍能重新添加原生分组。公开 `session.selectModel` 同时保存未来全局默认值，因此其它已选／历史会话虽保留自身上下文，未选择的空会话仍可能继承新默认值。不新增全局当前模型／搜索状态卡片。

新安装使用显示为 **GitHub Copilot** 的账号发现路由，真实 ID 保持 `github-copilot-preview`。计划版本 `0.4.0-alpha.8` 在已有配置的 canonical `github-copilot` provider card 挂载时，将登录、状态、**Refresh models** 和 **Manage** 嵌入其中，抑制独立页脚账号控制器；没有此类行挂载时仍保留页脚或旧 Core settings section fallback。只有另一个符合条件的表面仍保持挂载时，切换才会保留共享账号状态 owner。最后一个表面卸载，或声明替换前后没有挂载重叠时，轮询会停止。之后新建控制器会读状态并另行确保缺失／idle／过期／error／loading的已登录元数据，不重放旧的强制登录动作。手动 **Refresh models** 位于 **Manage** 内，错误提供 **Retry**。这只是账号控件集成，不是合并／移除两条真实路由，也不会因此改写凭据、配置、历史或选择。

正常发现无需手工定义模型或常规手动刷新；公开 slot 仍不能替换 Core **Edit/Delete**，原生编辑器保留。显式界面登录／切换账号成功后强制发现一次；打开 Models 会另外通过非强制 `ensureModels()` 确保缺失／idle／过期／error／loading的已登录元数据，error 重开可在共享冷却结束后重试，但无同次挂载循环；loading 加入已有 Host 请求，不增加网络请求。新鲜 ready 不拉取，真正 unavailable 且空模型不自动重试。状态／详情本身仍无网络。`github-copilot` 默认 `accountModelTtlMs: 86400000`（24 小时最大复用）、`accountModelFailureCooldownMs: 300000`（5 分钟失败冷却），Host 合并为一个在途发现，不设周期元数据轮询；另有挂载期间每 60 秒更新相对时间文字的纯显示定时器，不调用 RPC／status／discovery。后台凭据／reset 事件清状态并只读查询，不对每个 token 事件强制发现；下次打开／使用再确保元数据。

alpha.7 的上次成功时间（`snapshot.discoveredAt`）只在模型数量旁、**Manage** 外显示一次：相对文字为英文，tooltip 和可访问语义 `time` 提供完整本地日期、时间及时区。缺失／无效／无账号时隐藏，未来时间显示绝对值。等待／失败保留上次成功时间，刷新成功才更新，退出登录清除；时间消失或卸载时清理显示定时器。缓存和发现生命周期不变。

同账号旧元数据可在 TTL 刷新／loading／error 时展示，但不能授权请求。凭据／账号／权限失效或 proof 到期立即撤销证据，TTL 不延长 token。明确 `UNKNOWN_MODEL` 只触发一次有界元数据刷新，不重放消息或切换模型；普通 HTTP／网络错误不能猜成模型不存在。新模型仍需支持的账号元数据。README 首先展示的 alpha.7 model-freshness／model-refreshing PNG 来自实际构建 Client 的隔离 Edge 与合成 Remote／provider-shell 数据，不是真实 Core 或生产授权。Host TTL／冷却时序需单元测试，不能靠截图证明。provider-entry／authorization PNG 仍为 alpha.5 历史示意，旧紧凑账号 GIF／PNG 为 alpha.3。

升级不会自动删除已有 `llm-pi-ai.providers.github-copilot`。只有用户真正移除经过审核的旧配置后，composer 与 `/model` 才都会只列出托管 Copilot 分组，不是仅隐藏第二条路由。始终保留 `llm-pi-ai` 插件、授权服务和唯一 OAuth record `llm-pi-ai/github-copilot`；不要退出登录、删除凭据或卸载授权插件来隐藏分组，也不要用 `models: []` 冒充禁用。

安装、真实测试请求、默认模型／会话选择修改、停止 Host 和离线配置修改都需要各自明确授权。本文不是自动执行这些操作的许可。

### 移除前审核

1. **先实际运行新版本。** 确认目标 `0.4.0-alpha.8` 中保留 canonical 缺失的插件已在活动 profile 加载，Host 与 Client 匹配。provider 集成界面不要求执行这项可选路由移除。使用已发布且校验通过的制品；计划版本和磁盘安装都不是已发布／已加载的证明。旧版本可能在启动、登录或认证刷新时重建被删 profile，不能先删除再期待旧进程保留缺失。
2. **验证发现结果。** 打开 Models 确认登录，等待按需自动 ensure 完成，检查目标模型是否在 `github-copilot-preview` 的接受列表及能力警告中。错误可点 **Retry**；有意强制更新时使用 **Manage → Refresh models**。元数据成功不等于真实调用成功；可选测试请求须明确批准，正常消耗供应方资源，结果单独报告。不要重复登录或关闭校验强行恢复模型。
3. **有意迁移选择。** 只为明确批准迁移的 Session 选择托管模型，再确认获准的未来默认值。Core `session.selectModel` 也会保存该默认值，不能假设未选择的空会话不受影响。只有账号明确公布且 SDK 支持时才保留同一模型 ID／思考强度；否则请用户选择，不猜测替代项。检查 preset、定时任务和暂停会话的 canonical 引用，逐项审核未来选择，不批量改写历史、回放、来源记录或 preset 文件。
4. **检查所有权与并发。** 若 base composition／其它配置层仍提供 canonical profile，存在 journal 冲突，或其它进程正在编辑 settings，停止并审核。不强删 marker，不覆盖继承配置，不修改 Core。旧 journal 的精确恢复流程仍需保留其安全检查。

### 发布后执行明确批准的 Ops 迁移

1. 经批准安装并实际加载已发布插件；变更前记录获准的 Session 选择和未来默认值，不扩大授权会话范围。若需要中断 Host，仍须另行批准并检查活动会话。
2. 仅将设置私密备份到用户批准、Git／共享文档之外的位置，不打印／上传，不读取或复制 OAuth 凭据。检查当前 user-native profile、namespace revision、有效 base 层及所有权 journal；有继承配置、journal 歧义或并发变更则停止。
3. 通过已审核的公开 settings 路径，按读取到的 revision 做 **compare-and-swap（CAS）**，只移除 user-native **`llm-pi-ai.providers.github-copilot`**。保留 `llm-pi-ai` 挂载／section、companion 设置、凭据、其它 provider 和用户字段。冲突或路径已不存在时不盲重试，不整份改写设置、不删 journal、不改 Core。
4. 回读持久化／有效设置及真实 provider registry，再检查 composer 与 `/model`。只有 canonical 注册确实消失、其它层也不提供时，才能报告只剩托管分组；隐藏卡片或写入成功本身不够。冷启动 `listModels()` 可直接确保共享发现，无需先打开 Settings。
5. 单独审核 hosted-search 非空 `providers` allowlist。经批准，Ops 可将审核过的旧 route 条目改为 `github-copilot-preview`，保留无关条目；不得隐式清空或扩大列表。插件代码不会代做迁移。
6. 确认凭据仍已配置、获准 Session／默认值符合审核、其它已选／历史会话及历史保持原样。公开 `session.selectModel` 同时保存未来默认值，未选择的空会话可能继承它。`route: not-configured` 仅表示可选 canonical 缺失，不证明发现／模型／搜索调用成功。

### 历史、搜索与回退

旧 `github-copilot-preview` ID 保持不变。canonical 历史不改写，也不会被自动别名映射；仍选旧路由的暂停会话恢复时须显式选择支持的托管模型。如果必须继续原路由，应暂缓移除或恢复其 profile，不能宣称旧路由仍无缝可用。

托管普通对话交给原生 adapter；`ctx.web` 托管搜索仍只支持通过账号元数据／probe／allowlist 检查的 Responses 模型，按捕获的发起 Session 有效 request-header／config 或显式 `GenerateOptions` 与独立 owner plan 处理，不用全局默认值。`Agent.options` 仅是激活 seed，不是已选模型证据；无可证明的请求上下文时传统搜索不可用，新选择尚未发起下一请求时不能拿旧 header 当当前 prompt 指引；冷启动先确保共享元数据。缺少 `agents.currentInitiator` 时传统搜索不可用，显式带标记请求仍受既有检查保护。首次发现中的 OAuth 通知可能让该次搜索在 probe／wire 前保守失败，之后用户／driver 可以重新请求，不自动重试。自定义 inline 只用于仍配置的旧 canonical 路由，删除旧路由不会把托管对话变成旧 inline 路径。

回退同样先取得停止 Host 的许可，对照私密备份，只恢复经过审核的 canonical profile，以及用户明确要撤回的默认值变更。不要用整份旧文件覆盖后来无关改动；保留冲突 journal 以供审核。获准重启后分别验证注册、登录和选择；配置恢复不等于模型调用成功。降级旧插件可能重新创建 canonical profile，须事先说明，不能将再出现的分组当成第二个 OAuth 账号。
