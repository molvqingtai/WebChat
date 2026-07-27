## Why

The `develop` CI typecheck can run after `node_modules` has been restored without a usable generated `.wxt/tsconfig.json`. The current `check` script invokes `tsc --noEmit` directly and therefore assumes that an earlier install lifecycle generated WXT's TypeScript environment. That hidden precondition makes the same repository exact fail with unresolved `#imports` and existing `@/...` aliases in CI.

This inherited base failure also blocks the independent Archify PR even though its 55-path tooling delta does not touch WXT, TypeScript, application source, or the root workflow. The canonical typecheck gate must establish its own generated prerequisite so fresh and cache-restored environments behave the same.

## What Changes

- Make the canonical root `check` script run the installed WXT prepare command before `tsc --noEmit`.
- Freeze the exact script contract as `wxt prepare && tsc --noEmit`.
- Keep CI invoking `pnpm run check` so local and CI type checking use one self-contained gate.
- Keep the existing `postinstall` WXT preparation, but do not rely on install lifecycle execution as the only typecheck prerequisite.
- Keep `.wxt/**` generated, ignored, and uncommitted.
- Deliver the repair as an independent clean-`develop` child and separate PR before re-running the unchanged Archify PR against the repaired base.

## Capabilities

### New Capabilities

- `wxt-typecheck-readiness`: Self-contained WXT generation and TypeScript gate behavior across fresh and cache-restored environments.

### Modified Capabilities

- None.

## Impact

- Root `package.json` `check` script only for source implementation.
- New OpenSpec authority files for this repair.
- No application source, root workflow, dependency, lockfile, WXT configuration, generated `.wxt`, Archify, Runtime, protocol, persistence, browser behavior, or UI change.

## Non-Goals

- No TypeScript relaxation, alias rewrite, source import rewrite, skip, waiver, `continue-on-error`, or generated-file commit.
- No dependency or WXT version change.
- No cache redesign, CI workflow refactor, or unrelated quality-tooling change.
- No amendment, rebase, or scope expansion of Archify exact `5ee76d1...` or Runtime PR #69.
- No merge or release authorization.

## Acceptance Criteria

- With `.wxt` absent and installed dependencies present, `pnpm run check` first generates the WXT TypeScript environment and then passes `tsc --noEmit` on the unchanged base source.
- A WXT prepare failure prevents TypeScript from running and fails the gate; a TypeScript failure remains visible and fails the gate.
- Repeated `pnpm run check` calls are successful and do not create a tracked diff.
- `.wxt/tsconfig.json` exists after preparation but `.wxt/**` remains ignored and absent from the candidate commit.
- The source candidate is a clean, detached, unpushed, no-ref sole child of `develop@b140b68dc8b2635e95ade977dfa504c94b7663c2` whose production/config delta is exactly root `package.json`.
- Fresh independent review and exact-bound CI pass before the base repair may be merged; merge requires explicit Owner authorization.
