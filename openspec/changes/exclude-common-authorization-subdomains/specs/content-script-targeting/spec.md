## ADDED Requirements

### Requirement: The content script uses one exact exclusion set

The WebChat content script SHALL keep its HTTPS inclusion rule and SHALL exclude exactly these three host-wide patterns:

- `*://localhost/*`
- `*://127.0.0.1/*`
- `*://accounts.google.com/*`

Each hostname SHALL be excluded across all paths. The exclusion SHALL use the exact hostname: it SHALL NOT include a parent domain, child or sibling subdomain, generic `www` subdomain, provider-wide wildcard, CSDN host, other account provider, payment provider, or any host not listed above. The system SHALL NOT add path, query, redirect, or runtime URL filtering for this behavior.

#### Scenario: Every path on a selected account host is excluded

- **GIVEN** a page whose hostname is exactly `accounts.google.com`
- **WHEN** the browser evaluates content-script eligibility for any path on that host
- **THEN** WebChat SHALL be excluded from the page

#### Scenario: Local development hosts are excluded

- **GIVEN** a page whose hostname is exactly `localhost` or `127.0.0.1`
- **WHEN** the browser evaluates content-script eligibility for any path on that host
- **THEN** WebChat SHALL be excluded from the page

#### Scenario: Related but unselected hosts remain eligible

- **GIVEN** an otherwise eligible HTTPS page on an apex, generic `www`, sibling, or child hostname such as `google.com`, `www.google.com`, `mail.google.com`, or `child.accounts.google.com`
- **WHEN** no existing exclusion applies
- **THEN** the new authorization-host rule SHALL NOT exclude WebChat from the page

#### Scenario: Other providers remain outside the exclusion list

- **GIVEN** an otherwise eligible HTTPS page on a CSDN, account-provider, or payment-provider host other than `accounts.google.com`
- **WHEN** no existing exclusion applies
- **THEN** the exact exclusion set SHALL NOT exclude WebChat from the page
