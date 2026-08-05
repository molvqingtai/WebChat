## Context

The existing Runtime owns connection lifecycle, presence, room trust, and signaling. Observed raw error toasts trace to three recoverable windows: presence final-release rejection during room teardown, untrusted-room rejection while trust is re-established across a reconnect generation, and the signaling server's `id-taken` when a previous session has not yet released the peer ID. These self-heal through an active recovery path and must not become user-visible errors.

Browser-native Runtime failures are different. `Extension context invalidated.` means the affected old content generation's extension endpoint is permanently unusable. That generation cannot recover by repeating `runtime.sendMessage`, so absorbing the native rejection creates an endless retry/loading state and hides the terminal cause. The product boundary is outcome-based: recovery is silent only while code can still settle it successfully; a proven terminal native or other unrecoverable failure stops the failed recovery owner and surfaces the original error once.

## Goals / Non-Goals

**Goals:**

- A send, reaction, or connection attempt inside a transient recovery window eventually succeeds without any user-visible error.
- Page refresh, a successful extension/background handoff, reconnect generation takeover, and room teardown races each complete silently while their recovery path remains valid.
- A proven terminal native failure, including `Extension context invalidated.` for the affected old content generation, produces one error toast carrying the underlying error's original text verbatim.
- A terminal recovery owner stops retrying and cannot overwrite its error toast with a later loading update.
- Keep the existing pass-through error presentation for genuine failures.

**Non-Goals:**

- Normalizing, rewriting, or mapping error copy for any failure.
- Suppressing or hiding toasts for genuine unrecoverable failures.
- Treating every unknown error as terminal without proving that no code-owned recovery path remains.
- Changing canonical message data, ordering, room trust rules, Runtime networking protocols, permissions, dependencies, or browser-specific product behavior.
- Adding programmatic content injection, new extension permissions, manifest changes, or a page-refresh requirement.
- Adding user-facing status, retry UI, or new settings.

## Decisions

### 1. Recovery, not failure, is the outcome of transient windows

Operations attempted while a recovery prerequisite is absent — presence finalizing, room trust re-establishing, or the previous signaling session still releasing the peer ID — are held by the recovery flow and complete once the prerequisite exists. The transient window produces no rejection visible to the user and no error event that the presentation layer can surface.

### 2. Recoverability is determined by a valid path to success

The covered recoverable windows are: page refresh or reopen, an extension update or background restart whose active generation retains a valid handoff path, reconnect generation takeover including signaling peer-ID occupation, and room teardown or final-release races. Each remains silent only while its owning recovery path can still complete without losing the user's operation. An error is not classified as terminal merely because it is unfamiliar; terminal classification requires a definitive native condition or another settled fact that no code-owned recovery path remains.

### 3. A terminal native endpoint failure ends its generation

`Extension context invalidated.` is terminal for the old content generation that receives it: that generation's `runtime.sendMessage` endpoint cannot become valid again. Its recovery owner stops retrying, cancels its watchdog/loading ownership, and emits exactly one error through the existing pass-through presentation. A later loading update from that failed generation cannot replace the error. Any independently valid generation continues under the existing lifecycle contract; this decision adds no injection, permission, manifest, or protocol behavior.

### 4. Genuine failure keeps raw pass-through presentation

When a failure is genuinely unrecoverable, whether it is browser-native or WebRTC being truly unable to connect, the existing pass-through shows the underlying error's original text verbatim. No normalization, mapping, or rewriting of error copy is introduced for any failure.

### 5. Verify both silent recovery and terminal presentation

Regression controls prove that each recoverable transient scenario surfaces no error toast and the operation eventually succeeds. Terminal controls prove that a native endpoint invalidation stops the failed generation, surfaces exactly one toast with the original error text, and cannot be replaced by a later loading update. Controls must not introduce normalized copy, suppression flags, or hidden states.

## Risks / Trade-offs

- [An operation arrives during a recovery window] -> Recovery holds and completes it; the user sees no error and no loss.
- [A transient repeats longer than expected] -> Recovery continues while a valid path remains; a settled terminal outcome surfaces once and ends that recovery owner.
- [The signaling server keeps the peer ID occupied] -> Reconnection resolves the occupation automatically; no error is surfaced for this transient.
- [An old content generation loses its extension endpoint] -> Stop that generation's futile retry loop and show `Extension context invalidated.` once; do not replace it with loading feedback.

## Open Questions

None.
