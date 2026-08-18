# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Overview

WebChat is a decentralized, serverless browser extension that enables anonymous P2P chat on any website using WebRTC. Built with WXT framework for cross-browser support (Chrome, Firefox, Edge).

## Key Technologies

- **WXT**: Browser extension framework (config: `wxt.config.ts`)
- **Remesh**: DDD framework for domain logic with true UI/logic separation (RxJS-based reactive state management)
- **Trystero**: WebRTC P2P communication library over public Nostr relays (used as the sole room transport)
- **React 19** with TypeScript
- **Tailwind CSS v4** with shadcn/ui components
- **Valibot**: Runtime schema validation

## Development Commands

```bash
# Development
npm run dev                  # Chrome dev mode with hot reload
npm run dev:firefox          # Firefox dev mode

# Type checking
npm run check                # Run TypeScript compiler without emitting files

# Linting
npm run format               # oxfmt write mode (formats source in place)
npm run format:check         # read-only format check
npm run lint                 # oxlint safe fixes
npm run lint:check           # read-only lint check

# Building
npm run build                # Production build for all browsers
npm run build:chrome         # Chrome production build only
npm run build:firefox        # Firefox production build only

# Packaging
npm run pack                 # Create zip files for all browsers
npm run pack:chrome          # Create Chrome zip only
npm run pack:firefox         # Create Firefox zip only

# Maintenance
npm run clear                # Remove .output directory
npm run prepare              # Setup husky git hooks
npm run postinstall          # WXT preparation (auto-runs after install)
```

## Architecture

### Extension Structure

WebChat uses WXT's app-based structure (not entrypoints):

