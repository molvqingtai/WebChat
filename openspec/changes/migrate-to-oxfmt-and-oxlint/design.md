## Context

WebChat currently uses ESLint 10, Prettier 3, `eslint-plugin-prettier`, TypeScript ESLint, React ESLint, Tailwind ESLint, and related configuration. `pnpm lint` invokes ESLint with `--fix --cache`; lint-staged invokes the same behavior for JavaScript and TypeScript. CI/CD install dependencies and run project gates through GitHub Actions.

The worktree at `develop@9c58d6b2` already contains user-owned dependency-upgrade edits in `eslint.config.ts`, `package.json`, and `pnpm-lock.yaml`. In particular, the dirty ESLint config is internally incomplete because a Prettier import is commented while its configuration reference remains. These edits must not be reset or overwritten. This migration uses them as explicit input and produces one auditable reconciled candidate.

The change is repository-wide and may rewrite source, but it is a quality-tool migration rather than a product change. Browser behavior, WebRTC protocols, storage, permissions, and UI remain outside scope.

## Goals / Non-Goals

**Goals:**

- Make oxfmt and oxlint the sole formatting and linting tools.
- Give developers simple fix commands plus explicit read-only checks.
- Use the same correction contract in staged files and CI/CD.
- Fail CI/CD when generated corrections were not committed, without granting write-back behavior.
- Preserve TypeScript, commit validation, and Chrome/Firefox build gates.
- Reconcile rather than discard the current dirty dependency-upgrade work.

**Non-Goals:**

- Type-aware oxlint.
- Automated CI commits or pushes.
- Rule-for-rule emulation of every historical ESLint plugin if oxlint has no equivalent.
- Product, protocol, permission, storage, or UI changes.
- Unrelated refactors discovered while formatting or linting.

## Decisions

### 1. Replace the old toolchain atomically

Remove ESLint and Prettier together with their direct plugins/configuration and replace them with oxfmt and oxlint in one candidate. Keeping both toolchains during a transition creates two authorities for formatting and lint decisions and leaves scripts/workflows ambiguous.

Alternative rejected: gradual coexistence. The owner explicitly chose complete replacement.

### 2. Separate fix commands from diagnostic check commands

`format` runs oxfmt in write mode; `format:check` performs a read-only format check. `lint` runs oxlint with safe fixes enabled; `lint:check` performs read-only lint validation. Exact flags must be selected from the installed package versions and verified rather than assumed.

The developer-default commands can correct source as requested. Explicit check commands remain useful for editors, diagnosis, and proving idempotence.

Alternative rejected: make `lint` read-only. The owner requires the normal workflow to correct source.

### 3. CI/CD run fixes, verify generated diff, and report tests independently

GitHub workflows run the same format and lint correction commands used locally, followed by `git diff --exit-code`. A correction therefore makes the workflow fail and exposes the required patch; it is not silently accepted.

The CI workflow exposes `linter` and `tests` as separate named jobs/checks. Both depend only on the shared `setup` job and may run in parallel. `linter` retains format/lint correction, cleanliness verification, and the existing WXT/TypeScript check; `tests` owns `pnpm run test`. Neither job contains or depends on the other, so a failure remains attributable and the other result still reaches an independent terminal state. The existing `build` job and its browser boundaries remain unchanged.

Alternative rejected: CI bot commits. That would require write permissions, complicate fork/third-party PR security, create recursive workflow risk, and make author provenance less clear.

Alternative rejected: run fixes without diff verification. Such a workflow can report success while the branch remains nonconforming.

Alternative rejected: keep unit tests as the final step inside `linter`. That collapses two different failure domains into one Actions result and prevents an earlier linter failure from producing an independent test result.

### 4. Keep lint-staged as the staged-file orchestrator

Preserve Husky and lint-staged, replacing only the commands and supported file mapping. Staged supported source is formatted and lint-fixed before commit. Commitlint remains independent.

Alternative rejected: replace Husky/lint-staged. It is unrelated to the requested tool migration and adds unnecessary workflow change.

### 5. Use non-type-aware oxlint plus TypeScript

