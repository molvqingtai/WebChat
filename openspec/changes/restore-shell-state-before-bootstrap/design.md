## Context

WebChat requires asynchronous browser-sync preparation, page-local configuration preparation, MessageStore/IndexedDB preparation, and shared Runtime initialization before dependency-backed application capabilities can operate. Those dependencies are not presentation ownership: the content-script root can mount the normal shell, restore its local state, and host generic feedback without waiting for them.

The final composition therefore has one normal shell for the entire document lifetime. Initialization is non-presentational lifecycle logic invoked from that shell lifecycle. The shell contains the launcher, openable panel, and one generic Toaster; active and terminal initialization status uses that Toaster rather than an alternate loading/error component.

## Goals / Non-Goals

**Goals:**

- Keep one normal shell/root/store through initialization, terminal failure, user Retry, ready capability activation, and later recovery.
- Start local shell-status hydration/persistence and generic Toast presentation ownership from that shell lifetime.
- Remove every initialization wrapper, alternate shell, fallback view, and independent loading/error/result component.
- Express initialization loading and failure only through the shell-contained generic Toaster.
- Make the existing Refresh control dispatch the current lifecycle operation and project its single-flight state.
- Preserve newer shell interaction and fence late initialization, hydration, and document results.

**Non-Goals:**

- Removing the required initialization sequence, its deadlines/cancellation, dependency gating, Runtime detach behavior, or attempt identity.
- Adding an error page, second Toaster, second Retry control, success Toast, automatic open, raw exception text, or visual redesign.
- Changing generic error duration/replacement/dismissal rules, ready-state ChatRoom reconnect scope, WorldRoom recovery, or Runtime readiness truth.
- Changing storage schema/version/key, unread/position semantics, initialization stage order/deadlines, protocol, public APIs, permissions, or dependencies.
- Repairing the WXT/Chromium preload warning or requiring stage-specific production logging.

## Decisions

### 1. The normal shell is the only root UI

The content-script root mounts the normal shell directly. That same shell owns the launcher, openable panel, generic Toaster, theme, and local `AppStatus` throughout the document lifetime. No initialization component may wrap it, replace its children with a fallback tree, create a second shell, or delay creation of the normal application tree until dependencies become ready.

The shell exists independently of browser-sync, configuration, IndexedDB, Runtime, and ready-only business Domains. Dependency-backed capabilities attach or become enabled only when their prerequisites settle. Failure or Retry changes capability availability and feedback, never shell identity or composition.

### 2. Initialization is lifecycle logic, not presentation

Keep one bounded current attempt for the required sequential dependency preparation. Each attempt retains its deadline, cancellation, Runtime-start/detach boundary, duplicate rejection, and generation fencing. A stale, aborted, unmounted, or superseded result cannot mutate current feedback, Refresh eligibility, capability availability, or shell state.

This orchestration may be implemented as a hook/service or equivalent non-presentational owner invoked from the normal shell lifecycle. It must not return or select an alternate shell/status tree. The product contract does not preserve a wrapper component or source filename.

### 3. The shell-contained Toaster is the only status surface

The normal shell contains exactly one generic Toaster in its own React/DOM ownership. It is not mounted as a sibling of the normal shell, a second root, a host-page portal, or a source-specific renderer. Expansion and collapse change panel visibility without replacing or duplicating the shell or Toaster lifecycle.

An active initial or user-retried initialization attempt publishes one generic loading descriptor. A current terminal rejection, timeout, or unavailable result replaces or settles only that attempt's matching loading feedback with one normalized generic error descriptor. Superseded-generation and unmount cancellation remain silent. Success settles only matching loading and publishes no success Toast.

There is no independent loading, unavailable, error, result, alert, busy, or Retry status component. Toast presentation failure, unmount, acknowledgement, default expiry, or user dismissal cannot redefine attempt truth or Refresh eligibility. Ready-application Runtime/reconnect and unrelated sources attach to the same generic surface and retain their existing source-local descriptor ownership.

### 4. Shell-local state starts before dependencies

Activate the existing local `AppStatus` hydration/persistence from the normal shell lifecycle. Do not await its read before mounting the shell, and do not make any application dependency a prerequisite for it.

Keep one state authority and one storage record. If a current combined effect includes Chat, World, database, Runtime, unread, or other dependency-backed work, isolate or gate that work rather than igniting it early merely to reach shell-local behavior. A second React state mirror, durable timestamp, storage key, or parallel shell store is rejected.

