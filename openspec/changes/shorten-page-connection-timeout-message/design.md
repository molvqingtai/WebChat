## Context

The content application already reports a page connection prerequisite deadline through its existing generic Toast feedback path. The product copy needs only the user-relevant outcome; the Runtime and feedback owners remain unchanged.

## Goals / Non-Goals

**Goals:**

- Use one exact, concise message that fits the existing Toast surface.
- Preserve the current timeout trigger, failure settlement, retry/recovery, and connection truth.
- Preserve the current generic Toast owner and every presentation behavior except text.
- Verify the visible behavior without binding tests to implementation spelling or file structure.

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

### 4. Verification observes the rendered outcome

Coverage SHALL drive the existing timeout path and assert one visible Toast with exact text `Connection timed out`. Controls SHALL prove that no additional feedback is added and that settlement/retry/connection behavior remains unchanged. Tests SHALL NOT read production source or freeze helper names, file paths, internal tokens, or JSX text through regex, parser, AST, or snapshot seams.

## Risks / Trade-offs

- [The message omits which prerequisite failed] -> That detail is not actionable user copy; existing internal diagnostics retain technical ownership.
- [A broad copy replacement could affect unrelated timeouts] -> Bind the change only to the existing page connection prerequisite timeout path.
- [A test could overfit implementation text] -> Assert the real rendered Toast and operation behavior instead of source files.

## Open Questions

None. The Owner confirmed `Connection timed out` on 2026-08-04.