Configure oxlint without type-aware analysis and retain `tsc --noEmit`. The lint migration should not simultaneously change the repository's type-analysis semantics.

Alternative rejected: enable type-aware oxlint immediately. Rule support and performance need a separate evaluation after the base migration is stable.

### 6. Prefer Oxc-native rules and document intentional coverage differences

Translate existing quality intent into supported oxlint categories/plugins and explicit configuration. Do not preserve ESLint plugins solely for compatibility. Any material lost rule coverage must be listed in the implementation handoff, with TypeScript or another retained gate identified where it supplies equivalent protection.

Alternative rejected: force exact rule parity through a mixed ESLint/Oxc stack. That violates complete replacement and retains maintenance complexity.

### 7. Reconcile the dirty worktree with explicit provenance

Before editing, capture base HEAD, staged and unstaged status, and diffs for `eslint.config.ts`, `package.json`, and `pnpm-lock.yaml`. Build from the shared worktree state or a provenance-preserving worktree prepared by Planner. Compatible package upgrades remain; obsolete ESLint/Prettier dependencies and config are removed; Oxc entries and resulting lockfile changes are added.

Do not use reset, checkout, or any restoration that drops the user's edits. Handoff must account for each original dirty file.

### 8. Accept source rewrites but block unrelated behavior changes

Run the Oxc correction commands across their configured repository scope. Deterministic format output and safe lint fixes may change source. Review the non-mechanical remainder separately; any product behavior or unrelated refactor is removed or specified in another change.

The formatting pass does not need its own isolated commit. The final history may group configuration, dependency, and corrected-source work pragmatically, but provenance must remain auditable.

## Risks / Trade-offs

- [Oxfmt output creates a large diff] -> Separate config/dependency review from source-output review and verify idempotence with a second fix pass.
- [Oxlint does not match an ESLint plugin rule] -> Inventory old rules, map supported equivalents, document meaningful gaps, and retain TypeScript/build protection.
- [Fix mode changes behavior] -> Review non-format source edits, run type/build gates, and smoke-test both browser outputs.
- [CI modifies generated or ignored artifacts] -> Define explicit Oxc scopes/ignore patterns and confirm a clean second pass.
- [Dirty dependency work is lost or misattributed] -> Capture pre-edit staged/unstaged patches and include an ownership reconciliation in handoff evidence.
- [CI diff check includes build output] -> Run fix-and-diff cleanliness before build steps or ensure generated output is ignored and not part of the check.
- [Lint and unit-test failures are reported as one result] -> Keep `linter` and `tests` as sibling jobs that depend only on shared setup, and require both before merge.
- [Different Oxc versions expose different flags/defaults] -> Pin compatible versions in the lockfile and derive commands from those installed CLIs.

## Migration Plan

1. Record exact base HEAD, worktree status, and staged/unstaged patches for the three existing dirty files.
2. Inventory all ESLint/Prettier dependencies, configs, ignores, scripts, lint-staged entries, Husky hooks, editor settings, documentation, and CI/CD references.
3. Add pinned-compatible oxfmt/oxlint dependencies and minimal repository configuration; update package scripts and lint-staged.
4. Remove superseded tool dependencies/configuration and reconcile the pre-existing package/lock changes.
5. Update CI/CD to run format/lint fixes, `git diff --exit-code`, and TypeScript in `linter`; run unit tests in an independent sibling `tests` job; retain existing browser gates.
6. Apply Oxc corrections across the configured scope, review non-mechanical changes, and rerun to prove idempotence.
7. Verify frozen install, format/lint fixes, read-only checks, staged-file behavior, TypeScript, Chrome/Firefox builds, OpenSpec strict validation, and browser smoke behavior.
8. Freeze an exact candidate and route independent review/quality verification before push. Merge requires owner acceptance and explicit authorization under the team workflow.

Rollback is code-only: revert the migration candidate as one logical change while preserving a patch of the original dirty dependency-upgrade inputs. No user data or extension storage migration is involved.

## Open Questions

None. The owner confirmed complete replacement, dirty-work reconciliation, source correction, CI fix-plus-diff behavior, and non-type-aware oxlint on 2026-07-18.
