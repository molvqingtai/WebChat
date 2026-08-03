## Context

`WireDomain` uniquely owns trusted-room membership and rejects an outbound typed send before any provider target attempt when the requested room is not currently trusted. The rejection remains useful without embedding the room identifier in its Error message.

## Goals / Non-Goals

**Goals:**

- Use one exact, concise message for the untrusted-room rejection.
- Keep room identity out of the Error message and any user-facing copy.
- Preserve the current trusted-room owner, validation timing, and operation outcome.
- Change only the existing message copy without adding tests; mechanically sync an existing literal expectation only when required by the direct replacement.

**Non-Goals:**

- Changing which rooms are trusted or when membership becomes ready or stale.
- Adding retries, an outbox, fallback routing, connection state, persistence, or UI feedback.
- Adding a new error type, protocol field, transport value, schema, or diagnostic state owner.
- Reformatting unrelated errors or changing provider and browser behavior.

## Decisions

### 1. The Error message is fixed

The untrusted-room rejection SHALL use exactly `Untrusted room message`. Its Error message SHALL contain no full or partial `roomId`, origin, encoded value, suffix, fingerprint, or other room-derived text.

One fixed message is sufficient for classification and keeps the Error contract independent of room encoding and namespace length.

### 2. Room context stays outside the message

An existing internal diagnostic boundary MAY attach the room identity as a separately structured debug field. It SHALL NOT concatenate, truncate, hash, or otherwise project room identity into the Error message, application copy, wire data, or a new UI surface. This change does not require a new metadata object or logging owner.

### 3. Rejection semantics do not change

The same owner SHALL reject at the same pre-provider boundary. No provider target receives the message, and the existing operation failure and settlement path remains authoritative. The copy change SHALL add no retry, fallback, persistence success, status transition, or connection effect.

### 4. Source and test scope stays minimal

Implementation SHALL directly replace only the existing untrusted-room message. It MAY mechanically update an existing exact-string expectation made stale by that direct replacement. It SHALL NOT add a test case, test branch, fixture, seam, helper, compatibility path, or production mapping introduced to preserve an old expectation. Existing delivery gates remain applicable without adding coverage.

## Risks / Trade-offs

- [The Error message no longer identifies the room] -> Room identity is optional structured internal context, not part of the stable message contract.
- [A broad replacement could affect other failures] -> Bind the change only to the existing untrusted-room rejection and retain all other error messages.
- [A copy-only change could expand into regression machinery] -> Add no coverage; limit any test diff to a stale literal expectation and rely on the existing delivery gates.

## Open Questions

None. The Owner confirmed the exact message and no room identifier in its body on 2026-08-04.
