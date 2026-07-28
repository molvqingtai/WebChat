## ADDED Requirements

### Requirement: Firefox action verification preserves an independent content control

Before a Firefox MV2 native toolbar action is activated, the verification harness SHALL bind one ordinary browser handle to a manifest-accepted HTTPS content target and SHALL keep that handle distinct from the ordinary browser handle that may be reused or replaced by the options page. The bound content handle SHALL be usable for content Runtime readiness and traffic and SHALL NOT be an extension-origin options page.

When the current process generation lacks the required topology, the precondition support MAY create or restore only the missing test-owned ordinary tab. It SHALL make the non-content action-recipient handle active before returning action authorization and SHALL return enough binding information to verify that the same content handle remains independent after activation.

#### Scenario: Prepare a browser that starts with one tab

- **GIVEN** a test-owned Firefox generation starts with one ordinary tab that may become the options page
- **WHEN** the action precondition runs
- **THEN** it SHALL establish a separate accepted HTTPS content handle plus a distinct action-recipient handle before authorizing the toolbar click

#### Scenario: Preserve an existing valid content handle

- **GIVEN** the generation already has a Runtime-ready accepted content handle and a distinct ordinary action-recipient handle
- **WHEN** the action precondition runs
- **THEN** it SHALL bind those roles without duplicating the content control, SHALL keep the content handle out of the active recipient role, and SHALL classify every options URL outside the content role

#### Scenario: Options opens after a valid precondition

- **GIVEN** the precondition returned a valid generation binding
- **WHEN** one real native action opens the options page
- **THEN** the bound content handle SHALL remain independently addressable at the accepted non-options target and SHALL complete the required post-action content Runtime control

### Requirement: Unsafe topology fails before native activation

The precondition SHALL withhold action authorization unless it has established and verified the independent content and action-recipient roles. It SHALL fail before the native toolbar click when a sole-tab options transition would leave no accepted content handle, when an accepted target cannot be restored, when content Runtime readiness is absent, or when the returned binding is stale or inconsistent.

A content tab created after native activation SHALL NOT retroactively satisfy the precondition or convert the generation into PASS.

#### Scenario: Sole tab would be consumed by options

- **GIVEN** the deterministic adapter models one sole ordinary tab becoming the options page and no independent content handle surviving
- **WHEN** the harness requests action authorization without successfully establishing a second role
- **THEN** the precondition SHALL fail before any native-click callback runs and SHALL report the missing independent content control

#### Scenario: Post-action repair is attempted

- **GIVEN** a toolbar action already consumed the only ordinary content handle
- **WHEN** the harness creates or navigates another tab after the click
- **THEN** that tab SHALL NOT satisfy the failed generation's precondition or erase its terminal failure

#### Scenario: Options page is offered as the control

- **GIVEN** an extension-origin options handle can send Runtime traffic
- **WHEN** the harness classifies candidate content controls
- **THEN** it SHALL reject that handle because options traffic cannot prove accepted-page content injection or content-to-Runtime routing

### Requirement: Firefox precondition bindings are exact and generation-scoped

Each precondition binding SHALL identify the owned profile, current process generation, exact production package, exact add-on ID, accepted content target, content handle, action-recipient handle, and pre-action tab classification. The caller SHALL reject the binding if any identity differs from the active verification generation.

Initial startup and each owned-process restart SHALL establish a new binding from the current browser handles. The same recorded profile and exact package SHALL be retained across the initial generation plus two restarts, but a prior process's WebDriver handle SHALL NOT be reused or accepted.

#### Scenario: Restart with the same profile

- **GIVEN** one Firefox generation completed and its owned process exited
- **WHEN** the same profile and exact package start the next generation
- **THEN** the precondition SHALL inventory the new process's handles, restore the accepted target as needed, and return a new generation binding without accepting any prior handle

#### Scenario: Identity changes during preparation

- **GIVEN** a candidate binding refers to a different profile, generation, package, add-on ID, or accepted target
- **WHEN** action authorization is requested
- **THEN** the precondition SHALL reject it before the toolbar click rather than borrowing evidence from the mismatched identity

