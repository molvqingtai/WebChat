## Why

WebChat currently maintains overlapping ESLint and Prettier dependencies and configuration, and its `lint` command both checks and rewrites source through a relatively heavy plugin stack. Migrating fully to oxfmt and oxlint gives the repository one explicit formatter, one explicit linter, and consistent fix-and-verify behavior across local development, staged files, CI, and release workflows.

## What Changes

- **BREAKING** Replace Prettier and ESLint completely with oxfmt and oxlint; remove their configuration, dependencies, caches, scripts, and workflow references.
- Make oxfmt the only repository formatter and oxlint the only repository linter.
- Allow normal local format and lint commands to fix source files.
- Add explicit read-only check commands for diagnosing formatting and lint violations.
- Run the fixing commands in CI/CD and then fail with `git diff --exit-code` if those commands produced uncommitted changes; CI does not commit or push fixes.
- Report `linter` and `tests` as separate GitHub Actions jobs/checks. Both depend only on shared setup, run independently, and must pass before merge; unit tests are not a step inside `linter`.
- Update lint-staged and Husky integration so staged source is formatted and lint-fixed by the new tools.
- Keep Conventional Commit validation and `tsc --noEmit` as separate gates.
- Use non-type-aware oxlint for this migration; TypeScript remains the type-analysis authority.
- Apply the new formatter and linter to the repository source as part of the migration, including safe automatic source corrections.
- Treat the existing uncommitted `eslint.config.ts`, `package.json`, and `pnpm-lock.yaml` dependency-upgrade work as migration input: preserve compatible upgrades, remove superseded tooling changes, and do not discard user work.

## Capabilities

### New Capabilities

- `source-quality-tooling`: The repository-wide formatter, linter, local command, staged-file, CI/CD, and source-correction contract.

### Modified Capabilities

- None. This repository was initialized with OpenSpec for this change and has no archived stable capability specs yet.

## Impact

- Root `package.json`, lockfile, ESLint/Prettier and new Oxc configuration files, lint-staged/Husky behavior, ignore files, editor recommendations where present, and CI/CD workflows.
- All source and supported configuration/documentation files in the oxfmt/oxlint scope may receive deterministic formatting or safe lint fixes.
- Existing Chrome/Firefox build and package behavior must remain unchanged.
- No product behavior, browser-extension permissions, protocol, storage, WebRTC, or user-interface requirement changes are intended.

## Non-Goals

- No type-aware oxlint migration in this change.
- No automatic CI commit or push.
- No unrelated refactor or product behavior change.
- No removal of commitlint, TypeScript checks, Chrome/Firefox builds, or browser smoke-test responsibilities.

## Acceptance Criteria

- No active ESLint or Prettier dependency, config, script, cache, lint-staged, Husky, CI, CD, or documentation reference remains, except migration history explaining their removal.
- Local fix commands produce a clean source tree when rerun; check commands pass without modifying files.
- CI/CD run the same fix contract and `git diff --exit-code`; GitHub Actions reports independent `linter` and `tests` checks, and lint, unit tests, type checking, and required Chrome/Firefox builds all pass before merge.
- The migration candidate preserves and accounts for the pre-existing dirty dependency-upgrade work.
- The final candidate passes OpenSpec strict validation and all repository quality/build gates without changing extension product behavior.
