## 1. Provenance And Inventory

- [ ] 1.1 Record base HEAD, branch, full worktree status, and separate staged/unstaged patches for the pre-existing `eslint.config.ts`, `package.json`, and `pnpm-lock.yaml` changes before implementation.
- [ ] 1.2 Inventory every active ESLint/Prettier dependency, config, ignore, cache, package script, lint-staged entry, Husky hook, editor setting, documentation reference, and CI/CD invocation.
- [ ] 1.3 Inventory current ESLint rules/plugins and map each material quality intent to oxlint, TypeScript, build validation, an explicit accepted gap, or removal as obsolete formatting behavior.
- [ ] 1.4 Confirm installed oxfmt/oxlint CLI flags and supported config schema from the pinned candidate versions before writing commands.

## 2. Oxc Toolchain

- [ ] 2.1 Add compatible pinned oxfmt and oxlint development dependencies and create minimal repository configuration and ignore scope.
- [ ] 2.2 Add fixing `format` and `lint` scripts plus read-only `format:check` and `lint:check` scripts using verified CLI flags.
- [ ] 2.3 Remove ESLint, Prettier, and their direct plugins/config packages, configuration files, cache behavior, and active references without discarding compatible pre-existing dependency upgrades.
- [ ] 2.4 Regenerate and review `pnpm-lock.yaml`, distinguishing preserved upgrades, removed tooling, new Oxc packages, and transitive consequences.

## 3. Developer Workflow

- [ ] 3.1 Update lint-staged so supported staged files receive oxfmt and oxlint fixes while unfixable violations block commit.
- [ ] 3.2 Preserve Husky and Conventional Commit validation while removing obsolete ESLint/Prettier hook behavior.
- [ ] 3.3 Update repository guidance and editor recommendations so developers use Oxc fix/check commands and no active document instructs them to run ESLint or Prettier.

## 4. CI And CD

- [ ] 4.1 Update each applicable CI workflow to run format and lint fixes followed immediately by `git diff --exit-code`, then retain TypeScript and required build gates.
- [ ] 4.2 Update each applicable CD/release workflow to enforce the same fix-plus-diff cleanliness contract without commit/push permissions or recursive write-back behavior.
- [ ] 4.3 Verify workflow ordering prevents build/package outputs from contaminating the source-cleanliness diff check.

## 5. Source Correction

- [ ] 5.1 Run oxfmt across its configured repository scope and retain deterministic corrections to supported source/configuration/documentation files.
- [ ] 5.2 Run oxlint fix across its configured source scope, review every non-format correction, and remove or separately specify any behavior change or unrelated refactor.
- [ ] 5.3 Rerun both fixing commands and prove idempotence with a clean `git diff` relative to the post-fix candidate.
- [ ] 5.4 Search for active ESLint/Prettier remnants and either remove them or document the narrow historical/non-executable reason they remain.

## 6. Verification And Handoff

- [ ] 6.1 Verify frozen dependency installation, fixing commands, read-only format/lint checks, and `git diff --check` on the exact candidate.
- [ ] 6.2 Exercise lint-staged/Husky with one fixable staged fixture and one unfixable lint fixture without committing fixture changes.
- [ ] 6.3 Run TypeScript checking and production Chrome and Firefox builds; record exact commands, exit status, and output artifacts.
- [ ] 6.4 Smoke-test loading and core chat entry in built Chrome and Firefox extensions to confirm no intended product behavior change.
- [ ] 6.5 Run OpenSpec status, strict change validation, repository-wide strict validation, and doctor; resolve all errors.
- [ ] 6.6 Freeze an exact clean candidate with parent/tree/SHA and a handoff that accounts for every pre-existing dirty-file change, rule-coverage difference, source correction, and known limitation.
- [ ] 6.7 Route Planner evidence review, Reviewer, and QA; UX/Tester browser acceptance is required only if verification finds visible or runtime behavior changes beyond deterministic tooling output.

## 7. Independent CI Linter And Test Checks

- [ ] 7.1 From Owner-local exact `2b143a23aa8f07baec7db800b4b8505ad7740e03`, preserve the existing `package.json` display-name change and create a fresh docs-authority child followed by a workflow-only child. In `.github/workflows/ci.yml`, remove `pnpm run test` from `linter`; add a sibling `tests` job that depends only on `setup`, reuses the existing checkout/Node/pnpm/cache/install pattern, and runs only `pnpm run test`. Retain `linter` format/lint/diff/WXT-TypeScript behavior, the existing `build` job, triggers, scripts, lockfile, source, Runtime, protocol, persistence, and browser scope.
- [ ] 7.2 Route a fresh no-gate Reviewer over both the direct workflow diff and the cumulative delta from `b13a5e29421d4ef01e21ac87398d3007615c5495`. The cumulative delta SHALL contain only the Owner `package.json` display-name commit, the PM OpenSpec authority, and `.github/workflows/ci.yml`; prior evidence SHALL NOT certify those additions.
- [ ] 7.3 After Reviewer PASS and separate Owner authorization for the diverged remote-history strategy, publish the immutable final exact, update the PR body using product goals/outcomes and verification rather than implementation details, and require same-exact successful terminal `linter`, `tests`, and `build` Actions checks. No additional browser/QA route is required. Only then may the Owner-authorized PR merge proceed.
