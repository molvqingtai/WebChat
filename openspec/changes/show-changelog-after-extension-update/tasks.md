## 1. Freeze Trigger, State, And Content Boundaries

- [x] 1.1 Record the current background/Options/release flow and freeze package-version transition, first-baseline, same-version, downgrade, stale-pending, and acknowledgement semantics.
- [x] 1.2 Define one validated `browser.storage.local` observed/pending/deduplicated-shown-history record plus canonical page path under `src/constants/changelog.ts`; explicitly exclude it from message/configuration persistence resets.
- [x] 1.3 Freeze `CHANGELOG.md` as the only locally packaged release-note source, including supported semantic-release headings, package-version parity, offline/fallback behavior, and no remote media/fetch.

## 2. Implement Update Reconciliation

- [x] 2.1 Add a dependency-injected Changelog coordinator with synchronous `runtime.onInstalled` registration, startup reconciliation, strict version comparison, malformed-state baseline repair, and single-flight ownership.
- [x] 2.2 Persist pending intent before tab work; query/focus an existing internal page or create one active tab; retain pending on failure/interruption and reject stale acknowledgements.
- [x] 2.3 Add deterministic controls for first install, first feature-bearing update with no stored state, update/downgrade, acknowledged-version return, same-version reload, missing `previousVersion`, startup-before-event ordering, browser update, pending retry, stale supersession, concurrent signals, one-live-tab behavior, storage/tab failures, and page acknowledgement.

## 3. Build The Internal Changelog Page

- [x] 3.1 Add a WXT Changelog entrypoint that bundles raw `CHANGELOG.md`, extracts the current semantic-release section, verifies installed-version identity, and renders a nonblank local fallback on mismatch.
- [x] 3.2 Render the local WebChat logo, restrained version metadata, unframed single-release reading column, version/date/current notes, icon-plus-text repository/exact Release/issue actions, light/dark and reduced-motion states, responsive layout, semantic landmarks/headings, keyboard focus, and no remote-loading Markdown elements.
- [x] 3.3 Acknowledge the installed version only after the current or fallback surface renders; ensure manual Options access uses the same path and acknowledgement.
- [x] 3.4 Change the existing Options version control from the generic external Releases index to the internal page without adding settings, permissions, or navigation duplication.
- [ ] 3.5 Replace the Owner-rejected timeline presentation in `App.tsx`/`App.test.ts` with the compact shadcn release record: exact `New version` eyebrow, existing version/date Badges, three existing outline Button actions, natural document scrolling, tight note spacing, shared fallback shell, and no release spine, timeline dot, forced empty band, page-level card, or shared-primitive edit.

## 4. Protect Release And Persistence Boundaries

- [x] 4.1 Add a dependency-free package-version/top-changelog parity test, major/non-major extraction tests, current-section boundary tests, fallback tests, and no-network/raw-HTML/image-rendering controls.
- [ ] 4.2 Prove Changelog state survives both persistence reset families and Changelog operations never read, write, clear, or trigger message/configuration stores.
- [x] 4.3 Preserve existing semantic-release generation/package order, Chrome MV3 and Firefox MV2 manifests, permissions, dependencies, Runtime, peer wire, and application feedback behavior.

## 5. Delivery Gates

- [ ] 5.1 Run focused fail-before controls, then full test/type/lint/format/build and strict OpenSpec gates on one immutable implementation exact.
- [ ] 5.2 Verify both packaged browser artifacts contain the internal page and local current notes, and obtain fresh Reviewer findings for lifecycle idempotence, crash boundaries, content safety, version parity, accessibility, and scope.
- [ ] 5.3 Record nonblocking real-browser evidence for first install silence, one different-version open, same-version restart silence, manual Options reopening, offline content, exact links, and zero duplicate live tabs where available; capture 915x694 and 360px-wide light/dark screenshots and verify the compact header-to-notes sequence, absent timeline/dead space, three-Button desktop grid, one-column narrow actions, nonblank pixels, framing, focus, natural page scroll, overflow, and overlap; never report unavailable scenarios as PASS.
- [ ] 5.4 Keep this requirement on one independent branch/PR and wait for separate explicit Owner merge authorization.
