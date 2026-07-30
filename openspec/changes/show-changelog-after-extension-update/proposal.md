## Why

WebChat updates currently complete without telling the user what changed. GitHub contains generated release notes, but an extension update should not depend on network availability or require the user to discover the Releases page. The installed extension needs one restrained, durable Changelog surface that opens after a real version transition, remains available from Options, and never confuses an ordinary release version with a persistence-data migration version.

## What Changes

- Add an internal Changelog extension page and open or focus it once after the installed extension changes from one known package version to a different package version. First install, same-version reload, browser update, and a missing-baseline startup without trusted update-event evidence establish or preserve state without opening it; a first feature-bearing update still opens from its valid `previousVersion` signal.
- Persist extension-local observed/pending/deduplicated-shown-history bookkeeping. An interrupted pre-render attempt remains retryable; a successfully rendered version is never auto-opened again, and reconciliation never creates a second live Changelog tab.
- Package the release notes locally from the repository `CHANGELOG.md` used by semantic-release. The page renders the installed version's current section without fetching GitHub or any other remote content; a release build gate keeps the top changelog version aligned with the package version.
- Present the WebChat version, release date when available, this update's notes, and direct links to the GitHub repository, the matching tagged Release, and issue feedback. The existing Options version control opens this internal page so the user can return later.
- Replace the rejected release-spine presentation with one compact, unframed release record: a tight logo/title/version/date header, notes beginning immediately below it, and a responsive action group built from the project's existing shadcn `Badge` and `Button` primitives. Keep natural document scrolling and remove the decorative timeline, large dead space, and bare-link footer.
- Keep the page operational and compact: responsive light/dark presentation, semantic headings and lists, keyboard-visible actions, no marketing hero, page-level card, nested document scroller, remote media, permission prompt, update success Toast, or unrelated settings.
- Keep Changelog bookkeeping in `browser.storage.local`, outside the message/configuration persistence-reset families. Package-version updates trigger only the Changelog behavior; they do not imply data deletion, migration, or protocol changes.

## Capabilities

### New Capabilities

- `extension-changelog`: Define update detection, idempotent open/retry behavior, locally packaged release-note content, information hierarchy, permanent access, isolation, and failure behavior.

### Modified Capabilities

None.

## Impact

- Affected implementation after authority approval: a new WXT Changelog entrypoint, background update reconciliation, Options version navigation, locally bundled changelog parsing/rendering, extension-local state, and focused tests. The visual replacement child is restricted to `src/app/changelog/App.tsx` and `src/app/changelog/App.test.ts`, importing existing primitives without changing them.
- Affected release flow after authority approval: the package version and top semantic-release changelog entry must agree before packaging; semantic-release remains the release-note source of truth.
- Affected tests after authority approval: first install, first feature-bearing update, upgrade/downgrade and shown-history behavior, same-version reload, pending recovery, existing-tab focus, one-live-tab concurrency, manual access, state/storage/tab failures, current/fallback content, outbound links, offline rendering, responsive/theme states, and Chrome/Firefox bundle presence.
- Unchanged surfaces: chat/World behavior, Runtime lifecycle, peer wire, message/configuration persistence versions, user data, permissions, dependencies, GitHub release generation, and existing extension-page visual language.
