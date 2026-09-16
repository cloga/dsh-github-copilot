# Copilot model roles

Issue [#127](https://github.com/cloga/dsh-github-copilot/issues/127). This is an opt-in plugin feature, not a second model adapter, a replacement permission system, or a claim that the running Desktop has been upgraded.

## Use

1. Open **Settings → Models → Model roles** (Chinese: **模型分工**). Older supported Clients use the **Copilot · Model roles** settings section.
2. Enable dual-model sessions and select a **Planning model** and an **Execution model** from this account's available Copilot models. Model names and IDs come from the existing account-discovery service, never an implementation table.
3. Save the configuration. The revision-checked save affects only this plugin's `github-copilot-dual-model` namespace. No global model default, credential, other provider or existing session is changed.
4. Select an existing workspace and choose **Create session with this configuration**. Return to the application if the host's settings surface remains open, then enter the task in the new conversation.
5. The planner clarifies the task, reads evidence and performs acceptance review. `copilot_execute` creates a native continuable execution child using the captured execution route. Its result shows the actual delegated provider/model and child ID; acceptance of the prompt is not completion. The original `send_message`, `list_agents` and `interrupt_agent` capabilities continue the child and expose its status.

For example, if the account advertises them, choose GPT 6 for planning and GPT-5.6 Sol Fast for execution. These are examples, not hard-coded defaults or promises of account entitlement. Acceptance uses the planning model. Both roles share the existing Host-only Copilot OAuth lifecycle.

The ordinary **Subagent → Allow agents to choose models for subagents** setting is a different feature: it authorizes optional model selection, and omission can still inherit a parent model. This dedicated entry captures and enforces a fixed route for its execution children instead. It does not silently enable that global setting.

## Scope and safety

- Disabled by default. Saving an enabled configuration requires two currently available models; a saved unavailable ID is kept visibly unavailable rather than silently replaced.
- Only sessions created through this entry receive the role policy. Saving different defaults, disabling new dual-model sessions, or editing unrelated sessions does not rewrite an existing role policy. Forked histories are not silently enrolled as new dedicated roots.
- Planner write/shell and alternative delegation tools are unavailable in the dedicated flow. Executors receive an explicit implementation-tool allowlist and cannot recursively delegate through the normal agent tools. These are model-workflow controls, **not a malicious-code sandbox**: an authorized shell can itself execute programs. Core sandbox and approval enforcement remain the authority.
- No fallback model is selected on account/model failure. The existing native adapter continues to validate account proof and real model requests; merely seeing an ID or passing metadata validation is not proof of a successful model call.
- The new root carries a session-local initial model selection, not a global-default write. Do not use the ordinary model picker to change a dedicated role: a different effective route is rejected with `DUAL_MODEL_SELECTION_LOCKED`. Create a new dedicated session for another role pair. Core's ordinary picker remains user/Core-owned and can itself save a future global default; this plugin does not intercept or promise to prevent that separate user action.
- Role declarations are captured in an immutable, namespaced, ignorable seed event before publication, and replayed by a plugin-owned projection. The policy includes its exact root ID so an inherited fork seed cannot impersonate a new role owner. The ordinary model-selection event uses Core's published per-session format.
- The plugin must remain mounted to enforce and resume the dedicated policy. Removal/update disposes plugin-owned overlays and stops their active work; an ignorable extension is not an enduring security barrier after uninstall. Unsupported public service contracts disable this feature visibly without turning normal account sign-in into a hard dependency failure.

## Create, retry and recovery

The browser generates a request UUID and keeps the original workspace and settings revision after an uncertain create. It never automatically replays creation. A user retry reuses that identity; the Host derives the same session ID, checks the stored operation before mutable settings, and either returns the original session or reports a conflict. It does not create a second root to work around an unknown result. Workspace attachment and session flush use public APIs; partial creation remains explicit and recoverable.

After a confirmed save conflict, reload settings and review the current configuration. During an uncertain creation the original input is held until confirmation. Reloading the whole browser can lose its in-memory pending receipt; inspect the session list before issuing a fresh creation request. The same supplied request UUID remains idempotent on the Host across process restart.

## UI verification captures

These are the actual built component with **synthetic** account/workspace responses, not the production Desktop. [Capture provenance and artifact hashes](./images/dual-model-provenance.json) identify the exact evidence.

![Dark desktop: saved planner/executor configuration](./images/dual-model-desktop.png)

![Light narrow screen: one synthetic session created](./images/dual-model-mobile.png)

## Public integration and evidence

The feature reuses public settings, account discovery, scope, Agent creation, Session projection/persistence, workspace attachment, tool restrictions/guards and native continuable subagents. It does not access Core private registries, edit prototypes, patch deployed packages, copy grants, install another wire adapter or require a Core change.

Missing public capabilities yield an unavailable card. The package's broad compatibility range covers its existing account/search features; it is **not** a promise that this optional flow works on every historical baseline.

Regression evidence is separated deliberately:

- `dual-model-card.spec.ts`: real React DOM/jsdom interaction, bilingual copy, CAS, unavailable models, stale responses and uncertain-create receipt handling.
- `dual-model-ui.spec.ts`: optional Slot registration, fallback and cleanup.
- `dual-model-remote.spec.ts` / `dual-model-gateway.spec.ts`: strict owned codecs and the actual installed Client Gateway with synthetic RPC. Older Client Gateways do not sanitize successful values or arbitrary nested error details; the Host builds bounded DTOs, and the UI renders only its diagnostic allowlist.
- `dual-model-host.spec.ts`: actual Core Session/projection/scope/tool primitives combined with synthetic Agent, model, persistence and workspace edges. This is not a paid live model run or a full installed Desktop certification.
- `tests/browser/serve-dual-model.mjs`: serves the actual built Client component on a separate loopback fixture using synthetic account/workspace responses. Run after `pnpm build`; the printed URL is explicitly **not** the production DSH GUI.

Publication, Desktop installation, runtime activation and successful real model calls remain separate checks. Never restart active sessions or claim the installed UI changed merely because the repository build passed.

## 中文摘要

在设置的「模型分工」卡中启用功能，选择主模型和执行模型，保存后选择工作区，再点「用此配置新建会话」。主模型负责规划、读取证据和验收；执行子代理使用创建时固定的模型修改代码、运行测试。不是在同一会话里自动来回切换模型，也不是只靠提示词建议执行者换模型。

仅专用入口创建的新会话采用此策略；不修改已有会话、全局默认模型、登录凭据或原生 Subagent 授权开关。模型不可用时明确报错，不自动换模型。需要换角色模型时请另建会话，不要用普通模型选择器改专用角色。插件卸载后不再提供该策略保障；这是协作流程约束，不代替 Core 的沙箱或审批。

创建结果不明时重试同一请求，避免重复会话；不要凭下载、构建或合成测试成功就宣称已安装、已生效或真实模型调用成功。
