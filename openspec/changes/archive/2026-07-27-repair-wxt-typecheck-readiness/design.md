## Context

At clean `develop@b140b68dc8b2635e95ade977dfa504c94b7663c2`, root `package.json` defines `check` as `tsc --noEmit` and `postinstall` as `wxt prepare`. The CI linter job installs dependencies, runs formatter/linter fixes plus `git diff --exit-code`, and then runs `pnpm run check`. A restored dependency tree does not guarantee that the current checkout's ignored `.wxt/tsconfig.json` exists or that the root lifecycle regenerated it.

The independent Archify PR #73 has immutable head `5ee76d1a195f26958e0866df87aa97ece4e28a22`. Its fresh CI and the current `develop` CI both fail type checking with the same missing generated WXT environment and unresolved `#imports`/existing `@/...` aliases. The Archify exact does not touch the affected root WXT/TypeScript contract, so it must stay frozen while the base is repaired separately.

## Goals / Non-Goals

**Goals:**

- Make the canonical TypeScript gate self-contained in fresh and cache-restored environments.
- Preserve strict `tsc --noEmit` behavior and existing aliases.
- Keep one local/CI entry point and one minimal source delta.
- Preserve ignored generated-output ownership.
- Unblock an exact-bound CI rerun for the unchanged Archify head after the base repair lands.

**Non-Goals:**

- Workflow or dependency-cache redesign.
- TypeScript config relaxation, import rewrites, source changes, dependency updates, or committed `.wxt` output.
- Any Archify, Runtime, protocol, persistence, product, browser, or UI change.
- Any merge or release decision.

## Decisions

### 1. The canonical check script owns WXT preparation

Root `package.json` SHALL define the exact script:

```json
"check": "wxt prepare && tsc --noEmit"
```

The left side creates the checkout-specific ignored WXT TypeScript environment; shell short-circuiting ensures TypeScript runs only after successful preparation. The existing CI command `pnpm run check` therefore gains the same readiness behavior as a local invocation without a duplicated workflow-only sequence.

Alternative rejected: add only a CI workflow step. That leaves local and other automation entry points dependent on hidden order and creates two typecheck contracts.

Alternative rejected: depend only on `postinstall`. Cache restoration or an already-installed dependency tree can leave the current checkout without generated WXT state.

### 2. Keep postinstall but treat it as an optimization, not authority

The existing `postinstall: wxt prepare` MAY remain unchanged for normal installation ergonomics. It does not satisfy or replace the check script's own preparation requirement.

Alternative rejected: remove `postinstall` in this repair. Its broader developer/build implications are unnecessary to resolve the gate.

### 3. Generated WXT state remains disposable and untracked

`.wxt/**` remains ignored and SHALL NOT enter the commit, cache key authority, or review surface. Verification deletes or starts without `.wxt`, runs the canonical check, proves `.wxt/tsconfig.json` was created, and confirms the tracked worktree remains clean.

Alternative rejected: commit `.wxt/tsconfig.json`. It is generated checkout state and would couple source history to WXT output.

### 4. Preserve failure semantics and quality gates

If `wxt prepare` fails, the gate fails without running TypeScript. If `tsc --noEmit` finds a real error, that error remains visible and fails the gate. No skip, waiver, alias rewrite, error suppression, or `continue-on-error` is allowed. Existing format/lint fix-plus-diff behavior and Chrome/Firefox build gates remain unchanged.

### 5. Keep remediation and publication histories independent

The implementation candidate is a sole child of clean `develop@b140b68...` with exactly root `package.json` as its non-OpenSpec source/config delta. It is reviewed, pushed, and proposed through its own PR. It must not amend, rebase, merge into, or become part of the immutable Archify head or Runtime ancestry.

After explicit Owner authorization merges the base repair into `develop`, PR #73 keeps head `5ee76d1...` unchanged and receives a fresh CI run against the repaired base. PR #73 merge remains a separate explicit Owner decision.

## Risks / Trade-offs

- [Preparation adds time to every typecheck] -> Accept the small deterministic cost in exchange for a self-contained gate.
- [WXT preparation changes ignored files] -> Assert `.wxt` remains ignored and tracked diff stays clean across repeated checks.
- [Preparation failure hides TypeScript output] -> This is intentional ordering; report the earlier causal failure rather than running against invalid generated state.
- [A broader CI issue appears after this fix] -> Stop and report the new exact failure; do not widen this candidate.
- [Archify PR is treated as fixed by inheritance alone] -> Require a fresh PR #73 CI run against the repaired `develop` base; no verdict transfers.

## Migration Plan

1. Freeze the clean `develop` identity and reproduce the current missing-`.wxt` failure without modifying source.
2. Create a detached clean child and change only root `package.json` `check` to the exact frozen script.
3. Starting without `.wxt`, run the canonical check twice and verify generated readiness, TypeScript success, and zero tracked diff.
4. Run repository format/lint checks, OpenSpec strict validation, Chrome and Firefox builds, and diff/scope checks on the candidate.
5. Freeze one immutable exact, route independent Reviewer validation, then push/open a separate base-remediation PR and run fresh exact-bound CI.
6. Ask the Owner for explicit merge authorization only after all gates pass. After merge, rerun PR #73 CI against the repaired base without changing its head.

Rollback is code-only: revert the one root script change. No user data, extension state, protocol, schema, or migration is involved.

## Open Questions

None. The repair is intentionally limited to making the existing strict typecheck gate establish its required WXT generated environment.
