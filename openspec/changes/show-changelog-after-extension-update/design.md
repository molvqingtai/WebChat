## Context

WebChat is released by semantic-release. During release preparation it updates `package.json` and prepends the new version/date/notes to `CHANGELOG.md`, then runs the existing package command that builds the Chrome and Firefox artifacts. This controlled order makes the repository changelog the correct offline source for the page: normal branch builds see the current released version, while a semantic-release package build sees the newly prepared version and notes.

The extension already has `storage` and `tabs` permissions, an Options page with an external version link, and a cross-browser background entrypoint. Chrome MV3 can suspend the background worker; Firefox MV2 retains a background page. Update handling therefore needs synchronous listener registration plus durable recovery rather than a one-shot in-memory callback.

The persistence reset requirement owns the canonical message database, per-origin AppStatus `localStorage`, and extension-wide UserInfo `browser.storage.sync`. Changelog acknowledgement is extension operational metadata in `browser.storage.local` and must not participate in either destructive reset family.

## Goals / Non-Goals

**Goals:**

- Open or focus one internal Changelog tab after a known extension package version changes.
- Never auto-open on first install or same-version reload.
- Retry an attempt interrupted before the page acknowledges rendering, without creating two live Changelog tabs.
- Render the current release notes offline from the semantic-release-maintained `CHANGELOG.md`.
- Show the installed version, release date when available, update notes, repository, exact Release, and issue-feedback destinations.
- Let the existing Options version control reopen the internal page at any time.
- Present that information as a compact single-release record with a centered header built from the project's existing shadcn primitives, without the rejected decorative timeline, header divider, or large empty bands.
- Preserve cross-browser behavior, current permissions/dependencies, and persistence-version separation.

**Non-Goals:**

- Fetching GitHub releases, commits, contributors, avatars, Markdown, analytics, ShieldCN badges, or remote images at runtime.
- Replacing semantic-release, rewriting historical changelog entries, or creating a second release-note source of truth.
- Opening on first install, browser updates, same-version extension reloads, content-script reinjection, or ordinary background restarts.
- Treating a package version as a message/configuration persistence version or triggering any data reset.
- Adding notification badges, Toasts, modals, onboarding tours, permissions, dependencies, telemetry, dismiss/snooze controls, or marketing content.
- Adding or modifying shared shadcn primitives, forcing a page-level card around the release, or constraining the whole document inside a nested scroll area.
- Guaranteeing that a tab created immediately before an unrecoverable whole-browser crash was visibly painted; the durable guarantee begins when the page acknowledges a rendered state.

## Decisions

### 1. Observed, pending, and shown versions form one durable state machine

One extension-local record in `browser.storage.local` SHALL contain only the latest relevant package-version state:

```ts
interface ChangelogState {
  observedVersion: string
  pendingVersion?: string
  shownVersions: string[]
}
```

`shownVersions` SHALL contain only unique valid extension-version strings and SHALL retain every version that successfully rendered, so a later upgrade/downgrade cycle cannot auto-open an already acknowledged release again. Any other stored shape is malformed and follows the quiet baseline repair rule.

The storage key and internal page path SHALL be declared in a domain-named `src/constants/changelog.ts` module. They are new application constants and SHALL not be duplicated in background, Options, or page code.

The background SHALL register `runtime.onInstalled` synchronously. That event is the eager update signal, while startup reconciliation is the interruption fallback. Both paths use the same single-flight operation and current `runtime.getManifest().version`:

- startup with no valid stored `observedVersion` means first baseline: persist the current version and do not open;
- an `onInstalled` event whose reason is `update` and whose valid nonempty `previousVersion` differs from current is trusted transition evidence even when no prior state exists, so users updating into the first release of this feature still receive its Changelog;
- absent that trusted event evidence, current version equal to `observedVersion` means ordinary restart/reload: do not open;
- a different current version means a package-version transition: atomically advance `observedVersion`, set `pendingVersion` to current unless `shownVersions` already contains current, and reconcile the page;
- `runtime.onInstalled` reason `install`, `browser_update`, or another non-extension-update reason cannot independently force an open; and
- a stale pending version is superseded by the current version, so only installed content is shown.

`details.previousVersion` is trusted only on the eager `update` event; it is not a durable substitute for stored observation because browsers and interrupted workers can omit or lose the original event. The event SHALL still schedule the current version when startup happened to baseline it before event delivery, unless that current version is already in `shownVersions`. Versions are compared for strict inequality, not semantic ordering, so a deliberate downgrade is also a different installed version; an acknowledged downgraded version remains suppressed by the retained history.

