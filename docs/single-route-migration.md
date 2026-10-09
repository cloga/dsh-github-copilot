# Optional migration to the account-discovered Copilot route

[English guide](../README.md) · [中文操作说明](#中文操作说明)

## Result and boundaries

The selected Host-owned OAuth account supplies many account models. The stable managed
route ID is `github-copilot-preview`, displayed as **GitHub Copilot**.
Fresh installations need no native provider definition. Upgrades preserve
existing `llm-pi-ai.providers.github-copilot`; two real groups can remain until
explicit migration. This is configuration removal, not hiding a card.

Native Add/Save can recreate another group. The warning is additive, not
single-route enforcement; Core Edit/Delete remains. Model discovery/UI lifecycle
is described in the [current README](../README.md#install-and-sign-in), not a
prerequisite to removing a route.

Keep `llm-pi-ai` and authorization mounted and preserve the canonical credential
record `llm-pi-ai/github-copilot` and any independently authorized saved accounts.
Do not sign out, delete credentials or remove
authorization to hide a group. `models: []` can mean the default catalog, not
disabled models.

Plugin code never auto-migrates settings, selections or histories. Installation,
real requests, Session/default changes, configuration edits and Host interruption
need their own explicit approvals. Public `session.selectModel` also writes the
future global default: other selected/history-backed Sessions keep their context,
but unselected empty Sessions may inherit it.

## Read-only readiness and maintenance scope

Use no-argument `githubCopilot.migrationStatus()` for fresh live-Agent evidence,
not stale generic `session/list` or an unversioned inventory. It reports:

| Field | Interpretation |
|---|---|
| `plugin.name/version`, `protocolVersion: 1`, `observedAt` | Loaded build's structural self-report, not full Desktop/Core byte attestation |
| `capabilities` | `agentsList`, `sessionProjections`, `settingsCas`, `providerRegistry`, `defaultSelection` |
| `complete.sessions/defaultSelection/routes` | Observation completeness; missing/false is unknown, not safe absence |
| `effectiveSelection` / `selectionSource` | Pending projection, then request-header config, then default only for genuinely empty Sessions with known projection state |
| `activeRequestSelection` | Latest recorded header, not proven in-flight model work; idle usually null |
| Native effective configuration and native/managed registration | Separate facts, never infer one from the other |

This read uses no auth/discovery, credentials or network and writes no settings
or Sessions. `historyScope: live-agents-only` excludes cold stored conversations.
Operators must acknowledge that old conversations may need explicit selection
when resumed. The observation is not an atomic cross-namespace transaction;
recheck immediately before CAS.

The planned `cloga/dsh-windows-ops` command
`tools/migrate-copilot-managed-route.ps1` is separate **config-only v1**
maintenance. This guide does not attest its publication or execution. It does
not select Sessions/defaults, scan cold history, install/restart DSH or certify a
Desktop baseline. Resolve approved selection blockers separately.

## Review before removal

1. Verify an absence-preserving published plugin is installed **and loaded**,
   with matching Host/Client. Older code may recreate the profile. A version
   declaration or screenshot is not loaded-runtime evidence.
2. Ensure discovery and accepted managed models. Use visible Retry or intentional
   Refresh, not repeated sign-in/disabled validation. Metadata is not transport
   proof; a real test request needs separate approval.
3. Deliberately select only approved Sessions/defaults. Preserve model/effort
   only if actually supported. Review paused histories, presets/task references
   without bulk rewrites. Confirm selections before removing their old route.
4. Review configuration source, effective base layers, namespace revision and
   ownership journals. Inherited configuration, ambiguity or another writer
   blocks removal. Never delete journals or patch Core to force it.

Keep the existing profile if any prerequisite is uncertain.

## Apply the reviewed Ops migration after release

1. Recheck readiness/capabilities/completeness and approved selections. Obtain the
   cold-history acknowledgement. Any Host interruption needs separate approval.
2. Take a private settings-only backup outside Git/shared docs. Do not copy or
   disclose OAuth credentials. Check current user-native profile/base/journal.
3. CAS-remove only the reviewed user-native
   `llm-pi-ai.providers.github-copilot` path against the observed revision.
   Preserve the mount/section, credentials, companion and all other provider
   fields. Conflict/already-absent is not permission for blind retry.
4. Read persisted/effective settings and actual registry, then composer and
   `/model`. Report one managed group only when canonical registration is truly
   absent and no other layer supplies it. A hidden card/write success is not enough.
5. Separately review any nonempty search `providers` allowlist. An approved
   replacement of the legacy entry with `github-copilot-preview` preserves other
   entries; never clear/broaden automatically.
6. Verify credentials, approved selections/default and other histories separately.
   `route: not-configured` is optional canonical absence, not login failure or
   proof of a successful model/search call.

A stuck **Deleting…** dialog proves neither removal nor its failure. Do not
repeat deletion; review persisted state after an authorized stop.

## History, search and rollback

Managed IDs remain stable. No transparent canonical alias/history conversion is
created. Resumed canonical conversations need an explicit supported selection,
or preservation/restoration of their original route. Search keeps its existing
[initiator, metadata, allowlist and proof boundaries](./session-search-routing.md);
removing canonical does not turn managed chat into custom inline transport.

For rollback, stop the relevant Host with permission and compare fresh settings
with the private backup. Restore only reviewed canonical fields and approved
selection changes, never overwrite unrelated later edits. Keep ambiguous
journals for review. Restart with approval and verify registration, credentials
and selections separately; this is not model-call proof. Older plugin rollback
may recreate canonical, not a second account.

## 中文操作说明

新安装无需原生 provider；升级保留已有 canonical 配置，两组都是真实路由，
不是两个账号。迁移只在明确批准后移除审核过的
`llm-pi-ai.providers.github-copilot`；canonical 凭据、独立授权的已保存账号、`llm-pi-ai`、授权服务及其它配置保留。
不要退出登录、删除凭据或使用 `models: []` 来隐藏分组。

先验证发布版本已实际加载，再调用无参数 `githubCopilot.migrationStatus()`。
版本、能力或完整性未知就停止；它只覆盖 live Agent，不扫描冷历史，也不调用
凭据／发现／网络。最新 header 不等于正在推理，结构自报不等于完整字节证明。
拟议 Ops 命令仅做配置维护，本文不证明其已发布、已执行或迁移已完成。

单独批准 Session／未来默认值选择、真实测试请求、配置写入与停止／重启。
`session.selectModel` 同时修改未来默认值，未选择的空 Session 可能继承；
其它已选／历史 Session 不批量改写。恢复旧 canonical 会话时可能需显式选择支持的
托管模型，不能承诺透明续接。

检查 base 层和 journal，私密备份设置但不复制 OAuth。写入前重新查询，
按 revision 做窄路径 CAS；冲突不盲重试。回读持久化／有效配置、真实 registry、
composer 与 `/model`，才能确认单组。搜索 allowlist 修改另行审核，不隐式扩大。
回退仅恢复获准字段，不用整份备份覆盖后来改动；注册恢复仍不证明模型调用成功。
