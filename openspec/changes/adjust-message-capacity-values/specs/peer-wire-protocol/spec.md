## ADDED Requirements

### Requirement: Message and codec capacity values use the expanded fixed set

The current protocol SHALL use `MAX_CHAT_EVENT_BYTES = 192KiB` instead of `48KiB`, `MAX_WIRE_BYTES = 256KiB` instead of `64KiB`, and `MAX_DECODED_JSON_BYTES = 1MiB` instead of `256KiB`. Each value SHALL remain at its existing owner and enforcement points; no new validation boundary, helper, fallback, or resource guard SHALL be added.

The existing authored-message preflight and declarative Text body ceiling SHALL consume the changed `MAX_CHAT_EVENT_BYTES` value without moving or duplicating their checks. The final `Base64(deflate(UTF8(JSON)))` frame SHALL remain bounded by the changed `MAX_WIRE_BYTES`, and streaming decompression SHALL stop before materializing more than the changed `MAX_DECODED_JSON_BYTES`.

History Pull and Push pages SHALL continue to share `MAX_WIRE_BYTES` and therefore use the `256KiB` final-wire boundary. A Push SHALL continue to contain at most 100 messages. `MAX_USER_BYTES = 8KiB`, the 500-JavaScript-unit text input limit, the `30KiB` per-image compression target, and the `5KiB` avatar compression target SHALL remain unchanged.

#### Scenario: Public capacity constants expose the replacement values

- **WHEN** a current consumer reads the public protocol capacity constants
- **THEN** `MAX_CHAT_EVENT_BYTES` SHALL equal `192 * 1024`, `MAX_WIRE_BYTES` SHALL equal `256 * 1024`, and `MAX_DECODED_JSON_BYTES` SHALL equal `1024 * 1024`, while `MAX_USER_BYTES` remains `8 * 1024` and the History Push count remains 100

#### Scenario: Existing authored-message boundary uses 192KiB

- **WHEN** the existing authoring flow prepares a message and applies its existing UTF-8 JSON preflight
- **THEN** the size warning boundary SHALL use `192KiB`, preserve an over-limit draft exactly as today, and add no image-count rule, editor conversion, second validator, or fallback

#### Scenario: History pages follow the shared 256KiB wire value

- **WHEN** History constructs a Pull or a Push page
- **THEN** the page SHALL use the same `MAX_WIRE_BYTES = 256KiB` final-frame boundary as every other wire message, a Push SHALL still contain at most 100 messages, and no separate History wire limit or fragmentation path SHALL exist

#### Scenario: Decoded JSON stops at 1MiB

- **WHEN** one canonical encoded frame would decompress beyond `MAX_DECODED_JSON_BYTES = 1MiB`
- **THEN** the existing streaming codec SHALL cancel before JSON parse through its current representation boundary, without inspecting message properties or adding another validation stage

#### Scenario: Adjacent product values remain unchanged

- **WHEN** the values-only change is inspected
- **THEN** text input SHALL remain 500 JavaScript units, each image compression target SHALL remain `30KiB`, avatar compression target SHALL remain `5KiB`, and one `ChatUser` SHALL remain bounded by `8KiB`
