## Context

The content entry has one static `excludeMatches` owner beside its broad HTTPS match. The final targeting set contains only local development endpoints and Google Accounts; every other HTTPS host remains eligible.

## Goals / Non-Goals

**Goals:**

- Keep exactly the three confirmed host-wide exclusions in the existing declaration.
- Preserve one static owner for content-script targeting.
- Prove the same targeting reaches the generated Chrome and Firefox manifests.

**Non-Goals:**

- No CSDN, payment-provider, other account-provider, parent-domain, generic `www`, sibling, child-subdomain, or provider-wide exclusion.
- No path-specific, query-specific, redirect-aware, or runtime URL filtering.
- No user setting, remote list, new abstraction, permission, dependency, or UI.

## Decisions

### Use three exact host-wide match patterns

The `excludeMatches` array contains exactly these literal patterns:

- `*://localhost/*`
- `*://127.0.0.1/*`
- `*://accounts.google.com/*`

Each fixed hostname matches all of its paths and no sibling, child, or parent hostname. The source uses a scheme wildcard for the exclusions, while the unchanged `matches: ['https://*/*']` rule means WebChat is injected only into otherwise eligible HTTPS pages.

Alternative considered: path-level rules. Rejected because the confirmed contract selects dedicated subdomains as the complete exclusion unit.

Alternative considered: provider wildcards such as `*.google.com`. Rejected because they would exclude unrelated product surfaces and violate the exact-host boundary.

### Keep the existing declaration as the sole owner

Maintain the `excludeMatches` array directly. Do not add a runtime URL guard, shared registry, generated config layer, or provider model. A second owner would add drift and control flow to a fixed manifest decision.

### Verify the generated browser declarations

Chrome and Firefox build outputs must carry the same three exclusions. This requirement adds no dedicated automated test suite.

## Risks / Trade-offs

- **A wildcard could exclude unrelated pages** -> Use only the three reviewed fixed host literals.
- **An obsolete provider exclusion could remain** -> Inspect the declaration and generated manifests for the exact three-entry set.
- **Browser targets could diverge** -> Inspect both generated manifests from the same source declaration.
