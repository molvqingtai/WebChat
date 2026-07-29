# wxt-typecheck-readiness Specification

## Purpose

TBD - created by archiving change repair-wxt-typecheck-readiness. Update Purpose after archive.

## Requirements

### Requirement: Canonical TypeScript gate prepares WXT state

The root `check` script SHALL be exactly `wxt prepare && tsc --noEmit`. The installed WXT prepare command SHALL settle successfully before strict TypeScript checking begins. CI and local automation SHALL invoke this canonical script rather than depend on an earlier install lifecycle as the only WXT-generation prerequisite.

#### Scenario: Typecheck starts without generated WXT state

- **WHEN** installed dependencies are present but `.wxt` is absent
- **THEN** `pnpm run check` SHALL generate `.wxt/tsconfig.json` and then run `tsc --noEmit` successfully against the unchanged source

#### Scenario: Typecheck starts with existing generated WXT state

- **WHEN** `.wxt` already contains current generated state
- **THEN** `pnpm run check` SHALL safely refresh that state and run the same strict TypeScript gate

#### Scenario: WXT preparation fails

- **WHEN** `wxt prepare` rejects or exits non-zero
- **THEN** the canonical check SHALL fail immediately and SHALL NOT report a successful or independently executed TypeScript gate

#### Scenario: TypeScript detects a real error

- **WHEN** WXT preparation succeeds but `tsc --noEmit` reports a type error
- **THEN** the canonical check SHALL fail with that error and SHALL NOT suppress, waive, or rewrite it

### Requirement: Generated WXT state remains disposable

`.wxt/**` SHALL remain ignored generated checkout state. The repair SHALL NOT commit `.wxt/tsconfig.json` or any other generated WXT file, and repeated canonical checks SHALL leave no tracked diff.

#### Scenario: Review generated output ownership

- **WHEN** `pnpm run check` creates or refreshes `.wxt`
- **THEN** `.wxt/**` SHALL remain ignored, absent from the candidate commit, and removable before the next successful check

#### Scenario: Repeat the canonical check

- **WHEN** the canonical check is run twice on one unchanged checkout
- **THEN** both runs SHALL pass and the second run SHALL leave the tracked worktree clean

### Requirement: Install lifecycle is not the typecheck authority

The existing `postinstall` WXT preparation MAY remain for installation ergonomics, but a successful or previously cached install SHALL NOT be treated as proof that the current checkout is ready for TypeScript. The canonical check SHALL establish readiness itself.

#### Scenario: Dependencies are restored from cache

- **WHEN** `node_modules` is restored or already present while the checkout has no `.wxt`
- **THEN** `pnpm run check` SHALL not require lifecycle replay and SHALL prepare the current checkout before TypeScript
