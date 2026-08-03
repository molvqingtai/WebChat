## Context

The content application already reports a page connection prerequisite deadline through its existing generic Toast feedback path. The product copy needs only the user-relevant outcome; the Runtime and feedback owners remain unchanged.

## Goals / Non-Goals

**Goals:**

- Use one exact, concise message that fits the existing Toast surface.
- Preserve the current timeout trigger, failure settlement, retry/recovery, and connection truth.
- Preserve the current generic Toast owner and every presentation behavior except text.
- Change only the existing message copy without adding tests; mechanically sync an existing literal expectation only when required by the direct replacement.

**Non-Goals:**

- Changing the timeout threshold, prerequisite list, bootstrap, lifecycle, or connection algorithm.
- Adding a Retry action, status view, new Toast, notification, timer, state, or feedback owner.
- Changing Toast duration, severity, icon, ID, placement, animation, accessibility, dismissal, replacement, or deduplication.
- Changing protocol, persistence, schema, dependencies, permissions, or browser behavior.

## Decisions

### 1. The visible message is fixed

The existing page connection prerequisite timeout feedback SHALL render exactly `Connection timed out`. The visible text SHALL contain no page, prerequisite, lifecycle, bootstrap, deadline, or other internal implementation terminology.

### 2. Existing feedback presentation remains authoritative

The same generic Toast path SHALL present the message with its current identity, severity, icon, duration, placement, accessibility, replacement, dismissal, and deduplication behavior. The copy change SHALL NOT create another Toast, surface, state owner, or presentation branch.

### 3. Timeout and connection semantics do not change

The current prerequisite deadline SHALL trigger the same failure at the same point. The existing request and connection owners SHALL settle exactly as before. Retry eligibility, recovery, Runtime readiness, pending state, and connection state SHALL NOT change because of this message.

### 4. Source and test scope stays minimal

Implementation SHALL directly replace only the existing timeout message. It MAY mechanically update an existing exact-string expectation made stale by that direct replacement. It SHALL NOT add a test case, test branch, fixture, seam, helper, compatibility path, or production mapping introduced to preserve an old expectation. Existing delivery gates remain applicable without adding coverage.

## Risks / Trade-offs

- [The message omits which prerequisite failed] -> That detail is not actionable user copy; existing internal diagnostics retain technical ownership.
- [A broad copy replacement could affect unrelated timeouts] -> Bind the change only to the existing page connection prerequisite timeout path.
- [A copy-only change could expand into regression machinery] -> Add no coverage; limit any test diff to a stale literal expectation and rely on the existing delivery gates.

## Open Questions

None. The Owner confirmed `Connection timed out` on 2026-08-04.
