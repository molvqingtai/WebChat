## Context

The existing Runtime owns connection lifecycle, presence, room trust, and signaling. Observed raw error toasts trace to three transient windows: presence final-release rejection during room teardown, untrusted-room rejection while trust is re-established across a reconnect generation, and the signaling server's `id-taken` when a previous session has not yet released the peer ID. All three self-heal on retry; none represents an unrecoverable failure. The product contract is that the recovery flow must absorb such transients so they never become user-visible errors, while genuine failures still surface the original error text.

## Goals / Non-Goals

**Goals:**

- A send, reaction, or connection attempt inside a transient recovery window eventually succeeds without any user-visible error.
- Page refresh, extension update or manual background restart, reconnect generation takeover, and room teardown races each complete silently through recovery.
- A genuinely unrecoverable failure produces one error toast carrying the underlying error's original text verbatim.
- Keep the existing pass-through error presentation for genuine failures.

**Non-Goals:**

- Normalizing, rewriting, or mapping error copy for any failure.
- Suppressing or hiding toasts for genuine unrecoverable failures.
- Changing canonical message data, ordering, room trust rules, Runtime networking protocols, permissions, dependencies, or browser-specific product behavior.
- Adding user-facing status, retry UI, or new settings.

## Decisions

### 1. Recovery, not failure, is the outcome of transient windows

Operations attempted while a recovery prerequisite is absent — presence finalizing, room trust re-establishing, or the previous signaling session still releasing the peer ID — are held by the recovery flow and complete once the prerequisite exists. The transient window produces no rejection visible to the user and no error event that the presentation layer can surface.

### 2. Transient scenarios are enumerated exhaustively

The covered transients are: page refresh or reopen, extension update or manual background restart, reconnect generation takeover including signaling peer-ID occupation, and room teardown or final-release races. Each scenario's recovery completes without user-visible error and without losing the user's operation.

### 3. Genuine failure keeps raw pass-through presentation

When a failure is genuinely unrecoverable, such as WebRTC being truly unable to connect, the existing pass-through shows the underlying error's original text verbatim. No normalization, mapping, or rewriting of error copy is introduced for any failure.

### 4. Verify absence of errors, not new copy

Regression controls prove that each enumerated transient scenario surfaces no error toast and the operation eventually succeeds, and that a genuine failure surfaces exactly one toast with the original error text. Controls must not assert new copy, suppression flags, or hidden states.

## Risks / Trade-offs

- [An operation arrives during a recovery window] -> Recovery holds and completes it; the user sees no error and no loss.
- [A transient repeats longer than expected] -> Recovery continues; only a genuinely unrecoverable outcome may surface an error.
- [The signaling server keeps the peer ID occupied] -> Reconnection resolves the occupation automatically; no error is surfaced for this transient.

## Open Questions

None.