### 5. Refresh is a shell action adapter with two exclusive contexts

Keep one familiar Refresh slot in the existing AppButton actions menu. Before dependent application capabilities are ready, its availability and dispatch come only from the current initialization attempt: active attempt means disabled/rotating; terminal failure means enabled/static; activation starts one fresh bounded attempt in the same shell. It does not require user identity and does not call ChatRoom, WorldRoom, or Runtime reconnect directly.

After ready capability activation, the slot switches atomically to the existing current-site ChatRoom retry/reconnect contract, including its identity, join/rejoin scope, fixed readiness owner, and WorldRoom exclusion. The initialization owner is then terminal and cannot regain dispatch authority. Context-specific accessible labels distinguish setup Retry from current-site reconnect without adding another visible control.

### 6. Operation state is single-flight and presentation-independent

Initial initialization and each accepted initialization Refresh have one current generation. The Refresh icon projects only that current attempt while pre-ready. A duplicate click starts nothing; the matching terminal stops its rotation and recomputes eligibility; stale completion cannot stop or enable a newer attempt. Success enables ready capabilities in the existing shell and publishes no success Toast. Failure publishes the matching generic error independently, leaving Refresh retryable.

The ready-application connection owner continues to control its own loading/Toast/Refresh interval after the context switch. Initialization and ChatRoom owners never run as competing Refresh authorities.

### 7. A newer user shell choice wins hydration

The initial stored snapshot is older than an expansion or collapse accepted while the read is unresolved. Preserve the accepted current `open` value when hydration settles and persist it through the single shell-owned write path. Existing fields untouched by that interaction retain their current hydration semantics. Retry and ready capability activation do not repeat the initial read or mount another watcher.

A genuine document replacement owns a new shell lifecycle. Cancellation or an equivalent live-generation guard prevents an old asynchronous hydration, persistence, or initialization continuation from mutating the replacement.

### 8. Evidence binds final ownership

Regression controls record only the final result: the content root mounts one normal application shell directly; that shell owns the sole Toaster as a descendant; initialization never selects an alternate tree; and no independent status component exists. The same suite covers every initialization stage class, expanded/collapsed/no-record hydration, pre-hydration interaction, loading/error Toast delivery, initial and manual single-flight, same-shell success, context switch to ChatRoom reconnect, duplicate effects, and stale generations.

Run those unchanged final-result assertions against the implementation parent to establish fail-before; do not add an assertion that accepts or preserves the parent's transitional structure. Because collapsed equals the default, its control must also prove the stored snapshot was consumed rather than passing because hydration did not run. Structure-sensitive controls must assert parent/descendant ownership and absence of alternate status surfaces rather than treating a shared Shadow root or broad panel mock as sufficient.

## Risks / Trade-offs

- [Normal application composition can touch unavailable dependencies] -> Keep the shell and shell-local Domains mounted, but defer or gate only the capabilities whose required ports are unresolved.
- [The shell can briefly render its default before asynchronous hydration] -> Apply the saved choice as soon as the independent read settles; never block shell creation on storage.
- [A shell-contained Toaster can accidentally duplicate ready feedback] -> Keep one generic surface/owner and let all sources attach to it; assert exactly one renderer and presentation lifecycle.
- [One Refresh can dispatch the wrong operation during transition] -> Use an exclusive initialization/ready context boundary and fence old attempts before enabling ChatRoom dispatch.
- [Toast settlement can be mistaken for operation truth] -> Keep attempt outcome and eligibility in lifecycle logic; presentation only projects descriptors.
- [A late read or attempt can overwrite current UI] -> Preserve newer interaction and current-generation checks at each asynchronous settlement.

## Migration Plan

1. Publish this corrected requirements authority as a docs-only child on the existing branch and Draft PR.
2. Add deterministic structure-sensitive final-result controls and establish fail-before on the parent without encoding its transitional behavior as expected output.
3. Replace that composition on the same branch/PR: mount the normal shell directly, move initialization into non-presentational lifecycle logic, and route every status through the shell-contained generic Toaster.
4. Run focused and repository source gates, strict OpenSpec, exact identity checks, CI, and fresh independent Review on one immutable candidate.
5. Do not route QA, QC, or UX unless the Owner explicitly requests that role. Follow the established Owner acceptance and conditional merge-authorization flow.

No persisted-data migration exists. Reverting the source repair changes rendering and lifecycle ownership only; it does not change stored data format.
