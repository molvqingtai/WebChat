## ADDED Requirements

### Requirement: Playwright Test is the canonical cross-browser E2E orchestrator

The repository SHALL use `@playwright/test` as the sole canonical E2E runner, fixture lifecycle authority, and reporter. Its configuration SHALL define exactly two mandatory platform project identities, `chrome-mv3` and `firefox-mv2`. One canonical full command SHALL prepare the exact production artifacts and produce terminal, non-skipped results for both projects in one Playwright Test run and report. A project-filtered invocation MAY be used for diagnosis but SHALL NOT certify the cross-browser gate.

The Firefox project SHALL execute Selenium/geckodriver operations within Playwright Test fixtures and tests. It SHALL NOT use a Playwright Firefox browser launch, Chrome MV2, a test-only compatibility manifest, or a manual browser session as Firefox extension evidence. The previous top-level `node e2e/chrome-runtime.ts` orchestration SHALL NOT remain a second canonical runner after migration.

#### Scenario: Run the canonical full gate

- **GIVEN** both production artifacts and required browser dependencies are available for one clean exact
- **WHEN** the canonical E2E command completes
- **THEN** one Playwright Test report SHALL contain terminal non-skipped results for `chrome-mv3` and `firefox-mv2`, and the gate SHALL fail if either project is missing, unstarted, interrupted, skipped, timed out, or failed

#### Scenario: Run one project for diagnosis

- **WHEN** a developer filters the run to only `chrome-mv3` or only `firefox-mv2`
- **THEN** the result SHALL identify itself as project-local diagnostic evidence and SHALL NOT be represented as a full cross-browser PASS

#### Scenario: Reject a Firefox substitute

- **WHEN** Firefox MV2 cannot install, start, or complete its fixture
- **THEN** the `firefox-mv2` project SHALL fail with its real cause and SHALL NOT fall back to Playwright Firefox, Chrome MV2, another Chromium build, or a skipped annotation

### Requirement: Chrome runs the production MV3 extension in a persistent Playwright context

The `chrome-mv3` project SHALL create a unique test-owned user-data directory and launch Playwright-provisioned Chromium through a worker-scoped `chromium.launchPersistentContext` fixture. It SHALL side-load only the exact `.output/chrome-mv3` production artifact selected for the run. The fixture SHALL structurally require manifest version 3 and a non-empty manifest name, derive content isolated-context identity from that artifact value, and use no host user profile, branded browser session, mock extension, or test-only manifest.

The migrated gate SHALL retain the current exact-artifact controls: content application mount without unavailable state, exactly one matching Service Worker, exactly one matching Offscreen Document, authenticated PresenceStore source behavior, accepted and rejected Offscreen Runtime relay behavior, privacy-bounded diagnostics, absence of unexpected extension errors, bounded CDP operations, and relevant Runtime bundle boundaries. A Playwright-owned CDP helper MAY inspect or control Offscreen state where no higher-level API exists, but it SHALL remain subordinate to the persistent-context fixture.

#### Scenario: Launch the production Chrome artifact

- **WHEN** the `chrome-mv3` fixture starts for a clean exact
- **THEN** it SHALL use a fresh persistent profile, load the exact manifest-v3 production directory, derive extension identity from that manifest, and observe one matching Service Worker and one Offscreen Document before reporting ready

#### Scenario: Preserve the Chrome Runtime source boundaries

- **WHEN** the migrated Chrome scenarios send accepted and rejected PresenceStore or Offscreen relay traffic
- **THEN** the same authenticated source, target, namespace, direction, diagnostic, durable-state, and unexpected-error assertions SHALL hold under Playwright Test without weakened counts, broad source admission, or a second browser runner

#### Scenario: Exercise Offscreen host recovery

- **GIVEN** a production MV3 page retains its active physical connection to the Service Worker coordinator
- **WHEN** the fixture directly destroys the test-owned Offscreen Document through a bounded Playwright/CDP control
- **THEN** the scenario SHALL observe one replacement Offscreen Runtime, restored readiness and page attachment, no duplicate host or lease, and no page-owned fallback

### Requirement: Firefox runs the production MV2 extension through Selenium and geckodriver

The `firefox-mv2` project SHALL create a unique test-owned Firefox profile, start an explicitly provisioned geckodriver service, launch real Firefox through Selenium WebDriver, and temporarily install the exact production package built from `.output/firefox-mv2`. It SHALL structurally require manifest version 2 and the persistent background-script declaration. Playwright Test SHALL orchestrate fixture lifetime and reporting only; Selenium/geckodriver SHALL own Firefox browser automation.

