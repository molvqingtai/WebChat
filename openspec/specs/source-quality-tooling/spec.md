# source-quality-tooling Specification

## Purpose
TBD - created by archiving change migrate-to-oxfmt-and-oxlint. Update Purpose after archive.
## Requirements
### Requirement: Oxc tools are the sole formatter and linter

The repository SHALL use oxfmt as its only source formatter and oxlint as its only source linter. Active ESLint and Prettier dependencies, configuration, scripts, caches, editor integration, staged-file integration, and workflow integration MUST be removed.

#### Scenario: Search active tooling references

- **WHEN** the migration candidate is inspected outside immutable package-manager history and migration documentation
- **THEN** active quality-tool references SHALL resolve to oxfmt and oxlint and SHALL NOT invoke ESLint or Prettier

#### Scenario: Install frozen dependencies

- **WHEN** dependencies are installed from the committed manifest and lockfile
- **THEN** oxfmt and oxlint SHALL be available and removed ESLint/Prettier packages SHALL NOT be direct project dependencies

### Requirement: Local commands can correct source

The repository SHALL provide explicit local commands that allow oxfmt and oxlint to apply supported corrections to source files. It SHALL also provide read-only check commands that report violations without modifying files.

#### Scenario: Run formatter fix

- **WHEN** a developer runs the format command on nonconforming supported files
- **THEN** oxfmt SHALL rewrite those files to the repository format contract

#### Scenario: Run linter fix

- **WHEN** a developer runs the lint command on safely fixable violations
- **THEN** oxlint SHALL apply supported fixes and report remaining violations

#### Scenario: Run read-only checks

- **WHEN** a developer runs the format-check and lint-check commands on a clean tree
- **THEN** both commands SHALL exit successfully without changing files

#### Scenario: Rerun fixes

- **WHEN** the format and lint fix commands are rerun after a successful correction pass
- **THEN** they SHALL produce no additional source diff

### Requirement: Type checking remains a separate gate

The migration SHALL use non-type-aware oxlint and SHALL preserve TypeScript `tsc --noEmit` as the repository's type-analysis gate.

#### Scenario: Run type checking

- **WHEN** the source contains a TypeScript type error that non-type-aware oxlint does not detect
- **THEN** the TypeScript check command SHALL fail independently

#### Scenario: Inspect oxlint configuration

- **WHEN** the oxlint command and configuration are inspected
- **THEN** they SHALL NOT enable type-aware linting in this migration

### Requirement: Staged files use Oxc corrections

The repository's staged-file workflow SHALL run oxfmt and oxlint fixes for the supported staged source set and SHALL stage the corrected content through the existing lint-staged/Husky flow.

#### Scenario: Commit a nonconforming staged source file

- **WHEN** a developer commits a supported staged source file with fixable format or lint violations
- **THEN** the staged workflow SHALL apply oxfmt and oxlint corrections before commit validation completes

#### Scenario: Commit an unfixable staged violation

- **WHEN** oxlint reports an unfixable staged violation
- **THEN** the commit SHALL be blocked and the violation SHALL remain visible to the developer

### Requirement: CI and CD fix then verify repository cleanliness

CI and CD SHALL run the repository format and lint fix commands and then execute `git diff --exit-code` before accepting the quality gate. CI/CD MUST NOT automatically commit or push corrections.

#### Scenario: CI encounters clean source

- **WHEN** the committed source already conforms to oxfmt and oxlint
- **THEN** fix commands SHALL leave no diff and the cleanliness check SHALL pass

#### Scenario: CI corrects committed source

- **WHEN** a fix command changes committed source in CI or CD
- **THEN** `git diff --exit-code` SHALL fail the workflow and expose the uncommitted correction

#### Scenario: CI correction behavior

- **WHEN** CI or CD generates a source correction
- **THEN** the workflow SHALL NOT commit that correction, push it to the branch, or recursively trigger another run

### Requirement: Existing quality and build gates remain

The migration SHALL preserve Conventional Commit validation, TypeScript checking, and required Chrome and Firefox build behavior. The migration MUST NOT change extension permissions, runtime product behavior, protocols, storage contracts, or browser feature scope.

#### Scenario: Validate migration candidate

- **WHEN** the final migration candidate is verified
- **THEN** commit validation, TypeScript checking, Chrome build, and Firefox build SHALL pass under the updated quality workflow

#### Scenario: Compare extension behavior

- **WHEN** built Chrome and Firefox extensions are smoke-tested on the migration candidate
- **THEN** extension loading and core chat entry behavior SHALL match the pre-migration product contract

### Requirement: CI reports linter and unit tests independently

