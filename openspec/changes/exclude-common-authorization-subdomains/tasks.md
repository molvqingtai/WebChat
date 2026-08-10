## 1. Product Contract

- [x] 1.1 Record the exact ten dedicated subdomains, host-wide behavior, and unchanged targeting boundaries in the delta spec and design.

## 2. Content-Script Targeting

- [ ] 2.1 Add the ten exact HTTPS host-wide patterns to the existing `excludeMatches` declaration while preserving every current entry and setting.
- [ ] 2.2 Keep targeting static and manifest-owned; add no wildcard provider rule, path/query logic, runtime guard, configuration surface, or second host list.

## 3. Regression Coverage

- [ ] 3.1 Add focused automated coverage for all ten selected hosts, arbitrary paths on a selected host, existing exclusions, and representative apex, generic `www`, sibling, child, and removed-provider near misses.
- [ ] 3.2 Build Chrome and Firefox and verify both emitted manifests contain the same ten additions without broadening any hostname.

## 4. Verification And Delivery

- [ ] 4.1 Run the focused coverage and repository delivery checks on the implementation exact.
- [ ] 4.2 Confirm fresh architecture-first review and CI pass on the same exact with no unrelated source, dependency, permission, runtime, or UI change.
