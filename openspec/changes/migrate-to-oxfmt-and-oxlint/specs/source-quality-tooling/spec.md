## ADDED Requirements

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
