## ADDED Requirements

### Requirement: WorldRoom v3 is a browser singleton inside the Runtime

The headless Runtime SHALL own exactly one physical WorldRoom v3 membership per browser host. All active and grace-period domains SHALL contribute to one full snapshot through `WorldDomain`; pages SHALL own no World peer. The v3 World payload SHALL remain exactly `{sessionId,user,sites}` with no `type`, `presenceId`, or `joinedAt`. Only the physical namespace generation changes so World discovery cannot advertise v1/v2 peers whose Chat protocol is incompatible with v3.

#### Scenario: Single membership per browser

- **WHEN** pages from one or more domains are active in one browser host
- **THEN** the Runtime SHALL join exactly one v3 WorldRoom, publish one full per-browser snapshot, and SHALL not join v1 or v2 World rooms

#### Scenario: Grace-aligned exit

- **WHEN** the final domain exits after its unified grace and required final Chat release settles
- **THEN** the Runtime SHALL publish or settle the empty v3 World state and leave the singleton according to the existing lifecycle ownership

#### Scenario: Namespace changes without payload drift

- **WHEN** a canonical World snapshot is published in v3
- **THEN** its strict payload, canonical JSON, and encoded bytes SHALL remain identical to v2, while v1/v2 clients remain physically isolated and absent from the v3 discovery projection

## REMOVED Requirements

### Requirement: WorldRoom v2 is a browser singleton inside the Runtime

**Reason**: Required v3 SESSION logical time makes Chat incompatible with v2; World moves to the same generation so discovery does not advertise incompatible Chat peers.

**Migration**: Current clients join only the v3 World namespace. The World payload is unchanged and no dual join, bridge, or fallback is retained.