#### Scenario: Complete all required Firefox generations

- **WHEN** fresh QA runs initial startup and two same-profile owned-process restarts
- **THEN** all three generations SHALL independently satisfy the precondition and the real action/Runtime controls; a PASS from one generation SHALL NOT fill a missing or failed generation

### Requirement: Native action and content Runtime evidence remain separate

In each required Firefox generation, exact-bound QA SHALL record one running persistent Background Page, pre-action Runtime readiness on the bound accepted content handle, one real WebDriver activation of exact add-on `molvqingtai@gmail.com` through its Firefox chrome toolbar control, an options-page count delta where `afterOptionsCount - beforeOptionsCount = 1`, the same surviving non-options content handle, and post-action content Runtime traffic. All facts SHALL bind to the same profile, process generation, package, and add-on ID.

The harness SHALL NOT directly dispatch a WebExtension action event, call the product action command, navigate to the options URL to manufacture the result, or count options-origin Runtime traffic as the content control.

#### Scenario: Prove one real Firefox action generation

- **GIVEN** a valid pre-action binding and one running persistent Background Page
- **WHEN** WebDriver clicks exact add-on `molvqingtai@gmail.com` through its native Firefox toolbar action once
- **THEN** `afterOptionsCount - beforeOptionsCount` SHALL equal one, the same accepted content handle SHALL remain non-options, and that handle SHALL complete the post-action Runtime control

#### Scenario: An action result is fabricated

- **WHEN** a harness directly emits the action event, invokes `AppAction.openOptionsPage()`, or manually navigates to the options page
- **THEN** the result SHALL fail native-action acceptance even if an options page appears or Runtime traffic succeeds

### Requirement: The repair remains a narrow repository-owned support boundary

The implementation SHALL add only `e2e/firefox-action-precondition.ts` and `e2e/firefox-action-precondition.test.ts`, plus checkbox-only progress updates in this change's `tasks.md`. The helper SHALL be dependency-free and driven through an injected test-owned adapter. It SHALL NOT become a browser runner, native-action driver, reporter, aggregator, cleanup framework, CI path, or product abstraction.

All existing E2E files, product source, WXT configuration, manifests/permissions, dependencies/lockfile, package scripts, Runtime/coordinator/Offscreen/protocol/storage/UI, workflows, release metadata, and Owner checkout SHALL remain unchanged.

#### Scenario: Review direct implementation scope

- **WHEN** the implementation exact is compared with this docs authority
- **THEN** its direct changes SHALL be limited to the two new precondition files and checkbox-only task progress, with every protected path byte-identical

#### Scenario: The helper requires broader tooling

- **WHEN** implementation would require a dependency, package script, existing E2E edit, runner/reporter/CI change, generated source, or product change
- **THEN** work SHALL stop as authority-blocked rather than expanding this repair

### Requirement: Acceptance uses fresh exact-bound evidence

This docs authority SHALL be a clean sole child of `f9efac92af9e0c7147f75dd36ec0f1dd67e8183f`, and its implementation SHALL be a clean sole child of this docs exact. Only product bytes transfer from the parent; its prior static, browser, action, Runtime, Review, QA, and cleanup verdicts SHALL NOT transfer.

One fresh Reviewer SHALL validate the immutable implementation. One fresh QA seat SHALL rerun the entire real Chrome MV3 plus Firefox MV2 matrix from zero, own all three Firefox generations, preserve the first terminal result with zero automatic canonical retries, and prove zero residual owned resources on both platforms.

#### Scenario: Prior Firefox action evidence exists

- **GIVEN** QA task #272 proved a generation-one native Firefox action on `f9efac9`
- **WHEN** the new implementation exact enters acceptance
- **THEN** that result SHALL remain diagnostic only and the fresh QA seat SHALL rerun Chrome plus all required Firefox generations from zero

#### Scenario: One Firefox generation does not execute

- **WHEN** initial startup or either of the two restart generations is missing, interrupted, failed, or replaced by prior evidence
- **THEN** the exact SHALL NOT receive a Firefox or cross-browser PASS even if the executed generations and cleanup succeed
