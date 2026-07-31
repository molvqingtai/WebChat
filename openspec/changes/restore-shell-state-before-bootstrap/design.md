## Context

See `proposal.md` for the confirmed product correction. On `develop@8419cf36e14a679c83e0b77f84a5a81006871292`, content startup creates one Remesh store and renders `BootstrapShell` before four sequential dependency stages. The shell currently owns `Preparing WebChat` plus a separate `WebChat unavailable + Retry` terminal. The existing actions menu and direct generic Toaster are ready-only, while the stored `AppStatus` read/write effect is ignited only with the ready application.

Task #465 proved the resulting boundary gaps without changing source: saved `open: true` is not read on pending/failure/timeout paths; the actions menu is hidden pre-ready; its Refresh dispatches only `ChatRoom` reconnect; and the generic Toaster cannot present a bootstrap failure before ready. The Owner then confirmed one combined shell model: retain loading, move failure to generic Toast, retry from the existing Refresh action, and preserve local shell state independently.

## Goals / Non-Goals

**Goals:**

- Keep one shell/root/store through initial loading, terminal bootstrap failure, user Retry, and ready application activation.
- Start local shell-status and generic Toast presentation ownership from that shell lifetime.
- Remove the bootstrap-specific error/Retry surface while retaining the existing loading shell.
- Make one existing Refresh control dispatch the current lifecycle operation and project its single-flight state.
- Preserve newer shell interaction and fence late bootstrap, hydration, and document results.

**Non-Goals:**

- Deleting the shell-first architecture or prescribing a source component filename.
- Adding an error page, second Toaster, second Retry control, success Toast, automatic open, raw exception text, or visual redesign.
- Changing generic error duration/replacement/dismissal rules, ready-state ChatRoom reconnect scope, WorldRoom recovery, or Runtime readiness truth.
- Changing storage schema/version/key, unread/position semantics, bootstrap stage order/deadlines, protocol, public APIs, permissions, or dependencies.
- Repairing the WXT/Chromium preload warning or requiring stage-specific production logging.

## Decisions

### 1. One shell owns status and presentation before dependencies

The one shell store/root is the earliest stable lifecycle shared by loading, failure, Retry, and ready application state. Activate the existing local `AppStatus` hydration/persistence and generic Toast presentation capability from that lifecycle. Do not await either before mounting the shell, and do not make browser-sync, configuration, IndexedDB, Runtime, or ready application activation prerequisites for them.

Keep one state authority and one storage record. If a current combined effect includes Chat, World, database, Runtime, unread, or other dependency-backed work, isolate or gate that work rather than igniting it early merely to reach shell-local behavior. A second React state mirror, durable timestamp, storage key, or parallel shell store is rejected.

### 2. Loading remains in the panel; terminal failure does not

The open shell may continue rendering `Preparing WebChat` for the current initial or retried bootstrap attempt. A terminal attempt SHALL stop its busy owner but SHALL NOT replace the loading shell with `WebChat unavailable`, an alert page, a Retry button, or raw diagnostics. The mounted shell and launcher remain usable.

The bootstrap controller maps only a current, non-superseded rejection, timeout, or unavailable result into one generic error descriptor for the shell-level presentation capability. Superseded-generation and unmount cancellation remain silent. This mapping does not make Toast the bootstrap outcome owner: presentation failure, unmount, acknowledgement, default expiry, or user dismissal cannot redefine attempt truth or Refresh eligibility. The error follows the existing default lifetime and is not actively dismissed by ordinary ready/business settlement; a later explicit same-ID descriptor may replace it under the existing generic rules.

### 3. The single generic Toaster moves to shell lifetime

Reuse the existing generic descriptor, presentation acknowledgement, stable-ID, accessibility, theme, and visual configuration. Relocate its lifecycle only far enough that bootstrap error feedback is possible before ready and independent of panel open/closed state. Ready-application Runtime/reconnect and unrelated sources use the same surface after activation.

Do not retain a direct ready-only Toaster in parallel, add a bootstrap presenter, or create source-specific styling. Bootstrap-safe publication must not import or ignite ChatRoom/Readiness behavior; ready-only business effects may attach later to the already existing generic surface.

### 4. Refresh is a shell action adapter with two exclusive contexts

