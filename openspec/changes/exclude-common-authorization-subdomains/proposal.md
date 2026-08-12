## Why

WebChat injects its content application into HTTPS pages. Its targeting contract needs one exact exclusion set: local development endpoints and Google Accounts do not receive WebChat, while other HTTPS hosts remain eligible.

## What Changes

- Set the content-script `excludeMatches` list to exactly `*://localhost/*`, `*://127.0.0.1/*`, and `*://accounts.google.com/*`.
- Exclude every path on those exact hosts; add no path, query, redirect, or runtime URL logic.
- Keep the broad HTTPS inclusion rule unchanged.
- Do not exclude CSDN, another account or payment provider, an apex domain, a sibling/child subdomain, or a generic `www` host.

## Capabilities

### New Capabilities

- `content-script-targeting`: Define the exact hosts on which WebChat content injection is disabled.

### Modified Capabilities

None.

## Impact

- Affected implementation: the existing content-script `excludeMatches` declaration and the Runtime content-URL eligibility guard that must accept the same otherwise eligible HTTPS hosts.
- Affected verification: generated Chrome/Firefox manifest inspection and existing repository delivery checks.
- Unchanged: `excludeMatches` remains the sole targeting declaration; the broad HTTPS match, frame behavior, permissions, page UI, dependencies, and every nonselected host remain unchanged.
