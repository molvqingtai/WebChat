## ADDED Requirements

### Requirement: A real extension-version transition opens one internal Changelog page

WebChat SHALL maintain one validated extension-local Changelog state containing one observed version, at most one pending version, and a deduplicated history of successfully shown package versions. The state key and internal Changelog path SHALL have one owner under `src/constants/changelog.ts`. The state SHALL use `browser.storage.local` and SHALL remain outside all message/configuration persistence reset scopes.

The background SHALL synchronously register the extension-install/update listener and SHALL use the same single-flight reconciliation during background startup. A startup with missing or malformed observed state SHALL establish the current installed version as a non-opening baseline. An `onInstalled` event with reason `update` and a valid nonempty `previousVersion` strictly different from current SHALL be trusted transition evidence even when stored state is absent or startup already baselined current. Absent that event evidence, a current version equal to the observed version SHALL not open. A strictly different current version SHALL advance the observed version, durably mark the current version pending unless its shown-version history already contains current, and then open or focus the internal Changelog page. Version ordering SHALL not matter, and acknowledged history SHALL survive later upgrade/downgrade cycles.

Install, browser-update, shared-module, same-version reload, content reinjection, and ordinary background-restart signals SHALL not independently force an open. `previousVersion` SHALL be trusted only on the eager update event and SHALL not replace durable observed state afterward. A stale pending version SHALL be superseded by the installed current version.

Reconciliation SHALL focus an existing internal Changelog tab and its window rather than create another; otherwise it SHALL create one active tab. Concurrent lifecycle signals SHALL share one in-flight operation. A page that has rendered the installed version's current notes or explicit local fallback SHALL idempotently append that version to shown history and clear its matching pending value; no pre-render step may acknowledge it. An acknowledged version SHALL not auto-open again, even after other versions are installed. An unacknowledged pending version SHALL remain retryable, while at most one live Changelog tab exists.

Storage or tab failures SHALL produce only bounded privacy-safe console diagnostics. Tab work SHALL not begin before pending intent is durable. Storage failure SHALL fail closed without opening; tab failure SHALL retain pending intent; a stale acknowledgement SHALL not overwrite newer state. No Toast, `AppFeedback`, notification, badge, alert, or content/application state change is allowed.

#### Scenario: First install establishes a quiet baseline

- **GIVEN** no valid Changelog state exists
- **WHEN** WebChat first installs or its background first starts at the current version
- **THEN** it SHALL persist that version as observed and SHALL not create or focus a Changelog tab

#### Scenario: Different installed version opens once

- **GIVEN** a valid older observed version and no acknowledgement for the installed current version
- **WHEN** update or startup reconciliation runs
- **THEN** it SHALL persist the current pending version and open or focus exactly one active internal Changelog tab
- **AND** after that page acknowledges rendering, later same-version lifecycles SHALL not auto-open it again

#### Scenario: First feature-bearing update uses trusted previous version

- **GIVEN** no Changelog state exists because the previously installed build predates this feature
- **WHEN** `onInstalled` reports reason `update` with a valid prior version different from current
- **THEN** WebChat SHALL mark the current version pending and open or focus its Changelog rather than silently treating it as a first install

#### Scenario: Same-version reload does not open

- **GIVEN** the observed version equals the current manifest version
- **WHEN** the extension reloads, the background restarts, content reinjects, or a non-extension browser update event occurs
- **THEN** no Changelog tab SHALL be created or focused and existing shown state SHALL be preserved

#### Scenario: Interrupted opening retries without duplicate live tabs

- **GIVEN** the current version remains pending because creation, rendering, acknowledgement, or the background lifetime was interrupted
- **WHEN** reconciliation runs again
- **THEN** it SHALL focus an existing Changelog tab or create one only when none exists
- **AND** concurrent attempts SHALL never leave two live Changelog tabs

#### Scenario: Newer installed version supersedes stale pending work

- **GIVEN** state contains a pending version different from the current installed version
- **WHEN** reconciliation runs
- **THEN** it SHALL replace the stale intent with the current version and SHALL never show release content from the stale package

#### Scenario: Previously acknowledged version remains suppressed after downgrade

- **GIVEN** version `X` exists in shown history and a later version was subsequently installed
- **WHEN** the extension returns to version `X`
- **THEN** WebChat SHALL update observed state without automatically opening `X` again

#### Scenario: Failure remains isolated and retryable

- **WHEN** state persistence or a tab operation fails
- **THEN** WebChat SHALL emit at most a bounded privacy-safe console diagnostic, SHALL show no user-facing application feedback, and SHALL touch no user/message/Runtime state
- **AND** it SHALL not create a tab without durable pending intent or falsely acknowledge a failed attempt

### Requirement: The Changelog page renders the current packaged release record offline

The Changelog page SHALL bundle repository `CHANGELOG.md` and extract the controlled top semantic-release section through the next release heading. It SHALL accept major and non-major heading levels, identify the version and ISO release date, and compare that version with the installed manifest/package version. A dependency-free build/source test SHALL require the checked-in package version to equal the top changelog version; semantic-release remains the only release-note generator.

The page SHALL initiate no network request during loading or rendering. Raw HTML SHALL remain disabled, Markdown images or other remote-loading elements SHALL not render, and links SHALL perform no work until user activation. If current-section parsing fails or versions disagree at runtime, the page SHALL show a nonblank local fallback for the installed version and the same outbound destinations rather than render stale notes or fetch replacements; that rendered fallback SHALL acknowledge the installed version.