- **src/app/content/** - Content-script UI; each page connects to the shared Runtime through comctx
- **src/app/background/** - Extension actions, notifications, Runtime coordination, and the Firefox MV2 Runtime host
- **src/app/offscreen/** - Chrome MV3 host document for the shared headless Runtime
- **src/app/options/** - Options page UI for user profile settings
- Entry files: `index.ts` or `index.tsx` in each app directory

### Domain-Driven Design (Remesh)

Remesh is used across two ownership layers:

**Application/page Domains** (`src/domain/`):

- `ChatRoom.ts` and `WorldRoom.ts` - UI-facing room state and Runtime event projection
- `Message.ts`, `MessageList.ts`, and `MessageProjection.ts` - Local record model, persistence workflow, ordering, and reaction LWW projection
- `UserInfo.ts`, `AppStatus.ts`, `Danmaku.ts`, `Notification.ts`, and `Toast.ts` - Page and extension behavior
- `domain/externs/` - Application dependency contracts
- `domain/impls/` - Page-side adapters, including the origin-owned message store and Runtime client
- `domain/modules/` - Reusable domain sub-modules

**Headless Runtime Domains** (`src/domain/runtime/`):

- `Network.ts` - Trusted peer transport, World/Chat room orchestration, identity binding, and bounded history synchronization
- `Lifecycle.ts` - Per-origin page leases and the shared host lifecycle
- `Delivery.ts` - Volatile delivery and durable-settlement acknowledgement
- `runtime/Server.ts` creates the headless Remesh store and injects clock, identity, wire, and page-port externs through adapters.

### P2P Communication Architecture

The content pages are UI/comctx clients. They do not own peer rooms or duplicate durable history. A single shared headless Runtime lives in a Chrome MV3 offscreen document or the persistent Firefox MV2 background page. The Runtime owns the Trystero WebRTC transport, trusted `sourcePeerId` context, World/Chat sessions, decode and delivery queues, and history scheduling, supply, cancellation, and admission. After the last page for an origin detaches, that origin's domain state enters a five-second grace period; this does not release the shared Runtime or any other domain.

`src/protocol/` is the third-party-facing peer boundary:

- Chat v2 is the closed union `session | text | reaction | history-request | history-response`.
- World v2 has no message `type`; trusted room context selects its strict `{sessionId,user,sites}` shape.
- Peer frames use the fixed `base64(deflate(UTF8(JSON)))` codec and strict schemas. Payload identity never replaces the transport-provided source identity.

**Connection Flow**:

1. A content page registers its `{ domain, pageId }` lease and attaches to the shared Runtime through comctx.
2. The Runtime joins the v2 World room and the origin-derived v2 Chat room, then projects trusted snapshots and events to attached pages.
3. The Runtime allocates event IDs/HLC values centrally; the page persists the canonical local record before transport is attempted.
4. History is pulled recent-first with exclusive `(hlc, id)` cursors and settles into the requesting page's origin store.
5. Detaching the last page starts that origin domain's five-second grace period. Reconnecting during the grace period retains that domain. Expiry releases only its origin Chat room, World presence contribution, sessions, and history/delivery state; the shared Runtime host and all other active or grace-period domains remain alive.

### Storage Strategy

Page-owned storage is split by purpose:

- `src/domain/impls/Storage.ts` provides local storage for UI state and browser sync storage for the user profile.
- `src/domain/impls/MessageStore.ts` owns the per-origin IndexedDB store of exact `LocalRecord` values.
- Canonical records use atomic first-value-wins persistence. Durable event status is monotonic `pending -> sent`; received peer events use `received`. System notices and record metadata remain local-only.
- The Runtime may buffer unacknowledged deliveries, but it does not own or copy durable history. A page acknowledges only after its origin store settles the record.

Key storage keys in `src/constants/storage.ts`:

- `USER_INFO_STORAGE_KEY` - User profile (browser sync storage)
- `APP_OPEN_STORAGE_KEY = WEB_CHAT_APP_STATUS:OPEN` - Shared open state (local storage)
- `APP_POSITION_STORAGE_KEY = WEB_CHAT_APP_STATUS:POSITION` - Shared launcher position (local storage)
- `APP_UNREAD_STORAGE_KEY = WEB_CHAT_APP_STATUS:UNREAD` - Shared boolean unread attention (local storage)

`AppStatusDomain` owns one aggregate `{ open, position, unread }` business truth. Each field persists through its own field-scoped key so an update cannot overwrite either unaddressed field; unread is attention, not a count.

### History Synchronization

- `HISTORY_WINDOW_DAYS = 30` is a peer-history candidate window, not a local durable-retention or deletion policy.
- The requester freezes `requesterNow - 30 days` once at sync start. Retries, pagination, and provider failover do not reread its injected clock.
- Each provider independently freezes `providerNow - 30 days` at supply-session admission. Page failover, later cursors, and successor promotion retain that admitted cutoff.
- Cutoffs are not sent on the wire and do not need to match. Provider filtering is non-destructive; the requester remains final acceptance authority.
- Both sides accept an event exactly at their own cutoff and exclude or reject only earlier events. Clock skew may omit a boundary candidate but cannot expand the requester's window.
- A history session is recent-first with no whole-session cumulative event-count or byte budget and a fixed 10-second no-progress timeout. Provider admission allows at most 4 active jobs, 32 admitted jobs including dormant successors, and 8KiB of queued metadata. Each page supply has a five-second physical cancellation boundary.

## Code Organization

```
src/
├── app/              # WXT applications (content, background, offscreen, options)
├── protocol/         # Public v2 peer types, strict schemas, limits, and fixed codec
├── domain/           # Application/page Remesh domains and local models
│   ├── externs/      # Application dependency interfaces
│   ├── impls/        # Page-side adapters and origin-owned persistence
│   ├── modules/      # Reusable domain modules
│   └── runtime/      # Headless Runtime Remesh domains
├── runtime/          # Runtime server, host lifecycle, wire pipeline, and internal RPC
├── service/adapter/  # Browser/runtime/comctx adapters
├── components/       # React UI components
│   ├── ui/           # shadcn/ui base components
│   └── magicui/      # Magic UI animated components
├── utils/            # Pure utility functions
├── constants/        # App constants and config
├── hooks/            # React hooks
├── lib/              # Third-party library integrations
└── assets/           # Static assets (images, styles)
```

## Path Aliases

TypeScript paths configured in `tsconfig.json`:

- `@/*` → `./src/*`

Import example: `import { ChatRoomDomain } from '@/domain/ChatRoom'`

## Important Constants

Application and Runtime constants in `src/constants/config.ts`:

- `MESSAGE_MAX_LENGTH = 500` - Maximum visible draft length
- `MESSAGE_IMAGE_TARGET_SIZE = 30 * 1024` - Image-compression target; canonical event size remains authoritative
- `MAX_AVATAR_SIZE = 5120` - Maximum avatar size in browser sync storage
- `HISTORY_WINDOW_DAYS = 30` - Frozen peer-history candidate window
- `RUNTIME_DOMAIN_GRACE_MS = 5000` - Per-domain last-page detach grace; it is not the shared host lifetime

Public limits in `src/protocol/Limits.ts` are deliberately separate:

- A wire frame is at most 256KiB; a history response must be strictly less than 256KiB.
- Decoded JSON is at most 1MiB.
- The static declarative Text body ceiling is at most 192KiB; a `User` value is at most 8KiB.
- A history response contains at most 100 events.

## Browser Extension Specifics

**Manifest configuration** (`wxt.config.ts`):

- Permissions: `storage`, `notifications`, `tabs`
- Matches: `https://*/*`
- Excludes: localhost, 127.0.0.1, accounts.google.com
- Browser-specific manifests for Chrome and Firefox

**Content Script Injection**:

- Shadow DOM mode: `open`
- Position: `inline` in body (appended last)
- CSS isolation with `cssInjectionMode: 'ui'`
- Event isolation: keyup, keydown, keypress

## Working with Remesh Domains

A Remesh domain defines state transitions with Queries, Commands, Events, and Effects. Keep browser, transport, clock, storage, and internal page-port capabilities behind Extern contracts and inject concrete adapters when constructing the appropriate page or Runtime store.

Page domains may project Runtime snapshots and events into UI state and origin-owned persistence. Peer decoding, source binding, queues, history state machines, and host RPC belong to the shared Runtime; public wire schemas and resource checks belong to `src/protocol/`.

## Validation with Valibot

Public peer-message schemas use Valibot (not Zod):

```typescript
import * as v from 'valibot'

const schema = v.object({
  /* ... */
})
const isValid = v.safeParse(schema, data).success
```

## Linting & Git Hooks

- **Husky** pre-commit hooks configured
- **lint-staged** auto-fixes JS/TS files on commit
- **commitlint** enforces conventional commit messages

## Node Version

Minimum Node.js version: `>=20.0.0` (see `engines` in package.json)
