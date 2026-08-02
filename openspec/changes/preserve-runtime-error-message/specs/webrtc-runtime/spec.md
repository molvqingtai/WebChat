## ADDED Requirements

### Requirement: Runtime errors cross extension transport as message strings

When the shared Runtime host delivers an `Error` to a registered content page, `PagePort` SHALL project that Error to its exact `message` string before invoking the page callback. The internal Runtime server error callback SHALL transport that string and SHALL NOT transport an `Error` object, name, stack, cause, subclass, custom field, or host object identity.

The Runtime-backed content `ChatRoom` SHALL construct `new Error(message)` exactly once and publish that Error through the ChatRoom error event. ChatRoom consumers SHALL continue to receive an `Error` with the exact transported message. This boundary SHALL NOT change Runtime failure ownership, page targeting, listener-failure isolation, recovery behavior, Toast copy, Toast lifetime, or the public ChatRoom API.

#### Scenario: PagePort sends an exact transport-safe message

- **GIVEN** the Runtime host targets `new Error('Runtime transport disconnected')` to a registered page
- **WHEN** `PagePort` invokes that page's Runtime error callback
- **THEN** the callback SHALL receive the string `Runtime transport disconnected`, and JSON serialization SHALL preserve that exact value

#### Scenario: Content ChatRoom reconstructs the application Error

- **GIVEN** the content Runtime server callback delivers `Runtime transport disconnected`
- **WHEN** the current Runtime-backed `ChatRoom` handles that callback
- **THEN** its ChatRoom error listener SHALL receive one `Error` whose message is exactly `Runtime transport disconnected`

#### Scenario: Host Error metadata does not cross the boundary

- **GIVEN** a host Runtime Error has a name, stack, cause, subclass, or custom field in addition to its message
- **WHEN** the error is delivered to a content page
- **THEN** only the message string SHALL cross the extension transport, and content SHALL construct a plain Error from that string

#### Scenario: Final consumer observation uses the reconstructed Error

- **GIVEN** a higher-level application flow observes Runtime-backed ChatRoom errors
- **WHEN** a Runtime failure reaches that flow
- **THEN** the observer SHALL receive the Error created by the content ChatRoom and SHALL NOT reconstruct another transport Error in an intermediate consumer