The GitHub Actions CI workflow SHALL expose `linter` and `tests` as separate named jobs/checks. Both jobs SHALL depend only on the shared setup job and SHALL be eligible to run independently after setup. `linter` SHALL retain the existing format/lint correction, repository-cleanliness verification, and WXT/TypeScript check. Because each job has an isolated workspace, `tests` SHALL generate WXT types in its own job before running the canonical `pnpm run test` command; it SHALL NOT depend on `linter` or absorb format, lint, TypeScript, or build responsibilities. The existing `build` job, workflow triggers, package scripts, application behavior, and browser scope SHALL remain unchanged. Merge acceptance SHALL require successful terminal results for `linter`, `tests`, and `build` on the same final exact.

#### Scenario: Inspect the CI job graph

- **WHEN** the final workflow is inspected after shared setup
- **THEN** `linter`, `tests`, and `build` SHALL be sibling jobs, `tests` SHALL generate WXT types before `pnpm run test`, `pnpm run test` SHALL appear only in `tests`, and neither `linter` nor `tests` SHALL depend on the other

#### Scenario: Run tests in an isolated job workspace

- **WHEN** the `tests` job starts from a clean checkout after shared setup
- **THEN** it SHALL generate the WXT types required by the repository TypeScript configuration before invoking `pnpm run test`, without relying on files generated by `linter`

#### Scenario: Linter fails independently

- **WHEN** setup succeeds and `linter` fails
- **THEN** the `linter` check SHALL report that failure while `tests` remains independently eligible to run and report its own terminal result

#### Scenario: Unit tests fail independently

- **WHEN** setup succeeds and `pnpm run test` fails
- **THEN** the `tests` check SHALL report that failure without relabeling it as a linter failure or suppressing the independent `linter` result

#### Scenario: Accept the final pull request exact

- **WHEN** the final exact is considered for merge
- **THEN** its separate `linter`, `tests`, and `build` checks SHALL all have successful terminal results

### Requirement: Chrome Runtime control follows built manifest identity

The Chrome Runtime CI harness SHALL derive the content isolated execution-context name from the `manifest.json` inside the selected built Chrome extension directory. It SHALL structurally parse that artifact, require a non-empty top-level string `name`, and match the execution context against that exact value. It SHALL NOT hardcode either a historical or current product display name. A missing, malformed, or invalid built manifest name SHALL fail explicitly. The extension display name, WXT configuration, Runtime behavior, workflow, browser scope, and existing Runtime-control assertions SHALL remain unchanged.

#### Scenario: Product display name changes

- **WHEN** a valid product display-name change is emitted as the selected Chrome artifact's manifest `name`
- **THEN** the Runtime control SHALL discover the content isolated execution context using that artifact value without requiring a harness-copy update

#### Scenario: Built manifest identity is unavailable

- **WHEN** the selected Chrome artifact's manifest is missing, malformed, or has no non-empty string `name`
- **THEN** the Runtime control SHALL fail with an explicit manifest-identity error instead of waiting for a hardcoded context name to time out

#### Scenario: Preserve the existing Runtime boundary

- **WHEN** the harness resolves the artifact-derived isolated context
- **THEN** all existing extension-target, Offscreen, service-worker, authenticated relay, presence, diagnostic, timeout, and cleanup controls SHALL continue unchanged

### Requirement: Existing dependency-upgrade work is preserved and reconciled

The existing uncommitted changes in `eslint.config.ts`, `package.json`, and `pnpm-lock.yaml` SHALL be treated as input to the migration. Compatible dependency upgrades SHALL be preserved, superseded ESLint/Prettier work SHALL be replaced, and user changes MUST NOT be silently discarded.

#### Scenario: Establish migration provenance

- **WHEN** implementation begins
- **THEN** the implementer SHALL record the base HEAD and the pre-existing diff for all three dirty files before editing

#### Scenario: Review final dependency diff

- **WHEN** the final candidate is reviewed
- **THEN** the handoff SHALL distinguish preserved pre-existing upgrades, removed superseded tooling, newly introduced Oxc dependencies, and lockfile consequences

### Requirement: Source correction scope remains tooling-only

Oxfmt and oxlint corrections MAY modify repository source and supported configuration files, but the migration SHALL NOT intentionally change product behavior or perform unrelated refactors.

#### Scenario: Review changed source

- **WHEN** a source change is not a deterministic formatter result or a safe oxlint fix
- **THEN** it SHALL be justified as necessary for the tooling migration or removed from the candidate

#### Scenario: Detect product behavior change

- **WHEN** verification finds a change to extension permissions, room behavior, message protocol, persistence, or visible user workflow
- **THEN** the migration candidate SHALL be blocked until that change is removed or separately specified through OpenSpec
