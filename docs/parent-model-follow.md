# Follow a parent model

Implemented for official DSH / Windows Desktop `0.2.0-rc.2` through plugin-owned
public routing. This is separate from retired Model roles and upstream native
rules/settings UI.

## Enable and use

Open **Plugins → dsh-github-copilot → Details**, enable **Follow parent model**
and Save. Default Off; applies to the current profile without child IDs.

| Parent/child state | Next supported child turn |
|---|---|
| Fixed managed Copilot parent | Follow its effective fixed selection |
| Auto parent | Inherit the exact preference; choose using the child's own context |
| Child-owned explicit selection | Keep the child's selection, even if it equals the parent |
| Already admitted turn | Keep the captured route through steps/retries |
| Root, fork, other-provider parent or dedicated legacy policy | Keep native/legacy ownership |
| Eligible parent evidence missing | Named error, not a guessed route |

![Current switch and search section from the published Client](images/copilot-search-routing.png)

Actual built components, synthetic settings, isolated browser; presentation
evidence only, not installation, a real Team turn or model transport.

Turning Off disables broad following on later turns. It does not remove legacy
`parentModelFollow` bindings, restore a former creation snapshot or clear explicit
child selections. Native Team labels can still describe creation-time models;
the plugin does not rewrite them.

## Save behavior

Loading, read-only and failed states disable mutation instead of pretending to
save. Unsaved changes enable Save; success applies from each child's next turn.
An uncertain save requires Reload before retry. No roster, Session ID form,
model picker, login or discovery prerequisite belongs in this ordinary control.

The Client reads public Settings and writes only `['followParentModel']` via
native CAS. Unrelated revision changes are allowed only if this leaf is
unchanged. Successful saves coordinate the mounted search card's expected
revision without losing unsaved routing choices. Conflicts are not blindly retried.

## Routing and provenance boundaries

The Host uses public parent lineage, v3 native spawn descriptors and the existing
selection resolver, not model-ID matching or the global default. Supported
native children/Team mates of managed Copilot parents participate. Missing cold
parent evidence cannot be replaced by a stale creation route.

Policy is captured before first assembly of a child turn and frozen through
steps, retries and compaction. Late enabling affects the next turn. Nested
following traverses verified direct-parent links; cycles fail explicitly.
Auto evaluates the child's messages and capabilities, not the parent's last
concrete model. Managed availability/exclusions and account/proof/cancellation
guards remain independent.

Official child options and descriptor snapshots cannot distinguish omitted
creation override from an explicit equal provider/model override. Enabling this
policy authorizes replacement of creation-time snapshots; it does not claim
to recover that original intent. Child-owned later `model/selection` evidence
still wins. No descriptor/history/default write, automatic migration,
`session.selectModel` propagation or Core patch is introduced.

Legacy bindings remain separately active even with the broad switch Off.
They use native child/direct-parent Session IDs, require matching lineage and
retain stricter diagnostics. Ordinary users need no enrollment. See
[Auto/native child boundaries](./automatic-model-routing.md#requested-parent-to-child-selection-inheritance).

## Evidence and limitations

Policy, Client CAS/config and Host turn-boundary regressions cover fixed/Auto
changes, every preference, independent child contexts, explicit selections,
forks, missing parents, exclusions, turn freezing, disposal and refolding.
The unchanged rc.2 AgentLoop fixture uses strict histories, real projections
and synthetic adapter responses, not a paid endpoint or full Team orchestrator.
Disk-backed resume, live Team UI and loaded Desktop state remain distinct
acceptance layers.

The page uses actual native controls, wrapping labels and system theme; current
documentation captures check desktop and narrow layouts. The earlier
[one-switch design #234](https://github.com/cloga/dsh-github-copilot/issues/234)
and [lineage investigation #229](https://github.com/cloga/dsh-github-copilot/issues/229)
remain historical references, not pending ordinary-user setup steps.
