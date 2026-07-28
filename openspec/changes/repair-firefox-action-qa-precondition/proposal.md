## Why

Fresh QA on product exact `f9efac92af9e0c7147f75dd36ec0f1dd67e8183f` proved the repaired Firefox MV2 action itself works: Firefox exposed the exact add-on `molvqingtai@gmail.com`, one persistent Background Page was running, one native toolbar click opened one options page, and the options count changed from zero to one. The run still terminated BLOCKED because Firefox reused its sole browser tab for the options page. The harness then had no independent non-options content tab on which to run the required Runtime control.

This is a harness-precondition defect, not product-defect evidence. The current action-registration authority deliberately protects all E2E tooling, and the repository has no committed Firefox action harness: `e2e/**` contains only the existing Chrome harness/runtime files and the cross-browser bundle check. A narrow superseding authority is therefore required before any repository-owned Firefox action verification support can change.

The repair must happen before native activation. A later content tab created after the click would conceal the same invalid topology instead of proving that action activation and content Runtime traffic coexisted in one Firefox process generation.

## What Changes

- Add one dependency-free, adapter-driven Firefox action precondition helper at `e2e/firefox-action-precondition.ts` and focused deterministic coverage at `e2e/firefox-action-precondition.test.ts`.
- Before the real Firefox toolbar action, bind one accepted HTTPS content tab and keep it distinct from the browser tab that may become the extension options page. Create or restore only the missing test-owned browser tab needed to establish that topology.
- Fail before native activation if the generation cannot guarantee a surviving independent content handle. Add an explicit sole-tab -> options -> no-content fail-before control.
- Re-establish and rebind the precondition independently for initial startup and two same-profile owned-process restart generations; never reuse a stale WebDriver handle across process generations.
- Bind each generation's content handle, profile identity, generation identity, exact XPI/add-on identity, one persistent Background Page, one native toolbar click, options-count delta, and pre/post-action content Runtime evidence.
- Preserve real action semantics: no direct extension-event dispatch, no call to the product action command, no manual options navigation represented as the action result, and no options-page Runtime traffic represented as the content control.
- Keep every product file, existing E2E file, runner/reporter/aggregation/CI surface, package script, dependency, lockfile, WXT/manifest/permission surface, and prior QA/tooling script protected.

## Capabilities

### New Capabilities

- `firefox-action-qa-precondition`: A deterministic, generation-scoped Firefox action verification precondition that preserves an independent content Runtime control across a real native options-page action.

### Modified Capabilities

None. Product action registration and the broader cross-browser E2E runner remain unchanged.

## Impact

- Exactly two new repository-owned files: `e2e/firefox-action-precondition.ts` and `e2e/firefox-action-precondition.test.ts`.
- The implementation child may update only this change's `tasks.md` in addition to those two new files.
- Fresh exact-bound Reviewer and full same-seat Chrome MV3 plus Firefox MV2 QA are required after implementation.
- No product, configuration, dependency, script, existing E2E tooling, CI, report, release, or Owner-checkout change.

## Non-Goals

- No change to `registerActionClick`, action API selection, `AppAction.openOptionsPage()`, options behavior, or any application source.
- No implementation of the paused canonical Playwright/Selenium runner migration and no reuse, copy, rebase, or inspection of task #268 tooling or QA temporary scripts.
- No Selenium/geckodriver dependency, package script, Playwright configuration, reporter, aggregation, CI, or cleanup-framework change.
- No product navigation, reload, retry, popup, tab-management, Runtime, coordinator, Offscreen, protocol, storage, database, or UI behavior change.
- No fabricated click, direct `browserAction.onClicked` dispatch, direct AppAction invocation, or manual navigation to `options.html` counted as the native action result.
- No canonical rerun on `f9efac9` and no transfer of its static, Chrome, Firefox, action, Runtime, Review, QA, or cleanup verdicts.

## Acceptance Criteria

- The implementation is a clean sole child of this docs exact and changes only `e2e/firefox-action-precondition.ts`, `e2e/firefox-action-precondition.test.ts`, and this change's task checkboxes.
- The helper has no new dependency and operates only through an injected, test-owned browser adapter. It does not launch a second runner or own native action activation.
- A deterministic fail-before proves that allowing a sole ordinary tab to become the options page leaves no valid content control, and the repaired precondition either establishes a distinct accepted content handle before activation or stops without clicking.
- Initial Firefox startup and two same-profile owned-process restarts each create a fresh generation binding. In every generation, one real native toolbar click for the exact add-on produces exactly one options-page delta while the bound non-options content tab remains usable for pre/post-action Runtime control and one persistent Background Page remains running.
- The options page never substitutes for an accepted content tab, and post-click tab creation cannot retroactively satisfy the precondition.
- One fresh Reviewer validates the narrow implementation, deterministic controls, exact path scope, and protected surfaces. One fresh QA seat starts from zero and reruns the entire real Chrome MV3 plus Firefox MV2 matrix, including all three Firefox generations and zero-residual cleanup.
- Exact `f9efac9`, QA task #272, task #268, `6f81011b...`, `0756b50...`, and every earlier candidate or evidence set remain diagnostic history only.
