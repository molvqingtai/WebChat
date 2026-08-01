## ADDED Requirements

### Requirement: Unread attention is shared by domain and projected per tab

Each first-delivered remote text SHALL mark its WebChat domain as having unread attention exactly once, regardless of which same-domain tab wins atomic durable insertion and regardless of whether that winning tab is expanded. Self-authored text, history application, duplicate delivery, reactions, and system notices SHALL NOT mark unread attention. Browser-notification enabled and type settings SHALL NOT participate in unread eligibility.

Expanded or collapsed shell state SHALL belong to each physical tab independently. The same physical tab SHALL retain its own shell state across reload without adopting a same-domain sibling tab's shell state. A tab SHALL show the AppButton unread indicator if and only if its own panel is collapsed and its domain has unread attention. An already expanded tab SHALL show no indicator and SHALL NOT clear domain attention merely by remaining expanded, hydrating, becoming focused, or observing synchronization.

A user-driven transition from collapsed to expanded SHALL mark that WebChat domain read and clear its unread attention from every same-domain tab. Collapsing a tab SHALL NOT clear attention. Clearing one domain SHALL NOT affect another domain. A later first-delivered remote text SHALL mark its domain unread again. Delayed hydration and unrelated shell or position updates SHALL NOT overwrite a newer domain unread mark or clear.

The visible AppButton indicator SHALL be count-free and SHALL NOT resize the button. It SHALL occupy the top-right `size-5` container at `-top-1 -right-1`, with a full-size fully rounded orange-400 ping at 75% opacity and a fully rounded orange-500 `size-3` center. Its presence SHALL enter and exit through a 0.1-second opacity transition.

#### Scenario: Expanded insertion winner does not consume sibling attention

- **GIVEN** tab A is expanded, tabs B and C are collapsed on domain A, and tab D belongs to domain B
- **WHEN** a remote domain-A text is first-delivered and tab A wins atomic durable insertion
- **THEN** B and C SHALL each show the flashing AppButton indicator, A SHALL show none, D SHALL remain unchanged, and no tab's expanded/collapsed state SHALL change

#### Scenario: Any same-domain insertion winner produces the same projection

- **GIVEN** tab A is expanded and tabs B and C are collapsed on the same domain
- **WHEN** one eligible remote text is first-delivered and A, B, or C wins atomic durable insertion
- **THEN** the domain unread result SHALL be identical for every winner: only B and C SHALL show the indicator

#### Scenario: Expanding one collapsed tab reads the domain

- **GIVEN** tabs B and C show unread indicators for domain A while tab A is already expanded
- **WHEN** the user expands tab C
- **THEN** domain A SHALL be marked read, B and C SHALL both show no indicator, A SHALL remain expanded without an indicator, and every other domain SHALL remain unchanged

#### Scenario: Existing expanded tab is not a surrogate read action

- **GIVEN** tab A is already expanded while same-domain tabs B and C are collapsed
- **WHEN** an eligible remote text marks domain A unread and tab A remains expanded
- **THEN** A SHALL show no indicator, B and C SHALL keep their indicators, and focus, hydration, or synchronization in A SHALL NOT clear them

#### Scenario: Later remote text marks attention again after reading

- **GIVEN** a user expansion has cleared domain A unread attention
- **WHEN** a later remote domain-A text is first-delivered
- **THEN** every collapsed domain-A tab SHALL show one indicator again and expanded domain-A tabs SHALL show none

#### Scenario: Non-delivery paths do not mark unread

- **WHEN** a text is self-authored, applied from history, or a duplicate delivery, or the inbound value is a reaction or system notice
- **THEN** no domain unread attention SHALL be added and no AppButton indicator SHALL appear because of that value

#### Scenario: Notification settings do not gate unread attention

- **GIVEN** browser notifications are disabled or configured as `Only @self`
- **WHEN** a first-delivered remote text is otherwise ineligible for a browser notification
- **THEN** every collapsed tab of that text's domain SHALL still show the unread indicator and other domains SHALL remain unchanged

#### Scenario: Multiple texts retain one count-free indicator

- **GIVEN** a domain is already unread
- **WHEN** another eligible remote text is first-delivered before the domain is read
- **THEN** each collapsed same-domain AppButton SHALL retain one visually unchanged indicator with no number, label, duplicate marker, or layout shift

#### Scenario: Unrelated status updates cannot clobber domain attention

- **GIVEN** one same-domain tab has observed a newer unread mark or read clear
- **WHEN** another tab completes delayed hydration or writes its shell state or position
- **THEN** the newer domain unread result SHALL remain authoritative and no sibling tab's expanded/collapsed state SHALL change

#### Scenario: Indicator uses the fixed visual result

- **WHEN** a collapsed tab projects domain unread attention on its AppButton
- **THEN** it SHALL render the top-right orange ping and opaque center with the specified sizes, offsets, opacity, rounding, and 0.1-second presence transition, without text, count, or button resizing
