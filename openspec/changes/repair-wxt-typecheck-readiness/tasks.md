## 1. Baseline And FAIL-Before

- [x] 1.1 Record clean `develop@b140b68dc8b2635e95ade977dfa504c94b7663c2` identity, tree, branch/ref state, workflow/package hashes, and the failed base/Archify CI run identities.
- [x] 1.2 In a disposable clean checkout with installed dependencies and `.wxt` absent, run the unchanged `pnpm run check` twice and preserve the unresolved `#imports`/existing-alias FAIL-before plus tracked-clean status.
- [x] 1.3 Prove the failure is absent from the 55 allowed Archify paths and do not transfer any Archify/Runtime verdict to this candidate.

## 2. Minimal Repair

- [x] 2.1 Create a detached clean child of `b140b68...` and change only root `package.json` `check` from `tsc --noEmit` to exact `wxt prepare && tsc --noEmit`.
- [x] 2.2 Keep `postinstall`, `.gitignore`, workflow, lockfile, dependency versions, TypeScript/WXT config, application source, Archify, Runtime, protocol, persistence, browser, and UI bytes unchanged.
- [x] 2.3 Add no generated `.wxt` path, skip, waiver, `continue-on-error`, alias rewrite, source workaround, or cache-specific branch.

## 3. Candidate Verification

- [x] 3.1 Remove ignored `.wxt`, run `pnpm run check`, and prove WXT creates `.wxt/tsconfig.json` before strict TypeScript passes.
- [x] 3.2 Run the canonical check a second time and prove successful idempotence, zero tracked diff, and no committed `.wxt` file.
- [x] 3.3 Prove failure propagation with a disposable WXT-prepare failure control and a disposable real TypeScript-error control without retaining fixture changes.
- [x] 3.4 Run applicable format/lint fix-plus-diff and read-only checks, Chrome and Firefox production builds, OpenSpec target/all strict/status/doctor, and `git diff --check` on frozen inputs.
- [x] 3.5 Freeze one clean, detached, unpushed, no-ref sole child with exact/tree/parent, one-path executable scope, patch hashes, fail-before/final evidence, and unchanged protected-input hashes; then STOP.

## 4. Independent Review And Publication

- [x] 4.1 Planner reviews only the requirements/decomposition authority; Planner does not issue a source verdict.
- [ ] 4.2 Reviewer independently audits the frozen source exact, test sensitivity, one-path scope, failure propagation, unchanged gates, and evidence. Only `FINAL PASS` releases publication.
- [ ] 4.3 Push the immutable exact on an independent branch, open a separate `develop`-base PR, and track fresh exact-bound CI to terminal success without merge.
- [ ] 4.4 After successful review/CI, ask the Owner for explicit base-remediation merge authorization. Commit, push, and PR update require no separate authorization.
- [ ] 4.5 After the repair merges to `develop`, keep PR #73 head exactly `5ee76d1a...`, run fresh CI against the repaired base, and keep Archify merge separately unauthorized until its own exact-bound gates and Owner decision.
