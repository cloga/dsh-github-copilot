# Retired Copilot model roles

Issue [#158](https://github.com/cloga/dsh-github-copilot/issues/158) retires the planner/executor experience introduced in [#127](https://github.com/cloga/dsh-github-copilot/issues/127). This is a plugin-only removal, not a Core upgrade or a claim that the running Desktop has changed.

## Ordinary Sessions instead of dedicated roles

The alpha.34 candidate removes the Models-page **Model roles** card, the older **Copilot · Model roles** Settings fallback, both role selectors and the dedicated-session creation action. There is no replacement planner/executor page. Account sign-in, model discovery, ordinary model selection, search routing and the usage control retain their existing owners.

Use ordinary Sessions and native subagents. Automatic parent-model → child-model rules and their native Subagent settings editor are separate work in [Core PR #95](https://github.com/cloga/deepseek-harness/pull/95), not yet delivered by this plugin. The removal does not require that PR to merge, does not enable its feature on an older Core, and does not alter native model-selection permission settings.

## Existing histories remain compatible

- Saved `github-copilot-dual-model` configuration is left intact but no longer writable through the legacy role Remote. No settings migration or namespace deletion runs on mount.
- Existing dedicated roots and children retain their captured policy, Session history and model routes. Ordinary Sessions are never enrolled. No conversion, replay of work, automatic replacement or silent model substitution occurs.
- The retained Host projection, route guards and scoped tools exist only for these historical policies. A historical planner can still continue its workflow through `copilot_execute`; that is compatibility for an existing root, not an entry point for creating a new dedicated root.
- Policy restrictions are workflow controls, not a malicious-code sandbox. Core sandbox/approval ownership remains unchanged. The plugin must remain mounted to enforce those policies; uninstalling it is not a supported migration to ordinary Sessions.
- Do not change a dedicated role with the ordinary picker: a mismatched route remains `DUAL_MODEL_SELECTION_LOCKED`. Start an ordinary Session for new work rather than creating another dedicated root or editing history to remove its policy.

## Legacy Remotes and uncertain requests

The three strict legacy descriptors retain their identities and wire shapes so stale clients fail explicitly rather than invoking a missing or different endpoint:

- `view()` reports `supported: false`, `writable: false`, and `DUAL_MODEL_RETIRED`, with retained configuration/revision and empty model/workspace choices. It performs no account discovery.
- `save()` validates its input and rejects with `DUAL_MODEL_RETIRED`; it does not write settings.
- `create()` validates its input and is recovery-only. The original request UUID, workspace and revision must match an already-created root's durable policy. A new request cannot create a root. Conflicting or uncertain evidence is not treated as absence or permission to retry with a new UUID.

An already-created matching request can recover its original Session identity and complete the existing workspace attachment. Recovery is not a new root, settings write or automatic browser replay. Inspect the Session list for historical work; no role UI is retained solely to initiate fresh requests.

## Alpha.25 descriptor and Remote compatibility

The retained policy projection admits native `subagent/descriptor` **v3**, already v3 in rc.1. The earlier v1 expectation was a plugin bug, not an upstream history-format migration. Projection `stateVersion: 2` forces refolding, not conversion. Unknown/v1/v2, malformed or conflicting descriptors remain fail-closed and unmodified. Never relabel descriptors or fabricate policy provenance.

Strict Remote `create()` codec factories and the legacy `schema` bridge use the same parser; this is not a `src-json` downgrade. Account authorization, migration, search and usage contracts are unchanged. The [official-first decision record](./official-first-016-alpha2.md) separates historical compatibility from the now-retired product requirement. The old role screenshots/provenance retained in `docs/images` are historical artifacts, not a current settings guide.

## Verification boundaries

- Client registration regressions must prove the role dependency and both slot entries are absent while account/search/usage registrations and cleanup remain.
- Host and real Gateway regressions cover retired read-only view, rejected saves/new roots, strict input validation and original-request recovery. Historical policy fixtures retain restoration, native-child admission and route/tool controls.
- Package smoke must reject an exported `DualModelCard` while retaining strict compatibility Remotes.
- Required Windows/Linux and exact-Core compatibility CI remains mandatory. Source assertions, isolated mocks or a successful build alone do not prove installed Desktop behavior or a real model call.

This task requests a PR only. Prepared version metadata is not publication. Do not install or restart a running DSH to verify this removal without separate authorization.

## 中文摘要

alpha.34 candidate 移除「模型分工」、旧版设置回退入口、规划／执行选择器和新建专用双模型会话按钮。普通 Session 与原生 subagent 是今后的使用方式；父模型到子模型的自动映射及原生 UI 属于另一个仍待交付的 Core PR #95，本插件不会重复实现，也不会假装旧 Core 已支持。

已有专用会话保留历史、固定策略和模型路由，继续由兼容 Host 支持；旧设置不删除、不迁移，普通 Session 不会被自动加入旧流程。已有专用根会话中的执行工具可以继续工作，但不能再通过旧入口新建专用根会话。

旧 Remote 的 view 明确报告已退役且只读，不发现模型；save 拒绝写入；create 只允许凭完全匹配的旧请求身份恢复已创建会话，不创建新根。冲突或未知结果仍保守处理，不通过换 UUID 绕过。不要编辑历史、自动换模型或将插件卸载当作会话迁移。

本次仅提交 PR，版本号为仓库检查预备；发布、安装、生效和真实模型调用均需分别验证，不重启当前 DSH。