The fixture SHALL prove content injection on an accepted target, exactly one persistent Background Page, Runtime readiness, and absence of unexpected browser/extension errors. It SHALL support independent profiles for independent-user scenarios and a bounded test-owned process-restart control using the same profile. If process exit removes the temporary add-on, the fixture MAY reinstall only the same exact package as explicitly recorded setup; it SHALL prove profile and target continuity separately and SHALL NOT claim product auto-installation.

#### Scenario: Launch the production Firefox artifact

- **WHEN** the `firefox-mv2` fixture starts for a clean exact
- **THEN** it SHALL use Selenium plus geckodriver to launch a fresh Firefox profile, temporarily install the exact manifest-v2 production package, inject content on the accepted target, and observe exactly one persistent Background Page before reporting ready

#### Scenario: Use independent Firefox identities

- **WHEN** a scenario represents two independent browser users
- **THEN** it SHALL use two independently owned Firefox processes and profiles, while a same-profile second tab SHALL be used only for a scenario that explicitly requires one shared browser Runtime

#### Scenario: Exercise Firefox process restart recovery

- **GIVEN** the fixture has recorded the exact profile, production package, and target tab
- **WHEN** it terminates and restarts only its owned Firefox process
- **THEN** it SHALL restore the target, observe one persistent Background Page, Runtime rejoin, page readiness, and state re-projection; any same-package reinstall SHALL be labeled harness setup and profile/tab continuity SHALL be proved separately

### Requirement: E2E resources are isolated and leave zero residual state

Every browser context, WebDriver, geckodriver service, browser process, process group, CDP session, listener, temporary extension package, profile, and allocated port SHALL be registered to the exact fixture that owns it. Teardown SHALL run after success, assertion failure, setup rejection, timeout, signal, and browser-root early exit. It SHALL first close the high-level context or driver, then boundedly terminate only recorded owned resources, verify no matching owned child or port remains, and remove only the exact temporary paths.

The harness SHALL NOT use a host user profile, global `pkill`/`killall`, broad process-name termination, an unresolved broad path, or an unrelated browser. Behavioral success with a residual owned process, driver, listener, port, profile, or package SHALL be a failed test.

#### Scenario: Test passes and cleans up

- **WHEN** either platform scenario completes its behavioral assertions
- **THEN** fixture teardown SHALL close every owned handle, prove zero residual owned processes/ports/listeners, remove its temporary profile/package, and attach that cleanup result before the project may pass

#### Scenario: Browser root exits before a child

- **GIVEN** a test-owned browser root has exited while a child process still references the exact owned profile or process group
- **WHEN** fixture teardown runs
- **THEN** it SHALL terminate and verify only that owned child, remove the profile after settlement, and leave unrelated Owner browser processes untouched

#### Scenario: Cleanup cannot settle

- **WHEN** an owned resource remains after the bounded teardown and escalation policy
- **THEN** the project SHALL fail with the resource identity and cleanup phase attached even if every product assertion passed

### Requirement: Browser operations and suite lifetime are bounded

The Playwright configuration SHALL define finite full-run and per-test timeouts. Persistent-context launch, WebDriver/geckodriver startup, add-on installation, navigation, content readiness, polling, CDP requests, Runtime calls, screenshots/log capture, process restart, fixture teardown, process termination, and profile removal SHALL each have an explicit finite deadline within the enclosing test budget. No helper SHALL leave an unresolved promise, polling loop, driver command, CDP request, child process, or listener after the enclosing test terminates.

Canonical exact-bound acceptance SHALL use zero automatic retries. A later diagnostic rerun SHALL be a distinct run and SHALL NOT overwrite or reinterpret the first terminal result.

#### Scenario: A browser operation hangs

- **WHEN** a CDP request, WebDriver command, Runtime call, poll, or add-on operation does not settle within its configured bound
- **THEN** the test SHALL fail with project, fixture phase, operation, and timeout evidence, cancel or close the active helper where possible, and execute the same owned-resource teardown

#### Scenario: The suite budget expires

- **WHEN** a test or the full canonical invocation reaches its enclosing deadline
- **THEN** Playwright Test SHALL terminate that scope, retain the timeout as the terminal result, attach available diagnostics and cleanup evidence, and SHALL NOT silently retry or hang beyond cleanup

### Requirement: Reports bind browser results to one exact and its production artifacts

