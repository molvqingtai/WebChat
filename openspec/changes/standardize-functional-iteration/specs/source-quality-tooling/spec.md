## ADDED Requirements

### Requirement: Authored iteration expresses results directly with minimal state

Every manually maintained tracked JavaScript and TypeScript file SHALL express collection traversal with the shortest behavior-equivalent standard operation and the fewest necessary variables. A traversal that maps, filters, flattens, finds, tests, groups, indexes, or accumulates a result SHALL return or assign that direct result instead of declaring an outer mutable temporary and updating it during traversal.

The clean authority base contains 305 tracked files matching `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.mjs`, or `*.cjs`. Exactly `.agents/skills/archify/renderers/shared/generated-validators.mjs` SHALL be excluded because it is generated and marked not to be edited by hand; the other 304 files SHALL comprise the complete authored scope. Tests, fixtures, harnesses, configuration, tracked tools, formatter/linter ignore patterns, and the generated validator's source generator SHALL NOT create additional exclusions.

Authored source SHALL contain no `forEach`. It SHALL NOT replace `forEach` mechanically with another loop or use a value-producing method only for iteration while discarding its result.

`for`, `for...of`, `for await...of`, and `for...in` SHALL all be treated as `for` statements. A `for` statement MAY remain only when its behavior requires a genuine `break`, `continue`, or function early return that `find`, `some`, `every`, or another direct operation cannot express equivalently. Syntax variant, asynchronous iteration, live collection membership, ordered effects, or lack of a convenient bulk API SHALL NOT by itself permit a `for` statement. A control-flow keyword SHALL NOT permit a loop when a direct short-circuiting method remains equivalent.

A condition-driven `while` or `do...while` MAY remain only when its changing termination condition is the behavior being modeled. It SHALL NOT be used as an alternate spelling of indexed or iterable collection traversal.

#### Scenario: Replace an outer temporary accumulator

- **GIVEN** authored code declares a mutable value before traversal, changes it for each item, and reads it as the traversal result
- **WHEN** an equivalent reduction can produce that value
- **THEN** the code SHALL assign or return the `reduce` result directly with no outer mutable accumulator

#### Scenario: Return a direct collection transformation

- **GIVEN** authored code builds a mapped, filtered, flattened, grouped, indexed, matching, or predicate result through manual traversal
- **WHEN** a standard collection or object-entry operation expresses the same order, multiplicity, and return behavior
- **THEN** the code SHALL use and directly return or assign that operation without avoidable intermediate traversal variables

#### Scenario: Reject a mechanical forEach rewrite

- **GIVEN** a `forEach` callback updates external state or invokes repeated effects
- **WHEN** the iteration is standardized
- **THEN** it SHALL NOT become `for...of`, another `for` variant, or an ignored-result `map` or `reduce`; the owner SHALL instead use an existing bulk operation or build a local replacement and commit it once

#### Scenario: Preserve only irreducible for control flow

- **GIVEN** a `for` statement uses `break`, `continue`, or a function early return
- **WHEN** no direct standard operation preserves its actual control flow and observable behavior
- **THEN** that loop MAY remain without a waiver annotation

#### Scenario: A for syntax variant does not create an exception

- **GIVEN** authored traversal uses `for...of`, `for await...of`, or `for...in` without irreducible `break`, `continue`, or function early-return behavior
- **WHEN** the final source is inspected
- **THEN** the traversal SHALL be replaced by a direct behavior-equivalent operation just like an ordinary `for` statement

#### Scenario: Preserve condition-driven iteration

- **GIVEN** a `while` or `do...while` models termination from a changing condition rather than collection exhaustion
- **WHEN** no direct collection expression preserves that condition-driven behavior
- **THEN** the loop MAY remain, while collection-style uses SHALL be replaced

### Requirement: Functional callbacks do not create external side effects

A callback passed to a result-oriented collection or object-entry operation SHALL derive and return its result without mutating an input, outer binding, shared collection, singleton, cache, or other externally reachable object. It SHALL NOT perform DOM, browser, storage, database, wire, persistence, event-dispatch, timer, logging, or other I/O or external commit behavior. A result-oriented method SHALL NOT be used only as a carrier for ignored callback effects.

A `reduce` callback MAY mutate its accumulator only when the accumulator is created for the current invocation, is exclusively owned by that reduction, is not reachable through an input or outer/shared state, and cannot escape before the reduction completes. The callback SHALL return that accumulator for the next reduction step. This local accumulator mutation SHALL NOT be classified as an external side effect.

