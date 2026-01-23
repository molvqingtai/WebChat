# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

WebChat is a decentralized, serverless browser extension that enables anonymous P2P chat on any website using WebRTC. Built with WXT framework for cross-browser support (Chrome, Firefox, Edge).

## Key Technologies

- **WXT**: Browser extension framework (config: `wxt.config.ts`)
- **Remesh**: DDD framework for domain logic with true UI/logic separation (RxJS-based reactive state management)
- **Artico (@rtco/client)**: WebRTC P2P communication library (replaces previous trystero dependency)
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
npm run lint                 # ESLint with auto-fix and cache

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
- **src/app/content/** - Content script injected into web pages (main chat UI)
- **src/app/background/** - Service worker handling notifications and extension actions
- **src/app/options/** - Options page UI for user profile settings
- Entry files: `index.ts` or `index.tsx` in each app directory

### Domain-Driven Design (Remesh)

Business logic is fully decoupled from UI using Remesh domains:

**Core Domains** (`src/domain/`):
- `ChatRoom.ts` - Site-specific P2P chat room (messages, users, sync)
- `VirtualRoom.ts` - Global virtual room for cross-site user discovery
- `MessageList.ts` - Message management and persistence
- `UserInfo.ts` - User profile state
- `AppStatus.ts` - Application state (open/minimized)
- `Danmaku.ts` - Danmaku/bullet comments display
- `Notification.ts` - Browser notifications
- `Toast.ts` - In-app toast messages

**Domain Pattern**:
- `domain/` - Remesh domain definitions (pure logic, queries, commands, events)
- `domain/externs/` - External dependency interfaces (define contracts)
- `domain/impls/` - Concrete implementations of externs (WebRTC, storage, etc.)
- `domain/modules/` - Reusable domain sub-modules

### P2P Communication Architecture

**Two-Layer Room System**:

1. **ChatRoom** (Site-specific):
   - RoomId: Hash of current page's origin
   - Users on same site chat in isolated rooms
   - Message types: Text, Like, Hate, SyncUser, SyncHistory
   - History sync: Last 90 days (`SYNC_HISTORY_MAX_DAYS`)
   - Message size limit: 256KiB (`WEB_RTC_MAX_MESSAGE_SIZE`)

2. **VirtualRoom** (Global):
   - RoomId: `WEB_CHAT_VIRTUAL_ROOM` constant
   - Cross-site user discovery
   - Shares online user presence across different websites
   - Message types: SyncUser only

**Connection Flow**:
1. User joins VirtualRoom (global presence)
2. User joins ChatRoom (site-specific, based on `location.origin`)
3. On peer join: Exchange SyncUser messages
4. Sync message history if peer's lastMessageTime is older
5. WebRTC data channels handle all message transport

### Storage Strategy

Three-tier storage implemented in `src/domain/impls/Storage.ts`:
- **LocalStorage** - Fast, synchronous access (volatile)
- **IndexDB** - Large data persistence (message history)
- **BrowserSyncStorage** - Cross-device user profile sync (8kb limit per key)

Key storage keys in `src/constants/config.ts`:
- `USER_INFO_STORAGE_KEY` - User profile (synced)
- `MESSAGE_LIST_STORAGE_KEY` - Message history (IndexDB)
- `APP_STATUS_STORAGE_KEY` - App UI state (local)

### Message Sync Logic

**Important sync behavior** (documented in ChatRoom.ts:337-355):
- New peer joins → existing peers with newer messages push history
- Only messages newer than peer's `lastMessageTime` are synced
- Messages chunked to respect WebRTC size limits
- Incremental sync (not full 90-day diff) - may result in incomplete history for peers joining at different times

## Code Organization

```
src/
├── app/              # WXT applications (content, background, options)
├── domain/           # Remesh domains (business logic)
│   ├── externs/      # External dependency interfaces
│   ├── impls/        # Concrete implementations
│   └── modules/      # Reusable domain modules
├── components/       # React UI components
│   ├── ui/           # shadcn/ui base components
│   └── magicui/      # Magic UI animated components
├── utils/            # Pure utility functions
├── constants/        # App constants and config
├── hooks/            # React hooks
├── messenger/        # Extension messaging (webext-bridge)
├── lib/              # Third-party library integrations
└── assets/           # Static assets (images, styles)
```

## Path Aliases

TypeScript paths configured in `tsconfig.json`:
- `@/*` → `./src/*`

Import example: `import { ChatRoomDomain } from '@/domain/ChatRoom'`

## Important Constants

In `src/constants/config.ts`:
- `MESSAGE_MAX_LENGTH = 500` - Max message length
- `MAX_AVATAR_SIZE = 5120` - Max avatar size (bytes) for sync storage
- `SYNC_HISTORY_MAX_DAYS = 90` - Message history retention
- `WEB_RTC_MAX_MESSAGE_SIZE = 262144` - 256KiB WebRTC limit
- `VIRTUAL_ROOM_ID = 'WEB_CHAT_VIRTUAL_ROOM'` - Global room identifier

## Browser Extension Specifics

**Manifest configuration** (`wxt.config.ts`):
- Permissions: `storage`, `notifications`, `tabs`
- Matches: `https://*/*`
- Excludes: localhost, 127.0.0.1, csdn.net, csdn.com
- Browser-specific manifests for Chrome and Firefox

**Content Script Injection**:
- Shadow DOM mode: `open`
- Position: `inline` in body (appended last)
- CSS isolation with `cssInjectionMode: 'ui'`
- Event isolation: keyup, keydown, keypress

## Working with Remesh Domains

**Creating/Using Domains**:
```typescript
// In content script
const store = Remesh.store({
  externs: [
    LocalStorageImpl,
    IndexDBStorageImpl,
    BrowserSyncStorageImpl,
    ChatRoomImpl,
    VirtualRoomImpl,
    // ... other implementations
  ]
})

// In React component
const send = domain.useRemeshSend()
const userList = domain.useRemeshQuery(chatRoomDomain.query.UserListQuery())

// Send command
send(chatRoomDomain.command.SendTextMessageCommand('Hello'))

// Subscribe to event
domain.useRemeshEvent(chatRoomDomain.event.OnTextMessageEvent, (message) => {
  console.log('New message:', message)
})
```

## Validation with Valibot

All runtime message validation uses Valibot (not Zod):
```typescript
import * as v from 'valibot'

const schema = v.object({ /* ... */ })
const isValid = v.safeParse(schema, data).success
```

## Linting & Git Hooks

- **Husky** pre-commit hooks configured
- **lint-staged** auto-fixes JS/TS files on commit
- **commitlint** enforces conventional commit messages

## Node Version

Minimum Node.js version: `>=20.0.0` (see `engines` in package.json)