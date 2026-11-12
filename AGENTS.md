# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Overview

WebChat is a decentralized, serverless browser extension that enables anonymous P2P chat on any website using WebRTC. Built with WXT framework for cross-browser support (Chrome, Firefox, Edge).

## Key Technologies

- **WXT**: Browser extension framework (config: `wxt.config.ts`)
- **Remesh**: DDD framework for domain logic with true UI/logic separation (RxJS-based reactive state management)
- **Artico**: Default WebRTC P2P room transport, using WebChat's owned signaling endpoint
- **Trystero**: Supported alternative WebRTC P2P room transport using its default public Nostr strategy
- **React 19** with TypeScript
- **Tailwind CSS v4** with shadcn/ui components
- **Valibot**: Runtime schema validation

## Development Commands

```bash
# Development
npm run dev                  # Chrome dev mode with hot reload
npm run dev:firefox          # Firefox dev mode

# Type checking
npm run check                # TypeScript, plus the DOM-free check of src/runtime/core

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

- **src/app/content/** - Content-script UI; each page connects to the shared Runtime over a Port
- **src/app/background/** - Extension actions, notifications, creating the Runtime host on demand, and the Firefox MV2 Runtime host
- **src/app/offscreen/** - Chrome MV3 host document for the shared Runtime
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

**Runtime Domains** (`src/runtime/core/domain/`):

- `Wire.ts` - Transport events in, decoded and schema-checked frames out, in per-source order
- `Lifecycle.ts` - Which sites have a connected page, and the five-second grace after the last one leaves
- `Room.ts` - One Chat room per site: local presence, remote presences, the HLC clock, sending and receiving messages
- `World.ts` - The single World room and the per-browser site list
- `History.ts` - History sync with each newly met peer
- `Runtime.ts` builds the store and serves the pages; it never touches DOM or `browser.*`

### P2P Communication Architecture

WebRTC needs a document, so the Runtime runs in a Chrome MV3 offscreen document or the Firefox MV2 background page (`src/runtime/host.ts`). `src/runtime/core/` contains everything else and is compiled by `tsconfig.core.json` with `lib: ESNext + WebWorker` and no DOM, so it can move to a worker host unchanged when workers get WebRTC. Its only seams are `Channel` (one connected page) and `HostLocator` (how a page reaches the host), in `src/runtime/core/Contract.ts`.

- Pages connect straight to the host with `runtime.connect`. The Chrome service worker only answers "make sure the host exists" and carries no Runtime code; it is not on the message path.
- The page owns intent (joined or not, user, presence id) and the message store. When the host or the worker goes away, the Port closes, the page reconnects (waking the worker, which recreates the host) and replays its join with the same presence, so peers see neither a leave nor a join.
- Page → Runtime: `join`, `reconnect`, `send`. Runtime → page: `persist`, `readHistory`, `publish`. Both directions use comctx over the Channel.
- One Chat room per site, shared by all its tabs; one World room per browser. After the last page of a site disconnects, its room is kept for five seconds.
- Artico is the build-time default transport; Trystero is the alternative. `ROOM_TRANSPORT_PROVIDER` selects one; there is no runtime switch.

`src/protocol/` is the peer boundary (namespace `V5`):

- Chat messages are the closed union `session | text | reaction | history-messages-pull | history-messages-push`.
- World presence has no `type`; the room selects its strict `{sessionId, user, sites}` shape.
- Frames use the fixed `base64(deflate(UTF8(JSON)))` codec and strict schemas. The sender is always the transport-provided peer id, never a payload field.

### Storage Strategy

- `src/domain/impls/Storage.ts` provides local storage for UI state and browser sync storage for the user profile.
- `src/domain/MessageStore.ts` is the per-origin IndexedDB message store. Inserts are first-value-wins by record id.
- The Runtime keeps no history. It asks a page of the site to store live and history messages, and to read history for a peer. While a site has no page (grace period) live messages are held in memory and handed to the next page.

Key storage keys in `src/constants/storage.ts`:

- `USER_INFO_STORAGE_KEY` - User profile (browser sync storage)
- `APP_OPEN_STORAGE_KEY = WEB_CHAT_APP_STATUS:OPEN` - Shared open state (local storage)
- `APP_POSITION_STORAGE_KEY = WEB_CHAT_APP_STATUS:POSITION` - Shared launcher position (local storage)
- `APP_UNREAD_STORAGE_KEY = WEB_CHAT_APP_STATUS:UNREAD` - Shared boolean unread attention (local storage)

`AppStatusDomain` owns one aggregate `{ open, position, unread }` business truth. Each field persists through its own field-scoped key so an update cannot overwrite either unaddressed field; unread is attention, not a count.

### History Synchronization

- When two peers meet in a Chat room, each asks the other once: it sends the ids it already has from the last 30 days, and receives what it is missing, oldest first, at most 100 messages per page.
- A sync ends when its last page arrives, the peer leaves, or 10 seconds pass without a page.
- The "Syncing message history..." toast shows only while a sync is storing something new.

## Code Organization

```
src/
├── app/              # WXT applications (content, background, offscreen, options)
├── protocol/         # Public peer types, strict schemas, limits, and fixed codec
├── domain/           # Application/page Remesh domains and local models
│   ├── externs/      # Application dependency interfaces
│   ├── impls/        # Page-side adapters, including the Runtime client
│   └── modules/      # Reusable domain modules
├── runtime/
│   ├── core/         # The Runtime: Remesh domains, contract, RPC (no DOM, no browser.*)
│   ├── transports/   # Artico and Trystero room transports
│   └── *.ts          # Host, page locator, Port channel, ensure-host
├── service/          # Notification and AppAction services, comctx adapters
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

Application constants in `src/constants/config.ts` (Runtime timings are in `src/runtime/core/Config.ts`):

- `MESSAGE_MAX_LENGTH = 500` - Maximum visible draft length
- `MESSAGE_IMAGE_TARGET_SIZE = 30 * 1024` - Image-compression target; canonical event size remains authoritative
- `MAX_AVATAR_SIZE = 5120` - Maximum avatar size in browser sync storage
- `ROOM_TRANSPORT_PROVIDER = 'artico'` - Build-time room transport selection; the supported alternative is `'trystero'`

Public limits in `src/protocol/Limits.ts` are deliberately separate:

- A wire frame is at most 256KiB; a history response must be strictly less than 256KiB.
- Decoded JSON is at most 1MiB.
- The static declarative Text body ceiling is at most 192KiB; a `User` value is at most 8KiB.
- A history response contains at most 100 events.

## Browser Extension Specifics

**Manifest configuration** (`wxt.config.ts`):

- Permissions: `storage`, `notifications`, `tabs` (Chrome also `offscreen`)
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

Page domains see the Runtime only through the `ChatRoom`, `WorldRoom` and `Readiness` externs. Runtime domains reach transports, the clock, ids and pages only through the externs in `src/runtime/core/Externs.ts`; public wire schemas and resource checks belong to `src/protocol/`.

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

Node.js `^22.18.0 || >=23.6.0` (see `engines` in package.json)