The existing `assembleURL` implementation SHALL remain unchanged: its `new URL(url)` accumulator is fresh, exclusive, and non-escaping during reduction, so its local `searchParams.append` mutation conforms to this requirement.

#### Scenario: Reject mutation of an outer binding

- **GIVEN** a functional callback assigns, increments, pushes into, deletes from, or otherwise changes a value declared outside that callback
- **WHEN** the callback is evaluated against this standard
- **THEN** it SHALL be rejected as an external side effect and the traversal result SHALL be expressed directly

#### Scenario: Reject mutation of reachable state

- **GIVEN** a functional callback mutates an input, closed-over object, shared collection, storage owner, DOM owner, event owner, persistence owner, or another externally reachable value
- **WHEN** the final source is inspected
- **THEN** the callback SHALL be rejected even when the traversal method returns a value

#### Scenario: Allow a private reducer accumulator

- **GIVEN** a reduction creates a fresh accumulator for that invocation and the accumulator cannot be reached or observed outside the reduction while it runs
- **WHEN** its callback mutates and returns only that accumulator
- **THEN** the reduction SHALL conform without cloning the accumulator on every step

#### Scenario: Preserve assembleURL

- **GIVEN** `assembleURL` reduces `Object.entries(params)` into `new URL(url)`, appends each entry to that private URL, and serializes it after reduction
- **WHEN** the iteration cleanup is implemented
- **THEN** that reducer SHALL remain byte-for-byte unchanged and SHALL NOT be rewritten as an external-side-effect fix

### Requirement: Functional-iteration cleanup uses only existing repository tooling

The cleanup SHALL use Oxfmt as the sole formatter, Oxlint as the sole linter, and TypeScript as the type-analysis gate. The existing Oxlint configuration MAY enable a built-in rule already shipped by the installed toolchain when it exactly enforces part of this standard. The implementation MUST NOT add, register, load, generate, or depend on an Oxlint plugin, local rule plugin, parser, second linter, dependency, custom semantic scanner, committed scan script, or source enforcement module.

No `owner-commit`, `functional-loop`, lint-disable, or other new waiver annotation SHALL make a nonconforming loop or callback acceptable. Semantic boundaries not expressible by existing tools SHALL remain source-review requirements rather than creating a second enforcement path.

The cleanup SHALL add no test case, test abstraction, fixture, assertion, mock capability, or coverage requirement. Existing test, fixture, and harness files SHALL remain in authored scope and MAY receive only the minimum behavior-equivalent iteration or private-state ownership edits required by the same standard. An existing private fixture owner MAY replace its complete internal state once when that removes repeated external mutation, but its exposed object and behavior SHALL remain equivalent. Test scenarios, inputs, expectations, timing, ordering, public fixture contracts, and coverage SHALL remain unchanged.

Every source rewrite SHALL preserve evaluation and iteration order, call multiplicity, synchronous or asynchronous execution and concurrency, return values, thrown and rejected errors, object identity, mutation visibility, event and timer ordering, DOM behavior, storage and database operations, wire and persistence behavior, generated output, product behavior, public interfaces, extension permissions, protocols, and dependencies.

#### Scenario: Inspect the authored manifest

- **WHEN** the final implementation manifest is derived from the clean authority base
- **THEN** it SHALL contain exactly 304 authored JavaScript/TypeScript files, exclude only the exact generated validator, and include its generator plus every tracked test, harness, configuration, tool, and ignored source file

#### Scenario: Inspect enforcement changes

- **WHEN** the implementation diff and dependency graph are inspected
- **THEN** they SHALL contain no new plugin, parser, linter, dependency, scanner, enforcement module, waiver convention, or hand edit to the generated validator

#### Scenario: Preserve existing test evidence without expanding it

- **WHEN** an existing test, fixture, or harness file requires iteration or private-state ownership cleanup
- **THEN** only the minimum behavior-equivalent implementation MAY change, while its public fixture contract, scenario, input, assertion, expected value, timing, ordering, mock capability, abstraction boundary, and coverage SHALL remain identical

#### Scenario: Verify behavior-neutral source

- **WHEN** the immutable source candidate runs the repository's existing format, lint, typecheck, test, build, generated-artifact, OpenSpec, and cleanliness gates and receives fresh independent review
- **THEN** all gates SHALL pass without product, protocol, persistence, generated-output, dependency, or observable behavior change

#### Scenario: Hold delivery boundaries

- **WHEN** the docs or source pull request is published and reviewed
- **THEN** it SHALL remain Draft and SHALL NOT be browser-tested, marked Ready, merged, deployed, released, or applied to production without separate Owner authority