The canonical report SHALL record the Git commit SHA and tree, clean worktree status, production artifact locations and hashes, parsed manifest identities, browser and driver versions, operating system, project identity, fixture topology, test name, duration, terminal status, and cleanup outcome. Chrome SHALL attach relevant Playwright trace/screenshots and Runtime evidence; Firefox SHALL attach Selenium screenshots, browser/driver logs, Runtime evidence, and cleanup evidence through Playwright `testInfo`. Generated reports and result directories SHALL be ignored task-owned outputs rather than committed source.

A report SHALL distinguish PASS, assertion failure, environment/setup blocker, timeout, interruption, skipped/nonexecution, and cleanup failure. Evidence from a different source exact, artifact hash, browser project, or prior run SHALL NOT certify the current exact.

#### Scenario: Bind a successful full run

- **WHEN** both mandatory projects pass on one clean exact
- **THEN** the merged report SHALL contain matching source/tree and production-artifact identities plus platform-specific browser/driver/topology/assertion/cleanup attachments for both projects

#### Scenario: Artifact identity differs

- **WHEN** a selected manifest/package hash or source exact differs from the report authority
- **THEN** the run SHALL fail identity binding or remain diagnostic and SHALL NOT inherit a PASS from another artifact or exact

#### Scenario: A required project did not execute

- **WHEN** report aggregation finds a missing, skipped, interrupted, or unstarted `chrome-mv3` or `firefox-mv2` result
- **THEN** the full gate SHALL report that nonexecution explicitly and SHALL NOT summarize the run as cross-browser PASS

### Requirement: The runner migration is TypeScript-native and infrastructure-only

Committed E2E configuration, fixtures, specs, and helpers SHALL remain TypeScript under repository ownership and SHALL run without a generated JavaScript or out-of-repository runner source. The implementation candidate MAY change locked development dependencies, package scripts, Playwright configuration, `e2e/**/*.ts`, report ignore rules, and applicable CI workflow provisioning. It SHALL NOT change production application source, extension permissions, product WXT configuration, peer protocol, Runtime behavior, persistence, storage/database behavior, UI, release metadata, or user data.

#### Scenario: Review implementation scope

- **WHEN** the infrastructure candidate is compared with its docs authority
- **THEN** every changed path SHALL belong to test tooling, locked development dependencies, scripts, report ignores, or CI provisioning, and production behavior paths SHALL be byte-identical

#### Scenario: Inspect committed runner sources

- **WHEN** repository E2E sources are inventoried after migration
- **THEN** the canonical Playwright configuration, fixtures, specs, and helpers SHALL be committed TypeScript, with no generated `.js`/`.mjs` runner, external Firefox script, or second custom orchestration entrypoint

### Requirement: Accepted E2E infrastructure is the base for cumulative WebChat repair work

No paused WebChat product implementation SHALL resume until one clean tooling exact has received fresh Reviewer PASS and fresh QA PASS from the real `chrome-mv3` and `firefox-mv2` projects with zero residual resources. After acceptance, all already confirmed pending WebChat requirements and defects SHALL be integrated from that accepted tooling exact as one cumulative product batch. Planner MAY decompose mutually independent implementation boundaries in parallel, but they SHALL converge into one immutable cumulative source exact and one fresh cumulative Reviewer plus full cross-browser QA route.

Earlier feature candidates and their Review, QA, browser, CI, or cleanup evidence SHALL NOT transfer to the tooling exact or cumulative replacement. This sequencing SHALL NOT pause, gate, or otherwise govern Allin CMS. Publication, merge, and release remain separately authorized.

#### Scenario: Tooling has not passed both browsers

- **WHEN** the runner implementation lacks fresh Reviewer PASS or either real-browser QA project PASS
- **THEN** pending WebChat implementation SHALL remain paused and no old Chrome-only, Firefox-only, manual, or prior-exact evidence SHALL release it

#### Scenario: Resume pending WebChat work efficiently

- **GIVEN** the tooling exact has passed fresh Review and both real-browser QA projects
- **WHEN** Planner resumes the confirmed pending WebChat requirements and defects
- **THEN** independent implementation boundaries MAY proceed in parallel from that accepted base, but final acceptance SHALL use one cumulative immutable exact and one unified fresh Reviewer plus Chrome MV3/Firefox MV2 QA matrix

#### Scenario: Keep project boundaries independent

- **WHEN** this WebChat environment or pause state is reported
- **THEN** it SHALL NOT pause, sequence, or add acceptance requirements to Allin CMS work
