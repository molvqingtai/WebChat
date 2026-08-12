## 1. Product Contract

- [x] 1.1 Record the exact three host-wide patterns and unchanged HTTPS targeting boundary in the delta spec and design.

## 2. Content-Script Targeting

- [x] 2.1 Keep exactly localhost, loopback, and Google Accounts in the existing `excludeMatches` declaration.
- [x] 2.2 Keep targeting static and manifest-owned; add no wildcard provider rule, path/query logic, runtime guard, configuration surface, or second host list.

## 3. Browser Output Verification

- [x] 3.1 Build Chrome and Firefox and verify both emitted manifests contain the same exact three exclusions without broadening any hostname.

## 4. Verification And Delivery

- [x] 4.1 Run the existing repository delivery checks on the implementation exact.
- [x] 4.2 Confirm fresh architecture-first review and CI pass on the same exact with no unrelated source, dependency, permission, runtime, or UI change.
