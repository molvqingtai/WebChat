## ADDED Requirements

### Requirement: Common dedicated authorization hosts do not receive WebChat

The WebChat content script SHALL preserve its current HTTPS inclusion rule and existing exclusions, and SHALL additionally exclude every URL on exactly these ten hostnames:

- `accounts.google.com`
- `login.microsoftonline.com`
- `login.live.com`
- `appleid.apple.com`
- `openauth.alipay.com`
- `auth.alipay.com`
- `wx.tenpay.com`
- `pay.weixin.qq.com`
- `checkout.stripe.com`
- `pay.google.com`

Each hostname SHALL be excluded across all paths. The exclusion SHALL use the exact hostname: it SHALL NOT include its parent domain, child or sibling subdomains, generic `www` subdomains, provider-wide wildcards, enterprise IdP tenant domains, or any host not listed above. The system SHALL NOT add path, query, redirect, or runtime URL filtering for this behavior.

#### Scenario: Every path on a selected account host is excluded

- **GIVEN** an HTTPS page whose hostname is exactly `accounts.google.com`
- **WHEN** the browser evaluates content-script eligibility for any path on that host
- **THEN** WebChat SHALL be excluded from the page

#### Scenario: Every path on a selected payment host is excluded

- **GIVEN** an HTTPS page whose hostname is exactly `checkout.stripe.com`
- **WHEN** the browser evaluates content-script eligibility for any path on that host
- **THEN** WebChat SHALL be excluded from the page

#### Scenario: Related but unselected hosts remain eligible

- **GIVEN** an otherwise eligible HTTPS page on an apex, generic `www`, sibling, or child hostname such as `google.com`, `www.google.com`, `mail.google.com`, or `child.accounts.google.com`
- **WHEN** no existing exclusion applies
- **THEN** the new authorization-host rule SHALL NOT exclude WebChat from the page

#### Scenario: Removed providers remain outside the exclusion list

- **GIVEN** an otherwise eligible HTTPS page on a provider host omitted from the final common-host list
- **WHEN** no existing exclusion applies
- **THEN** the new authorization-host rule SHALL NOT exclude WebChat from the page

#### Scenario: Existing exclusions remain effective

- **GIVEN** a URL covered by an existing localhost, loopback, or CSDN exclusion
- **WHEN** the ten authorization hosts are added
- **THEN** that existing exclusion SHALL remain unchanged and effective
