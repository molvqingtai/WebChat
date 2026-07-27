> **Completion status (2026-07-28):** All implementation, review, CI, publication, and merge tasks are complete. Final accepted exact `5a7bb4a12c301bd4e51b4904253739e41091a4f8` passed fresh Actions run `30298778315` with independent `linter`, `tests`, and `build` checks, including Chrome MV3 and Firefox MV2 verification. PR #69 merged through `6627e8fc1b27aa7754e79ca1c40ae77321fd7fc0`; `develop` later received Owner commit `fff7da8e4e6f320a86d45670e108cd97451955e5` (`feat!: release WebChat 2.0`). Master publication then merged `develop` through `3cad760b9988041995234c4cee762c3ea5598b66`; semantic-release completed `v2.0.0` at `fcd1c372e107629c442751015d5e61847cecf09e` and created tag `v2.0.0`. These remain separate history points outside this archived change. Runs `30293583612` and `30297016430` remain immutable fail-before evidence; completed task markers do not reinterpret either failed run as PASS.

## 1. Provenance And Inventory

- [x] 1.1 Record base HEAD, branch, full worktree status, and separate staged/unstaged patches for the pre-existing `eslint.config.ts`, `package.json`, and `pnpm-lock.yaml` changes before implementation.
- [x] 1.2 Inventory every active ESLint/Prettier dependency, config, ignore, cache, package script, lint-staged entry, Husky hook, editor setting, documentation reference, and CI/CD invocation.
- [x] 1.3 Inventory current ESLint rules/plugins and map each material quality intent to oxlint, TypeScript, build validation, an explicit accepted gap, or removal as obsolete formatting behavior.
- [x] 1.4 Confirm installed oxfmt/oxlint CLI flags and supported config schema from the pinned candidate versions before writing commands.

## 2. Oxc Toolchain

- [x] 2.1 Add compatible pinned oxfmt and oxlint development dependencies and create minimal repository configuration and ignore scope.
- [x] 2.2 Add fixing `format` and `lint` scripts plus read-only `format:check` and `lint:check` scripts using verified CLI flags.
- [x] 2.3 Remove ESLint, Prettier, and their direct plugins/config packages, configuration files, cache behavior, and active references without discarding compatible pre-existing dependency upgrades.
- [x] 2.4 Regenerate and review `pnpm-lock.yaml`, distinguishing preserved upgrades, removed tooling, new Oxc packages, and transitive consequences.

## 3. Developer Workflow

- [x] 3.1 Update lint-staged so supported staged files receive oxfmt and oxlint fixes while unfixable violations block commit.
- [x] 3.2 Preserve Husky and Conventional Commit validation while removing obsolete ESLint/Prettier hook behavior.
- [x] 3.3 Update repository guidance and editor recommendations so developers use Oxc fix/check commands and no active document instructs them to run ESLint or Prettier.

## 4. CI And CD

- [x] 4.1 Update each applicable CI workflow to run format and lint fixes followed immediately by `git diff --exit-code`, then retain TypeScript and required build gates.
- [x] 4.2 Update each applicable CD/release workflow to enforce the same fix-plus-diff cleanliness contract without commit/push permissions or recursive write-back behavior.
- [x] 4.3 Verify workflow ordering prevents build/package outputs from contaminating the source-cleanliness diff check.

## 5. Source Correction

- [x] 5.1 Run oxfmt across its configured repository scope and retain deterministic corrections to supported source/configuration/documentation files.
- [x] 5.2 Run oxlint fix across its configured source scope, review every non-format correction, and remove or separately specify any behavior change or unrelated refactor.
- [x] 5.3 Rerun both fixing commands and prove idempotence with a clean `git diff` relative to the post-fix candidate.
- [x] 5.4 Search for active ESLint/Prettier remnants and either remove them or document the narrow historical/non-executable reason they remain.

## 6. Verification And Handoff

- [x] 6.1 Verify frozen dependency installation, fixing commands, read-only format/lint checks, and `git diff --check` on the exact candidate.
- [x] 6.2 Exercise lint-staged/Husky with one fixable staged fixture and one unfixable lint fixture without committing fixture changes.
- [x] 6.3 Run TypeScript checking and production Chrome and Firefox builds; record exact commands, exit status, and output artifacts.
- [x] 6.4 Smoke-test loading and core chat entry in built Chrome and Firefox extensions to confirm no intended product behavior change.
- [x] 6.5 Run OpenSpec status, strict change validation, repository-wide strict validation, and doctor; resolve all errors.
- [x] 6.6 Freeze an exact clean candidate with parent/tree/SHA and a handoff that accounts for every pre-existing dirty-file change, rule-coverage difference, source correction, and known limitation.
- [x] 6.7 Route Planner evidence review, Reviewer, and QA; UX/Tester browser acceptance is required only if verification finds visible or runtime behavior changes beyond deterministic tooling output.

## 7. Independent CI Linter And Test Checks

