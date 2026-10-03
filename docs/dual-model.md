# Retired Copilot model roles

Compatibility guide for existing planner/executor histories. **Model roles**
and dedicated-root creation are retired; they are not current setup features.
Use ordinary Sessions and native subagents for new work. The separate
[Follow parent model](./parent-model-follow.md) policy supports ordinary children
without restoring role UI or depending on upstream native rules/settings UI.

## Existing histories

- Saved `github-copilot-dual-model` settings stay intact but are not writable
  through the retired role Remote. No migration/deletion runs on activation.
- Existing dedicated roots/children retain captured policy, routes and history.
  Their `copilot_execute` tool is compatibility for existing work, not a way to
  create new roots or enroll ordinary Sessions.
- Policy restrictions are workflow controls, not a shell-code sandbox.
  Uninstalling the plugin is not a supported conversion to ordinary Sessions.
- Do not use the ordinary picker to change a dedicated role:
  `DUAL_MODEL_SELECTION_LOCKED` remains. Start an ordinary Session rather than
  stripping policy from history, replaying work or substituting another model.

## Legacy Remotes

Three strict descriptors retain their identities:

| Method | Current behavior |
|---|---|
| `view()` | Read-only `supported: false`, `writable: false`, `DUAL_MODEL_RETIRED`; no account discovery |
| `save()` | Validates input, then rejects `DUAL_MODEL_RETIRED`; no write |
| `create()` | Recovers only an already-created root matching original UUID, workspace and revision |

Conflicting/uncertain recovery is not evidence of absence or permission to
retry with another UUID. Exact recovery can complete the original attachment;
it creates no new root and is not automatic browser replay.

Native `subagent/descriptor` v3 is required; the old v1 assumption was a plugin
bug, not a history migration. Projection `stateVersion: 2` refolds without
conversion. Unknown/v1/v2, invalid or conflicting descriptors fail closed.
Never relabel them or fabricate policy provenance. Strict `create()` codec
factories and the retained `schema` bridge use the same parser.

## Evidence and historical material

Client tests prove removed role dependencies/slots alongside preserved account,
search and usage cleanup. Host/Gateway fixtures prove rejected new roots/writes,
original-request recovery and historical policy restoration. Synthetic tests
do not prove a particular Desktop's loaded state or live inference.

The [retirement issue](https://github.com/cloga/dsh-github-copilot/issues/158),
[original design](https://github.com/cloga/dsh-github-copilot/issues/127) and
[historical official-first review](./official-first-016-alpha2.md) retain context.
Old role images/provenance under `docs/images` are historical artifacts, not
current screenshots or installation instructions.

## 中文摘要

模型分工与新建专用根会话已退役；新工作使用普通 Session。独立的父模型跟随
开关不恢复旧角色界面，也不依赖上游原生规则 UI。已有专用历史、固定策略和
旧设置原样保留；旧 Remote 只读／拒绝保存，仅允许凭完全匹配原请求恢复已有根。
不转换历史、不静默换模型、不用新 UUID 绕过未知恢复，也不将卸载当作迁移。
发布、安装、加载和真实模型调用须分别验证。
## Alpha.25 descriptor and Remote compatibility

Retained native child compatibility uses descriptor v3 and strict Remote codecs.
Unknown/v1/v2 or invalid child descriptors fail closed without relabeling.
Projection `stateVersion: 2` refolds evidence; it does not convert history.
