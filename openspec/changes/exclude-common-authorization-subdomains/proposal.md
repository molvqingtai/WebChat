## Why

WebChat currently injects its content application into nearly every HTTPS page. The most common dedicated account-authorization and payment-authorization subdomains do not need WebChat, so they should be excluded without broadening the exclusion to provider main sites, generic `www` hosts, or less common services.

## What Changes

- Add exactly ten common dedicated authorization subdomains to the existing content-script `excludeMatches` list.
- Exclude every path on each selected subdomain; add no path, query, redirect, or runtime URL logic.
- Keep the existing localhost, loopback, and CSDN exclusions unchanged.
- Do not add apex domains, generic `www` subdomains, wildcard provider domains, enterprise IdP tenant domains, or additional payment providers.

## Capabilities

### New Capabilities

- `content-script-targeting`: Define the exact dedicated authorization subdomains on which WebChat content injection is disabled.

### Modified Capabilities

None.

## Impact

- Affected implementation: the existing content-script `excludeMatches` declaration.
- Affected verification: generated Chrome/Firefox manifest inspection and existing repository delivery checks.
- Unchanged: the broad HTTPS match, existing exclusions, frame behavior, permissions, runtime behavior, page UI, dependencies, and every nonselected host.
