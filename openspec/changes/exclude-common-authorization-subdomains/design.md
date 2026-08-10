## Context

The content entry already has one static `excludeMatches` owner beside its broad HTTPS match. The requested behavior is a fixed targeting change: ten dedicated authorization subdomains are excluded across all paths, while every existing rule and every other host remains unchanged.

## Goals / Non-Goals

**Goals:**

- Add the exact confirmed host-wide exclusions to the existing declaration.
- Preserve one static owner for content-script targeting.
- Prove the same targeting reaches the generated Chrome and Firefox manifests.

**Non-Goals:**

- No parent-domain, generic `www`, provider-wide wildcard, or enterprise tenant exclusion.
- No path-specific, query-specific, redirect-aware, or runtime URL filtering.
- No user setting, remote list, new abstraction, permission, dependency, or UI.

## Decisions

### Use ten exact HTTPS match patterns

Add these literal patterns to the existing `excludeMatches` array:

- Account authorization: `https://accounts.google.com/*`, `https://login.microsoftonline.com/*`, `https://login.live.com/*`, `https://appleid.apple.com/*`.
- Payment authorization: `https://openauth.alipay.com/*`, `https://auth.alipay.com/*`, `https://wx.tenpay.com/*`, `https://pay.weixin.qq.com/*`, `https://checkout.stripe.com/*`, `https://pay.google.com/*`.

Each fixed hostname matches all of its paths and no sibling, child, or parent hostname. The `https` scheme matches the current content-script inclusion boundary.

Alternative considered: path-level rules. Rejected because the confirmed contract selects dedicated subdomains as the complete exclusion unit.

Alternative considered: provider wildcards such as `*.google.com` or `*.stripe.com`. Rejected because they would exclude unrelated product surfaces and violate the exact-host boundary.

### Keep the existing declaration as the sole owner

Extend the current `excludeMatches` array directly. Do not add a runtime URL guard, shared registry, generated config layer, or provider model. A second owner would add drift and control flow to a fixed manifest decision.

### Verify exact hosts and near misses

Focused coverage must prove that every path on each selected host is excluded, while representative apex, generic `www`, sibling, child, and removed-provider hosts remain eligible unless an existing exclusion already applies. Chrome and Firefox build outputs must carry the same ten additions and preserve the existing exclusions.

## Risks / Trade-offs

- **A wildcard could exclude unrelated pages** -> Use only fixed host literals and assert representative near misses.
- **An existing exclusion could be lost during the edit** -> Assert the prior localhost, loopback, and CSDN entries remain present.
- **Browser targets could diverge** -> Inspect both generated manifests from the same source declaration.
