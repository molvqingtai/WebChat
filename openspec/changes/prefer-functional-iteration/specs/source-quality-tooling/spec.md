## ADDED Requirements

### Requirement: Executable source uses result-oriented iteration

Every repository-owned executable `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and `.cts` file SHALL express collection traversal with the operation whose return value represents the intended result. This scope SHALL include product source, tests, E2E, root and build configuration, checked-in tools and scripts, and source ported into the repository. Generated artifacts, dependency or cache output, and code shown only as non-executable documentation examples SHALL remain outside this source-quality contract.

`forEach` SHALL be absent. `map` SHALL produce one result for each input, `filter` a subset, `flatMap` zero or more results per input, `reduce` one accumulated result, `some` or `every` a short-circuit boolean, and `find` or `findIndex` the first matching item or position. A callback passed to these methods SHALL compute the method's result and SHALL NOT mutate its input, accumulator, or outer state or perform I/O, notification, cleanup, or another externally observable side effect.

A `for`, `for...of` (including `for await...of`), or `for...in` statement MAY remain when its body genuinely requires `break`, `continue`, or an early return and the same control flow cannot be expressed directly with a result-oriented short-circuit operation. In addition, only `for...of` MAY remain at an explicit owner commit when the owner exposes only ordered per-item external effects and no existing bulk primitive preserves the behavior. When that commit traverses a live `Set`, `Map`, or equivalent collection whose current-pass membership changes are observable, it SHALL traverse the live collection rather than a snapshot. `while` and `do...while` MAY remain only for a genuine state machine, stream, retry, polling, or other condition-driven process; they SHALL NOT replace a prohibited collection traversal. Convenience, familiarity, ordinary snapshot-safe result traversal, or speculative performance SHALL NOT qualify as an exception.

#### Scenario: Traversal returns a derived collection

- **WHEN** source derives one output per input, selects a subset, or emits zero or more outputs per input
- **THEN** it SHALL use `map`, `filter`, or `flatMap` respectively, and the callback SHALL return that result without committing unrelated side effects

#### Scenario: Traversal answers or locates

- **WHEN** source needs a boolean answer or the first matching value or index
- **THEN** it SHALL use `some`, `every`, `find`, or `findIndex` with their native short-circuit behavior instead of an imperative loop

#### Scenario: Traversal accumulates one result

- **WHEN** source derives one accumulator, aggregate, lookup, or immutable state from a sequence
- **THEN** it MAY use `reduce`, but the reducer SHALL return the next accumulator and SHALL NOT serve as a disguised `forEach`

#### Scenario: Control flow genuinely needs a loop

- **WHEN** an iteration must skip or terminate through `continue`, `break`, or an early return and no direct result-oriented operation expresses the same behavior
- **THEN** a narrowly justified `for`, `for...of`, or `for...in` statement MAY remain with the same observable order and termination semantics

#### Scenario: Owner commit has no bulk primitive

- **WHEN** an explicit owner commit must invoke per-item external effects in order and has no existing bulk primitive that preserves the behavior
- **THEN** one narrowly justified `for...of` MAY perform that commit, while functional callbacks and generic traversal helpers SHALL remain effect-free

#### Scenario: Owner commit observes live membership

- **WHEN** same-pass additions or removals are observable while an allowed owner commit traverses a live `Set`, `Map`, or equivalent collection
- **THEN** the `for...of` SHALL traverse that collection directly and SHALL NOT replace it with an array snapshot

#### Scenario: Sequential async traversal

- **WHEN** operations must execute sequentially because order, backpressure, failure, or resource ownership is observable
- **THEN** the replacement SHALL preserve sequential awaiting and SHALL NOT introduce concurrent execution merely to remove loop syntax

#### Scenario: Side-effect traversal uses an existing bulk commit

- **WHEN** existing traversal performs notifications, disposal, persistence, DOM or storage writes, or another external effect for each element and an existing bulk primitive can preserve behavior
- **THEN** it SHALL first compute an immutable owner-specific plan without callback side effects and then submit that plan through one explicit owner-level commit invocation, preserving current order, error, and cleanup behavior

### Requirement: Derived collection transforms do not mutate their inputs

Source that needs a sorted copy, reversed copy, or copy with elements inserted, removed, or replaced SHALL use `toSorted`, `toReversed`, or `toSpliced` respectively. Direct `sort`, `reverse`, or `splice` MAY remain only when mutation of the owned collection is itself the explicit operation rather than an implementation shortcut for deriving a value; a shallow copy immediately followed by the mutating method SHALL be replaced by the corresponding copying method.

#### Scenario: Sort or reverse produces a value

- **WHEN** source needs a sorted or reversed result while retaining the input as-is
- **THEN** it SHALL use `toSorted` or `toReversed` without mutating the input or creating a shallow copy solely to call `sort` or `reverse`

#### Scenario: Splice-like edit produces a value

- **WHEN** source needs an array value with an indexed insertion, removal, or replacement while retaining the input as-is
- **THEN** it SHALL use `toSpliced` rather than mutate the input with `splice`

#### Scenario: Mutation is the owned command

- **WHEN** the explicit observable operation is to drain, replace, or edit one locally owned mutable collection in place
- **THEN** `sort`, `reverse`, or `splice` MAY remain only at that owning commit boundary and SHALL NOT be used inside a nominally pure traversal callback

### Requirement: Functional iteration is enforced by the existing quality gate

The repository SHALL enforce this contract through repository-owned structural rules integrated into the existing Oxlint fix/check, staged-file, CI, and CD quality surfaces. The existing general-lint pass and ignore policy SHALL remain distinct from a read-only functional pass of the same installed Oxlint binary. The functional pass SHALL enable no unrelated rule categories and SHALL receive an exact manifest of in-scope paths derived from tracked JS/TS-family files. That manifest SHALL include hidden `.agents` source, ported source, copied UI source, tests, E2E, and root configuration that the general pass may ignore; it SHALL exclude generated source by exact tracked path rather than a broad directory waiver or recursive symlink behavior. The functional pass SHALL run without fixes so a prohibited construct is never mechanically rewritten into another prohibited construct.

The structural rules SHALL reject every `forEach`, reject loop statements that lack an approved control-flow, condition-driven, or per-item owner-commit need, reject prohibited collection mutation used to derive a value, reject mechanically provable effectful functional callbacks, and expose each retained loop exception for review. An exception SHALL use the rule's dedicated statement-local justification annotation and include a concise reason naming the required control flow or, for `for...of`, the ordered owner effect and missing bulk primitive plus any observable live-iteration behavior; generic lint-disable directives SHALL NOT authorize exceptions. The functional command SHALL inspect parsed comment trivia to reject generic or functional-rule Oxlint/ESLint disable directives before invoking Oxlint with ignore processing and nested configuration discovery disabled. Whole-file, directory-wide, global, or rule-disable waivers for the functional-iteration rules SHALL be forbidden. Callback purity and the legitimacy of retained side effects or loop exceptions SHALL receive fresh source review in addition to the mechanical gate.

#### Scenario: Prohibited traversal enters the repository

- **WHEN** an in-scope file adds `forEach` or a loop without an authorized control-flow, condition-driven, or per-item owner-commit exception
- **THEN** the canonical local and hosted quality gate SHALL fail on that exact source location before acceptance

#### Scenario: Retained loop has no auditable reason

- **WHEN** a loop is retained without a narrow statement-level justification naming the required `break`, `continue`, early return, condition-driven process, or all applicable per-item owner-commit conditions
- **THEN** the quality gate SHALL reject it instead of relying on an undocumented reviewer assumption

#### Scenario: Broad waiver is attempted

- **WHEN** configuration or an inline directive disables the functional-iteration rules for a whole file, directory, generated-and-authored mixture, or repository
- **THEN** verification SHALL fail and require the waiver to be removed or narrowed to one justified statement

#### Scenario: Directive text is not a comment

- **WHEN** source contains directive-like text inside a string literal rather than comment trivia
- **THEN** the waiver check SHALL ignore that text and SHALL NOT report a false functional-rule disable

#### Scenario: Checked-in ported or tool source is scanned

- **WHEN** the quality gate evaluates source ported into `src` or repository-owned executable tools and tests under `.agents`
- **THEN** the same functional-iteration rules SHALL apply; provenance or a pre-existing general-lint ignore SHALL NOT exempt authored executable logic

#### Scenario: General lint ignores remain isolated

- **WHEN** a path is excluded from the existing general Oxlint pass because it contains unrelated historical lint debt
- **THEN** the functional-only Oxlint pass SHALL still evaluate that path using only the functional-iteration rules without enabling the unrelated general rules there

#### Scenario: Generated source remains exact-scoped

- **WHEN** a file is reproducibly generated and its generator remains repository-owned source
- **THEN** only the generated output's exact tracked path MAY be removed from the functional manifest, while the generator and all other authored executable files remain enforced exactly once without scanning symlink aliases

#### Scenario: Clean-cut migration is accepted

- **WHEN** the implementation layer is considered complete
- **THEN** structural scans SHALL report zero `forEach` calls, zero unjustified loop statements, zero prohibited derived-value mutations, and zero broad functional-iteration waivers across the full in-scope repository, and all existing quality, test, type, and build gates SHALL pass without product-behavior changes