The header SHALL show the exact sentence-case eyebrow `New version`, while the primary heading SHALL identify `WebChat v<installed version>`. The eyebrow SHALL remain the same static release-record label when the page opens automatically, manually, or in fallback; it SHALL NOT determine or expose transition, pending, or acknowledgement state. The page SHALL show the release date when available, the current update notes with semantic headings/lists/inline code/links, and explicit links derived from package metadata: repository `homepage`, exact `<homepage>/releases/tag/v<installed version>` Release, and `<bugs.url>/new` issue feedback. External destinations SHALL open only after activation, in a separate tab with no opener relationship. The existing Options version control SHALL open the internal page, and a manually opened rendered page SHALL acknowledge the installed version.

The surface SHALL use the local WebChat logo and the existing shadcn `Badge` and `Button` primitives without modifying or copying those primitives. Its one unframed `max-w-3xl` reading column SHALL contain a compact release-stamp header, the natural-height current-note body beginning within 32 CSS pixels of the header divider, and a final responsive action group. The visible version SHALL use a secondary Badge adjacent to the product heading, the optional date SHALL use an outline Badge, and their combined semantic heading name SHALL identify `WebChat v<installed version>`. A missing date SHALL reserve no empty space.

Repository, exact Release, and issue feedback SHALL each use an existing outline Button with `asChild`, Lucide icon, visible text, and an at-least-40-pixel stable hit area. The action group SHALL form three equal columns on desktop and one column on narrow viewports. The release notes SHALL use natural document scrolling; the whole page SHALL NOT be wrapped or height-limited by `ScrollArea`. Tables and code MAY contain only their own horizontal overflow.

The surface SHALL support system light/dark preference and reduced motion, remain readable at narrow and desktop widths, and provide semantic landmarks, ordered headings, descriptive action names, and visible keyboard focus. It SHALL use existing shadcn semantic canvas/control tokens, retain restrained emerald release and sky inline-link accents, keep brand/body in the existing sans role, reserve monospace for version/date/commit metadata, and use zero custom letter spacing. It SHALL contain no release spine or timeline dot, forced viewport-filling section height, page-level or nested card, oversized marketing hero, gradient/orb decoration, remote media, update-success Toast, permission request, unrelated setting, or overlapping/truncated text or controls. The current and fallback states SHALL share this same shell and action hierarchy.

#### Scenario: Current release notes render without network

- **GIVEN** the packaged changelog top entry matches the installed version
- **WHEN** the internal page loads with network unavailable
- **THEN** it SHALL render the WebChat version, release date, and only the current release section from bundled content without a remote request

#### Scenario: Major and non-major generated headings parse consistently

- **WHEN** the top semantic-release entry uses either `# [version]` or `## [version]`
- **THEN** the extractor SHALL return the same version/date/body structure and SHALL stop before the next release heading

#### Scenario: Missing or mismatched local notes never show stale content

- **GIVEN** the bundled top entry is malformed or names a different version
- **WHEN** the page renders
- **THEN** it SHALL show a nonblank local fallback naming the installed version and its repository/Release/issue links
- **AND** it SHALL not render older notes or fetch replacement content

#### Scenario: GitHub destinations are exact and user-initiated

- **WHEN** the page renders for version `X`
- **THEN** it SHALL expose package `homepage`, exact `<homepage>/releases/tag/vX`, and `<bugs.url>/new` with descriptive accessible names
- **AND** no destination SHALL open before the user activates it

#### Scenario: Options provides permanent manual access

- **WHEN** the user activates the existing version control in Options
- **THEN** it SHALL open the internal Changelog page rather than the generic external Releases index
- **AND** a successfully rendered manual visit SHALL acknowledge the installed version without causing another automatic tab

#### Scenario: Rejected timeline is replaced by one compact shadcn release record

- **WHEN** the current release is rendered at the Owner screenshot viewport of 915 by 694 CSS pixels
- **THEN** the exact `New version` eyebrow, logo, product heading, version/date Badges, and first note heading SHALL form one compact top sequence with at most 32 CSS pixels between the header divider and note content
- **AND** no vertical release spine, timeline dot, forced empty band, page-level card, or bare-link footer SHALL remain
- **AND** Repository, exact Release, and issue feedback SHALL appear as three equal shadcn outline Buttons with icons and visible labels

#### Scenario: Compact release record remains usable across narrow and theme states

- **WHEN** the page is rendered at 360 CSS pixels wide and at desktop width in light, dark, keyboard-focus, and reduced-motion states
- **THEN** the exact `New version` eyebrow, logo, semantic `WebChat v<installed version>` heading, version/date Badges, current notes, and three outbound Buttons SHALL remain legible, ordered, nonoverlapping, and fully operable
- **AND** metadata SHALL wrap without truncation, actions SHALL stack to one column when needed, the document SHALL use one natural page scroll surface, and no dynamic content SHALL resize or occlude adjacent controls

#### Scenario: Fallback keeps the same release hierarchy

- **GIVEN** the current release notes are unavailable or mismatched
- **WHEN** the local fallback renders
- **THEN** it SHALL reuse the same compact release-stamp header and three-Button action group without adding an error card, nested scroller, or reserved blank region

### Requirement: Package version behavior is separate from persistence versions

Changelog detection SHALL compare only installed extension package versions. It SHALL not read or write `MESSAGE_STORE_VERSION`, `CONFIG_STORE_VERSION`, their markers, message records, AppStatus, or UserInfo. Its `browser.storage.local` operational record SHALL not be deleted by either persistence reset family.

#### Scenario: Package update does not imply persistence reset

- **GIVEN** the package version changes while both persistence versions remain unchanged
- **WHEN** Changelog reconciliation runs
- **THEN** it MAY open the Changelog page but SHALL preserve all message and configuration data

#### Scenario: Persistence reset does not repeat Changelog acknowledgement

- **GIVEN** the current package version is already acknowledged
- **WHEN** a message or configuration store version mismatch is reset
- **THEN** Changelog shown state SHALL remain intact and the page SHALL not auto-open again solely because of that reset