Before creating a tab, reconciliation SHALL search existing tabs for the internal Changelog page. A match is focused (including its window) instead of duplicated. Otherwise it creates one active tab. Concurrent signals in the same background lifetime share one in-flight operation. A page that reaches its rendered current or explicit fallback state idempotently appends current to `shownVersions` and clears the matching pending value. Manual opening through Options performs the same acknowledgement.

After acknowledgement, that version SHALL not auto-open again. Before acknowledgement, a failure or worker interruption leaves the version pending for later startup reconciliation. At-most-once applies to an acknowledged version; pre-acknowledgement retries are allowed, but reconciliation SHALL maintain at most one live Changelog tab.

### 2. The packaged repository changelog is the only release-note source

The Changelog entrypoint SHALL bundle `CHANGELOG.md` as local build input. It SHALL parse the controlled top semantic-release heading, accepting both major (`#`) and non-major (`##`) release headings, and extract the version, ISO release date, and body up to the next release heading. The page SHALL compare the extracted version to the installed manifest/package version.

A dependency-free source/build test SHALL require the checked-in package version to match the top changelog entry during ordinary builds. Semantic-release already updates both before its package command, so no release script, generator, network call, or manually duplicated release registry is added.

The renderer SHALL not enable raw HTML and SHALL suppress Markdown images or any other element that could initiate a remote request. Ordinary links remain inert until the user activates them. If current-note parsing unexpectedly fails or the versions disagree at runtime, the page SHALL render an explicit local fallback containing the installed version and outbound repository/Release/issue links rather than showing stale notes, going blank, or fetching a replacement. That fallback is a rendered state and SHALL acknowledge the version to prevent an update loop.

### 3. The page is a compact shadcn release record, not a timeline or marketing surface

The first viewport SHALL center the local WebChat logo, product heading, installed version, and optional release date as one compact header. The visible `New version` eyebrow SHALL be removed, while the primary semantic heading SHALL continue to identify `WebChat v<installed version>`. The update-note body follows with its semantic headings, lists, commit/compare links, and inline code preserved. GitHub destinations SHALL be derived from existing package metadata rather than duplicated base URLs and SHALL be explicit commands:

- repository home from `homepage`;
- matching `<homepage>/releases/tag/v<installed version>`;
- issue creation at `<bugs.url>/new`.

External destinations SHALL open only after activation, in a separate tab with no opener relationship.

The Options version control SHALL navigate to the internal Changelog page instead of the generic external Releases index. This gives first-install users manual access without auto-opening and lets updated users return after closing the automatic tab.

The page SHALL use the existing WebChat logo and only existing visual primitives, support system light/dark preference, remain readable from narrow mobile-like extension windows through desktop widths, and expose semantic landmarks, heading order, action names, keyboard focus, and reduced-motion behavior. It SHALL not use a marketing hero, decorative gradients/orbs, a page-level or nested card, remote imagery, animation required for comprehension, feature instructions, or unrelated settings.

The subject is one installed WebChat release and the user's single job is to scan what changed, then optionally open one of three destinations. The unique visual signature SHALL be a compact centered release stamp: the locally sourced logo sits above the product heading and shadcn version/date metadata, followed immediately by the semantic release notes. It encodes the installed artifact without pretending that one release is a multi-step timeline.

The visual direction SHALL be specific to that job:

- use the existing shadcn `background`, `foreground`, `muted`, `border`, `accent`, and focus-ring tokens for the shell and controls; reserve emerald for restrained release accents such as list markers and action icons, and sky for inline Markdown links so the page does not become a one-note slate surface;
- the existing WebChat sans role for brand, heading, and body copy, with `ui-monospace` reserved for version/date/commit metadata and zero custom letter spacing;
- one unframed reading column no wider than the existing `max-w-3xl` measure, with 24-32 CSS pixels of desktop outer padding and 16-24 pixels on narrow viewports;
- one compact centered header in which the local logo, `WebChat` heading, shadcn `Badge` version, and optional outline date badge form a vertical release stamp: logo above heading and a centered wrapping metadata row below; the semantic heading name remains `WebChat v<installed version>` even when version is visually carried by the badge;
- no eyebrow, ShieldCN or other remote badge, bottom border, rule, or divider between the header and release notes; the first release-note heading begins within 32 CSS pixels of the centered metadata row, with no forced section minimum height, vertical spine, timeline dot, or empty band used to fill the viewport; and
- a final responsive action group using the existing shadcn `Button` with `asChild`, `variant="outline"`, Lucide icon, visible text, and stable at-least-40-pixel height for Repository, exact Release, and Report an issue.