Keep one familiar Refresh slot in the existing AppButton actions menu. Before application readiness, its availability and dispatch come only from the current bootstrap attempt: active attempt means disabled/rotating; terminal failure means enabled/static; activation starts one fresh bounded bootstrap generation in the same root. It does not require user identity and does not call ChatRoom, WorldRoom, or Runtime reconnect directly.

After ready activation, the slot switches atomically to the existing current-site ChatRoom retry/reconnect contract, including its identity, join/rejoin scope, fixed readiness owner, and WorldRoom exclusion. The bootstrap owner is then terminal and cannot regain dispatch authority. Context-specific accessible labels distinguish setup Retry from current-site reconnect without adding another visible control.

### 5. Operation state is single-flight and presentation-independent

Initial bootstrap and each accepted bootstrap Refresh have one current generation. The Refresh icon projects only that current attempt while pre-ready. A duplicate click starts nothing; the matching terminal stops its rotation and recomputes eligibility; stale completion cannot stop or enable a newer attempt. Success activates the ready application in place and publishes no success Toast. Failure publishes the generic error independently, leaving Refresh retryable.

The ready-application connection owner continues to control its own loading/Toast/Refresh interval after the context switch. Bootstrap and ChatRoom owners never run as competing Refresh authorities.

### 6. A newer user shell choice wins hydration

The initial stored snapshot is older than an expansion or collapse accepted while the read is unresolved. Preserve the accepted current `open` value when hydration settles and persist it through the single shell-owned write path. Existing fields untouched by that interaction retain their current hydration semantics. Retry and ready activation do not repeat the initial read or mount another watcher.

A genuine document replacement owns a new shell lifecycle. Cancellation or an equivalent live-generation guard prevents an old asynchronous hydration, persistence, or bootstrap continuation from mutating the replacement.

### 7. Evidence binds the combined boundary

The parent FAIL-before SHALL prove all three current defects on exact `8419cf36...`: persisted expanded state is absent before ready, the actions menu/Refresh is unavailable pre-ready, and bootstrap failure produces the panel-local error/Retry while no generic Toaster exists. Candidate controls SHALL cover every bootstrap stage class through the shared boundary, expanded/collapsed/no-record hydration, pre-hydration interaction, closed/open panel Toast delivery, initial and manual single-flight, same-root success, context switch to ChatRoom reconnect, duplicate effects, and stale generations.

Because collapsed equals the default, its control must also prove the stored snapshot was consumed rather than passing because hydration did not run. Deterministic deferred fixtures are sufficient; production trace APIs and mandatory stage logging are not required.

## Risks / Trade-offs

- [The shell can briefly render its default before asynchronous hydration] -> Preserve shell-first mount and apply the saved choice as soon as the independent read settles; never block shell creation on storage.
- [A shell-level Toaster can accidentally duplicate ready feedback] -> Move the one generic surface/owner and let ready-only sources attach to it; assert exactly one renderer and presentation lifecycle.
- [A combined status effect can ignite unready domains] -> Isolate or gate shell-local storage work while keeping all dependency-backed effects ready-only.
- [One Refresh can dispatch the wrong operation during transition] -> Use an exclusive pre-ready/ready context boundary and fence old bootstrap generations before enabling ChatRoom dispatch.
- [A terminal failure can leave misleading busy semantics] -> End `aria-busy` and control loading at the matching terminal while retaining only the confirmed loading shell content and Toast error presentation.
- [A late read or attempt can overwrite current UI] -> Preserve newer interaction and current-generation checks at each asynchronous settlement.

## Migration Plan

1. Publish this requirements-only authority from `develop@8419cf36e14a679c83e0b77f84a5a81006871292` on its own branch and Draft PR.
2. Add one deterministic parent FAIL-before for the combined shell-status, generic Toast, removed error page, actions-menu Refresh, and current-context contract.
3. Implement the minimum shell-lifetime ownership and context adapter on the same branch/PR without changing dependency semantics or adding another state authority.
4. Run focused and repository source gates, strict OpenSpec, exact identity checks, CI, and fresh independent Review on one immutable candidate.
5. Do not route QA, QC, or UX unless the Owner explicitly requests that role. Follow the established Owner acceptance and conditional merge-authorization flow.

No persisted-data migration exists. Reverting the source repair restores the ready-only status/Toast and panel-local bootstrap error behavior without changing stored data format.
