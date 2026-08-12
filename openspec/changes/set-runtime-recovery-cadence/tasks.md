## 1. Product Contract

- [x] 1.1 Record the three exact waits and every unchanged recovery boundary in the delta spec and design.

## 2. Numeric Substitutions

- [ ] 2.1 Set the existing close-driven Artico peer replacement wait literal to `10_000` without changing its surrounding logic or structure.
- [x] 2.2 Set the existing ClientLease default page-registration retry wait literal to `1_000` without changing its surrounding logic or structure.
- [ ] 2.3 Set the existing Connection Domain/World automatic recovery retry literal to `10_000` without changing its surrounding logic or structure.

## 3. Mechanical Test Synchronization

- [ ] 3.1 Mechanically update only existing Artico timer values made stale by the `10_000` wait; add no pre-boundary or exactly-once assertion, test case, test abstraction, or setup restructuring.
- [x] 3.2 Update only existing ClientLease timer expectations made stale by the `1_000` wait; add no test case or test abstraction.
- [ ] 3.3 Mechanically update only existing failed initial/active Chat and World recovery timer values made stale by the `10_000` wait; add no pre-boundary or exactly-once assertion, test case, test abstraction, or setup restructuring.

## 4. Verification And Delivery

- [ ] 4.1 Run the affected existing timer suites and repository delivery checks on the implementation exact.
- [ ] 4.2 Confirm review and CI pass on an exact whose implementation diff contains only the Artico and Connection numeric substitutions plus their mechanical timer expectation updates.