The version SHALL use the existing `Badge` secondary treatment and the date, when present, SHALL use its outline treatment; absence of a release date omits that badge without reserving space. The three action buttons SHALL fill a three-column grid at desktop widths and a one-column stack at narrow widths. Notes SHALL use natural page scrolling: the existing `ScrollArea` SHALL not wrap or height-limit the document, because an internal scrollbar would add a second navigation surface without a bounded tool-panel need. Tables and code MAY retain local horizontal overflow containment.

The centered header SHALL remain legible without oversized hero typography and SHALL not reserve the deleted eyebrow's space. The Markdown body SHALL keep compact, consistent heading/list/paragraph spacing and preserve inline-code and commit-link legibility. Motion is limited to existing Button/link focus and hover feedback and is removed under reduced-motion preference; the local shadcn metadata Badges remain static labels rather than controls. The rendered fallback SHALL use the same header, density, and action group rather than a visually separate error card.

The visual replacement SHALL affect only `src/app/changelog/App.tsx` and its focused `App.test.ts`. It SHALL import `Badge` and `Button` from `src/components/ui` without editing, copying, or wrapping the shared primitives. Version detection, acknowledgement, background reconciliation, local release-note extraction, Markdown safety, outbound URL derivation, offline behavior, and persistence isolation SHALL remain byte-for-byte outside this visual child.

### 4. Failure is silent, bounded, and isolated

The background SHALL not create a tab unless the pending intent has been durably stored. Storage read/write failure, tab query/create/focus failure, malformed state, or page acknowledgement failure MAY emit bounded privacy-safe `console` diagnostics only. No content Toast, `AppFeedback`, notification, alert, badge, or status mutation is allowed.

Malformed state is treated as no trustworthy baseline and, absent a trusted update event, repaired to the current baseline without auto-opening; it must not cause an update loop. A tab-operation failure retains a valid pending version so a later lifecycle can retry. Successful acknowledgement clears only its matching pending version, deduplicates the shown history, and cannot overwrite a newer observed version.

The Changelog record SHALL remain outside `CONFIG_STORE_VERSION` cleanup and message-database deletion. Conversely, clearing or changing Changelog state SHALL not touch AppStatus, UserInfo, messages, Runtime state, or persistence version markers. No new manifest permission or dependency is needed.

## Risks / Trade-offs

- [A suspended MV3 worker can miss completion after `onInstalled`] -> Register synchronously, persist pending intent before tab work, acknowledge from the rendered page, and reconcile on later startup.
- [Two update/startup signals can open duplicate tabs] -> Use one in-memory single-flight plus an existing-page query/focus step; assert one live tab in deterministic tests.
- [A crash can occur between tab creation and visible paint] -> Do not mark shown on `tabs.create`; only the rendered page acknowledges. Retrying before acknowledgement is intentional.
- [Release notes can drift from the package version] -> Consume semantic-release's checked-in changelog and add an exact top-version build test plus a non-stale runtime fallback.
- [Markdown can initiate network activity] -> Bundle raw text locally, disable raw HTML, and suppress images/remote-loading elements.
- [Operational metadata can be erased by persistence migration] -> Keep its `browser.storage.local` key outside both reset families and test the boundary.

## Migration Plan

1. Freeze and review this docs-only authority on an independent branch/PR from current `develop`; make no source changes before approval.
2. Add the constants, state-machine module/tests, synchronous background registration, Changelog WXT entrypoint, local Markdown extraction/rendering, and Options navigation in one source child on the same requirement branch/PR. Apply the later visual replacement only in `App.tsx`/`App.test.ts` as another child of the accepted implementation exact on that same branch/PR.
3. Run focused fail-before controls, full source/static/build gates, Chrome MV3 and Firefox MV2 bundle assertions, and fresh Review on one immutable exact. Browser behavior checks are nonblocking but must record actual update/first-install/manual-navigation evidence where available.
4. Merge only after separate explicit Owner authorization. Archive the OpenSpec change independently after delivery.

Rollback removes the entrypoint/listener/navigation and its dedicated local metadata key. It does not require or authorize deleting any user or message data.

## Open Questions

None. The Owner delegated product design; the trigger, retry/acknowledgement model, offline content source, page information hierarchy, permanent access, failure behavior, and persistence isolation are fixed here.