- [x] 7.1 From Owner-local exact `2b143a23aa8f07baec7db800b4b8505ad7740e03`, preserve the existing `package.json` display-name change and create a fresh docs-authority child followed by a workflow-only child. In `.github/workflows/ci.yml`, remove `pnpm run test` from `linter`; add a sibling `tests` job that depends only on `setup`, reuses the existing checkout/Node/pnpm/cache/install pattern, and runs only `pnpm run test`. Retain `linter` format/lint/diff/WXT-TypeScript behavior, the existing `build` job, triggers, scripts, lockfile, source, Runtime, protocol, persistence, and browser scope.
- [x] 7.2 Route a fresh no-gate Reviewer over both the direct workflow diff and the cumulative delta from `b13a5e29421d4ef01e21ac87398d3007615c5495`. The cumulative delta SHALL contain only the Owner `package.json` display-name commit, the PM OpenSpec authority, and `.github/workflows/ci.yml`; prior evidence SHALL NOT certify those additions.
- [x] 7.3 After Reviewer PASS under the Owner's standing current-release authorization, publish the immutable final exact, update the PR body using product goals/outcomes and verification rather than implementation details, and require same-exact successful terminal `linter`, `tests`, and `build` Actions checks. No additional browser/QA route is required. Only then may the Owner-authorized PR merge proceed.

## 8. Repair Independent CI Failures

This section supersedes task 7.1's literal `tests`-runs-only wording, task 7.2's prior cumulative scope, and task 7.3's first published exact. WXT type generation is a test-workspace prerequisite, not a new test-job quality responsibility; job independence and the three-check merge requirement remain unchanged.

- [x] 8.1 Treat published run `30293583612` on exact `c31f7d376cb9a203b45c40c695b88011e19ebe7d` as a fail-after, not release evidence: `tests` failed before collection because its isolated workspace lacked generated WXT types; `linter` failed because oxfmt produced one uncommitted `src/domain/AppFeedback.ts` correction; `build` failed while the Chrome Runtime control waited for an isolated execution context. Keep PR body update and merge blocked.
- [x] 8.2 Create a docs-only child of `c31f7d376cb9a203b45c40c695b88011e19ebe7d`, then a fresh implementation child whose direct scope is exactly `.github/workflows/ci.yml` and `src/domain/AppFeedback.ts`. In `tests`, generate WXT types after dependency setup and before `pnpm run test`, while keeping `needs: [setup]` and no linter dependency. Commit only the deterministic oxfmt result in `AppFeedback.ts`; any semantic, import, identifier, command, event, descriptor, message, or behavior change is forbidden. Preserve linter/build/triggers/scripts/lockfile and all other source, Runtime, protocol, persistence, and browser boundaries.
- [x] 8.3 Route a fresh no-gate Reviewer over the direct two-file implementation diff and the cumulative delta from `b13a5e29421d4ef01e21ac87398d3007615c5495`. The cumulative delta SHALL contain only the Owner `package.json` display-name change, the four CI OpenSpec artifacts, `.github/workflows/ci.yml`, and the format-only `src/domain/AppFeedback.ts` correction. Prior Review, test, smoke, or Actions evidence SHALL NOT certify the replacement exact.
- [x] 8.4 Publish the replacement exact by normal fast-forward only after Reviewer PASS, then require a fresh same-exact Actions run in which separate `linter`, `tests`, and `build` checks all reach successful terminal states. Do not waive or pre-classify the prior Chrome Runtime timeout as flaky; the fresh `build` result determines whether a separate diagnosis is required. Only after all three pass may the product-level PR body update and Owner-authorized merge resume. No additional local or agent browser/QA route is required.

## 9. Repair Artifact-Named Chrome Context Discovery

This section supersedes task 8.4's expectation that exact `a03e2d168b5bd65476a516226f2b48a862c58a30` could close the release. The successful independent `linter` and `tests` checks remain exact-local evidence only; the failed `build` keeps that published exact non-releaseable.

- [x] 9.1 Treat Actions run `30297016430` on published exact `a03e2d168b5bd65476a516226f2b48a862c58a30` as a second Chrome build fail-after: `setup`, `linter`, and `tests` passed, but `build` again timed out while matching the content isolated execution context. The recent successful run `30210802257` and both failures used Chrome `151.0.7922.47`; the failed run mounted the content application in about 329ms. The blocker is the harness's hardcoded `WebChat` context name after the Owner's valid `package.json` display-name change flowed through WXT to the built manifest, not a browser upgrade or missing content script. Keep PR body update and merge blocked.
- [x] 9.2 Create a docs-only child of `a03e2d168b5bd65476a516226f2b48a862c58a30`, then a fresh implementation child whose direct scope is exactly `e2e/chrome-runtime.ts`. Use the existing selected Chrome extension directory, structurally parse its built `manifest.json`, require a non-empty top-level string `name`, and match the content isolated execution context against that exact artifact value. Missing, malformed, or invalid manifest identity SHALL fail explicitly. Do not hardcode either display-name string or add a fallback. Preserve the Owner display name, `package.json`, WXT config, workflow, dependencies, lockfile, timeouts, Runtime assertions, application source, Runtime, protocol, persistence, permissions, and browser scope.
- [x] 9.3 Route a fresh independent no-gate Review over the direct one-file harness diff and the cumulative delta from `b13a5e29421d4ef01e21ac87398d3007615c5495`. The cumulative delta SHALL contain only the Owner `package.json` display-name change, the four CI OpenSpec artifacts, `.github/workflows/ci.yml`, the format-only `src/domain/AppFeedback.ts` correction, and `e2e/chrome-runtime.ts`. Prior Review, test, smoke, or Actions evidence SHALL NOT certify the replacement exact.
- [x] 9.4 Publish the replacement exact by normal fast-forward only after Review PASS, then require a fresh same-exact Actions run in which separate `linter`, `tests`, and `build` checks all reach successful terminal states. The Chrome control must pass using artifact-derived identity; a rerun, timeout extension, hardcoded rename, or waiver is not acceptance. Only after all three pass may the product-level PR body update and Owner-authorized merge resume. No additional local or agent browser/QA route is required.
