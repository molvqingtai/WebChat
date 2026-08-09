## 1. Product Contract

- [x] 1.1 Record the two exact waits and every unchanged recovery boundary in the delta spec and design.

## 2. Numeric Substitutions

- [x] 2.1 Set the existing close-driven Artico peer replacement wait literal to `5_000` without changing its surrounding logic or structure.
- [x] 2.2 Set the existing ClientLease default page-registration retry wait literal to `1_000` without changing its surrounding logic or structure.

## 3. Mechanical Test Synchronization

- [x] 3.1 Update only existing Artico timer expectations made stale by the `5_000` wait; add no test case or test abstraction.
- [x] 3.2 Update only existing ClientLease timer expectations made stale by the `1_000` wait; add no test case or test abstraction.

## 4. Verification And Delivery

- [x] 4.1 Run the affected existing timer suites and repository delivery checks on the implementation exact.
- [x] 4.2 Confirm review and CI pass on an exact whose source diff contains only the two numeric substitutions and mechanical expectation updates.
