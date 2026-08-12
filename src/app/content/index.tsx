import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot, RemeshScope } from 'remesh-react'
// import { RemeshLogger } from 'remesh-logger'
import { defineContentScript, createShadowRootUi } from '#imports'

import App from './App'
import { startInitializationLifecycle, type InitializationDependencies } from './Initialization'
import { LocalStorageImpl, BrowserSyncStorageImpl, prepareLocalConfigurationStorage } from '@/domain/impls/Storage'
import { createIndexedDBMessageDatabase, prepareIndexedDBMessageDatabase } from '@/domain/impls/database/IndexedDB'
import { detachClient, initClient, whenFailure, whenHostPhase } from '@/domain/impls/runtime/Client'
import { DanmakuImpl } from '@/domain/impls/Danmaku'
import { NotificationImpl } from '@/domain/impls/Notification'
import { ToastImpl } from '@/domain/impls/Toast'
import { createChatRoomImpl } from '@/domain/impls/ChatRoom'
import type { ChatRoom as RuntimeChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createWorldRoomImpl } from '@/domain/impls/WorldRoom'
import { createReadinessImpl } from '@/domain/impls/Readiness'
import { createConnectionLifecycle } from '@/domain/impls/ConnectionLifecycle'
import { createSendLifecycle } from '@/domain/impls/SendLifecycle'
import { AppActionImpl } from '@/domain/impls/AppAction'
// Remove import after merging: https://github.com/emilkowalski/sonner/pull/508
import 'sonner/dist/styles.css'
import '@/assets/styles/tailwind.css'
import '@/assets/styles/overlay.css'
import NotificationDomain from '@/domain/Notification'
import AppFeedbackDomain from '@/domain/AppFeedback'
import { createDocumentLifecycleOwner } from './documentLifecycle'
import ToastDomain from '@/domain/Toast'
import { createElement } from '@/utils'
import { requestBrowserSyncStoragePreparation } from '@/service/StoragePreparation'
import { createDirectPreparationCoordinator, createWebLocksPreparationCoordinator } from '@/utils/withPreparationLock'
import { MessageDatabaseExtern, type MessageDatabaseSchema } from '@/domain/MessageStore'
import {
  ChatRoomExtern,
  type ChatRoom,
  type SendMessageCommand,
  type SendReactionCommand,
  type SendTextCommand
} from '@/domain/externs/ChatRoom'
import type { ChatMessage, ReactionMessage, TextMessage } from '@/protocol/ChatRoom'
import { WorldRoomExtern, type WorldRoom } from '@/domain/externs/WorldRoom'
import { ReadinessExtern, type Readiness } from '@/domain/externs/Readiness'
import { ConnectionLifecycleExtern, type ConnectionLifecycle } from '@/domain/externs/ConnectionLifecycle'
import { SendLifecycleExtern } from '@/domain/externs/SendLifecycle'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import type { Database } from '@/domain/externs/Database'
import {
  MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY,
  MEDIA_PREVIEW_TRANSITION_PART
} from '@/app/content/components/media-preview'

const CONTENT_LAYER = 2147483647
// WXT's important Shadow reset otherwise overrides the geometry applied by its overlay primitive.
const CONTENT_HOST_CSS = `:host {
  display: block !important;
  position: relative !important;
  width: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  z-index: ${CONTENT_LAYER} !important;
}`

const installMediaPreviewTransitionStyle = (host: HTMLElement) => {
  const style = document.createElement('style')
  style.dataset.webchatMediaPreviewTransition = ''
  style.textContent = `${host.localName}::part(${MEDIA_PREVIEW_TRANSITION_PART}) {
  view-transition-name: var(${MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY}, none);
}`
  document.head.append(style)
  return style
}

/**
 * Firefox content scripts cannot assimilate page-realm Web Locks Promises
 * (<https://bugzilla.mozilla.org/show_bug.cgi?id=1873028>), so Firefox runs preparation directly and relies
 * on versioned idempotent writes for cross-tab convergence; Chrome keeps Web Locks arbitration.
 */
const preparationLockCoordinator = import.meta.env.FIREFOX
  ? createDirectPreparationCoordinator()
  : createWebLocksPreparationCoordinator()

const initializationDependencies: InitializationDependencies = {
  prepareBrowserSyncStorage: requestBrowserSyncStoragePreparation,
  prepareLocalStorage: () => prepareLocalConfigurationStorage(preparationLockCoordinator),
  prepareMessageDatabase: () => prepareIndexedDBMessageDatabase(preparationLockCoordinator),
  initializeRuntime: initClient,
  detachRuntime: detachClient
}

const createDeferredValue = <Value,>() => {
  let current: Value | null = null
  let resolvePromise!: (value: Value) => void
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })

  return {
    get: () => (current === null ? promise : Promise.resolve(current)),
    resolve: (value: Value) => {
      if (current !== null) throw new Error('Application dependency is already initialized')
      current = value
      resolvePromise(value)
    }
  }
}

const subscribeDeferred = <Value,>(
  deferred: ReturnType<typeof createDeferredValue<Value>>,
  subscribe: (value: Value) => () => void
) => {
  let active = true
  let unsubscribe: (() => void) | null = null
  void deferred.get().then((value) => {
    if (!active) return
    const next = subscribe(value)
    if (active) unsubscribe = next
    else next()
  })
  return () => {
    active = false
    unsubscribe?.()
  }
}

const createContentStore = () => {
  const browserSyncStorage = createDeferredValue<Storage>()
  const messageDatabase = createDeferredValue<Database<MessageDatabaseSchema>>()
  const chatRoom = createDeferredValue<ChatRoom>()
  let realizedChatRoom: RuntimeChatRoom | null = null
  const worldRoom = createDeferredValue<WorldRoom>()
  const readiness = createDeferredValue<Readiness>()
  const connectionLifecycle = createDeferredValue<ConnectionLifecycle>()

  const deferredBrowserSyncStorage: Storage = {
    get: async <Value extends StorageValue>(key: string) => (await browserSyncStorage.get()).get<Value>(key),
    set: async <Value extends StorageValue>(key: string, value: Value) =>
      (await browserSyncStorage.get()).set(key, value),
    watch: async (callback) => (await browserSyncStorage.get()).watch(callback)
  }
  const deferredMessageDatabase: Database<MessageDatabaseSchema> = {
    read: async (stores, operation, signal) => (await messageDatabase.get()).read(stores, operation, signal),
    write: async (stores, operation, signal) => (await messageDatabase.get()).write(stores, operation, signal),
    watch: (stores, listener) => subscribeDeferred(messageDatabase, (database) => database.watch(stores, listener)),
    close: async () => (await messageDatabase.get()).close()
  }
  async function deferredSendMessage(command: SendTextCommand): Promise<TextMessage>
  async function deferredSendMessage(command: SendReactionCommand): Promise<ReactionMessage>
  async function deferredSendMessage(command: SendMessageCommand): Promise<ChatMessage>
  async function deferredSendMessage(command: SendMessageCommand): Promise<ChatMessage> {
    return (await chatRoom.get()).sendMessage(command)
  }
  const deferredChatRoom: ChatRoom = {
    joinRoom: (command) => {
      // Mint the exact invocation token synchronously (before any await), pass it explicitly into the
      // realized adapter, and bind this public-port task to it so the domain reads only this result.
      const token = deferredConnectionLifecycle.mint()
      const room = realizedChatRoom ?? (chatRoom as unknown as RuntimeChatRoom)
      const task = room.joinRoomWithToken(token, command)
      deferredConnectionLifecycle.bindTask(task, token)
      return task
    },
    leaveRoom: () => {
      const token = deferredConnectionLifecycle.mint()
      const room = realizedChatRoom ?? (chatRoom as unknown as RuntimeChatRoom)
      const task = room.leaveRoomWithToken(token)
      deferredConnectionLifecycle.bindTask(task, token)
      return task
    },
    sendMessage: deferredSendMessage,
    onMessage: (listener) => subscribeDeferred(chatRoom, (room) => room.onMessage(listener)),
    onJoinRoom: (listener) => subscribeDeferred(chatRoom, (room) => room.onJoinRoom(listener)),
    onLeaveRoom: (listener) => subscribeDeferred(chatRoom, (room) => room.onLeaveRoom(listener)),
    onSessions: (listener) => subscribeDeferred(chatRoom, (room) => room.onSessions(listener)),
    onError: (listener) => subscribeDeferred(chatRoom, (room) => room.onError(listener))
  }
  const deferredWorldRoom: WorldRoom = {
    getState: async () => (await worldRoom.get()).getState(),
    onState: (listener) => subscribeDeferred(worldRoom, (room) => room.onState(listener)),
    onError: (listener) => subscribeDeferred(worldRoom, (room) => room.onError(listener))
  }
  const deferredReadiness: Readiness = {
    onState: (listener) => subscribeDeferred(readiness, (value) => value.onState(listener))
  }
  let currentConnectionLifecycle: ConnectionLifecycle | null = null
  const deferredConnectionLifecycle: ConnectionLifecycle = {
    mint: () =>
      currentConnectionLifecycle
        ? currentConnectionLifecycle.mint()
        : (() => {
            throw new Error('ConnectionLifecycle not ready')
          })(),
    bindTask: (task, token) => currentConnectionLifecycle?.bindTask(task, token),
    getTaskResult: (task) => currentConnectionLifecycle?.getTaskResult(task) ?? 'active'
  }

  const sendLifecycleInstance = createSendLifecycle()
  const store = Remesh.store({
    externs: [
      LocalStorageImpl,
      BrowserSyncStorageExtern.impl(deferredBrowserSyncStorage),
      MessageDatabaseExtern.impl(deferredMessageDatabase),
      ChatRoomExtern.impl(deferredChatRoom),
      WorldRoomExtern.impl(deferredWorldRoom),
      ReadinessExtern.impl(deferredReadiness),
      ConnectionLifecycleExtern.impl(deferredConnectionLifecycle),
      SendLifecycleExtern.impl(sendLifecycleInstance),
      AppActionImpl,
      ToastImpl,
      DanmakuImpl,
      NotificationImpl
    ]
    // inspectors: __DEV__ ? [RemeshLogger()] : []
  })

  const activateApplicationDependencies = () => {
    const database = createIndexedDBMessageDatabase()
    const ChatRoomImpl = createChatRoomImpl(database)
    const WorldRoomImpl = createWorldRoomImpl()
    const ReadinessImpl = createReadinessImpl(whenHostPhase)
    const lifecycleBundle = createConnectionLifecycle()
    ChatRoomImpl.epochSource.bindConnectionResultReporter(lifecycleBundle.report)
    // One attempt-owned History loading Toast per incoming sync: the Runtime projects activate/dismiss
    // with a complete attempt owner id, and the page maps it to the generic loading Toast (no count,
    // no fixed duration). The owner id guarantees one sync never dismisses another or an unrelated Toast.
    ChatRoomImpl.epochSource.onHistoryFeedback((event) => {
      store.send(
        event.kind === 'loading'
          ? store
              .getDomain(ToastDomain())
              .command.LoadingCommand({ id: event.ownerId, message: 'Syncing message history...' })
          : store.getDomain(ToastDomain()).command.CancelCommand(event.ownerId)
      )
    })

    browserSyncStorage.resolve(BrowserSyncStorageImpl.value)
    messageDatabase.resolve(database)
    chatRoom.resolve(ChatRoomImpl.value)
    realizedChatRoom = ChatRoomImpl.epochSource
    worldRoom.resolve(WorldRoomImpl.value)
    readiness.resolve(ReadinessImpl.value)
    currentConnectionLifecycle = lifecycleBundle.value
    connectionLifecycle.resolve(lifecycleBundle.value)
  }

  // Every distinct real control-plane failure surfaces as a fresh original-message toast while the
  // lease keeps its bounded polling; detach ends the lifecycle and therefore further failures.
  whenFailure((error) => {
    store.send(store.getDomain(ToastDomain()).command.ErrorCommand(error.message))
  })

  return { store, activateApplicationDependencies, sendLifecycle: sendLifecycleInstance }
}

export default defineContentScript({
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  matches: ['https://*/*'],
  excludeMatches: ['*://localhost/*', '*://127.0.0.1/*', '*://accounts.google.com/*'],
  async main(ctx) {
    // Page lifecycle registration happens before any UI/Runtime initialization can run or suspend, so
    // an early failure still has exactly one cleanup owner (never a second lease authority).
    const documentLifecycle = createDocumentLifecycleOwner()

    let mediaPreviewTransitionStyle: HTMLStyleElement | null = null
    const ui = await createShadowRootUi(ctx, {
      name: __NAME__,
      position: 'overlay',
      css: CONTENT_HOST_CSS,
      anchor: 'body',
      append: 'last',
      mode: 'open',
      isolateEvents: ['keyup', 'keydown', 'keypress'],
      onMount: (container) => {
        const app = createElement('<div id="root"></div>')
        container.append(app)
        const root = createRoot(app)
        const { store, activateApplicationDependencies, sendLifecycle } = createContentStore()
        documentLifecycle.bind({ store, sendLifecycle, initLease: initClient, detachLease: detachClient })
        root.render(
          <StrictMode>
            <RemeshRoot store={store}>
              <RemeshScope domains={[NotificationDomain(), AppFeedbackDomain()]}>
                <App />
              </RemeshScope>
            </RemeshRoot>
          </StrictMode>
        )
        const stopInitialization = startInitializationLifecycle({
          store,
          dependencies: initializationDependencies,
          activateApplicationDependencies
        })
        return { root, store, stopInitialization, sendLifecycle, disposeDocumentLifecycle: documentLifecycle.dispose }
      },
      onRemove: (content) => {
        content?.disposeDocumentLifecycle()
        content?.stopInitialization()
        content?.sendLifecycle.cancelActiveSends()
        content?.root.unmount()
        content?.store.discard()
        mediaPreviewTransitionStyle?.remove()
        mediaPreviewTransitionStyle = null
      }
    })
    mediaPreviewTransitionStyle = installMediaPreviewTransitionStyle(ui.shadowHost)
    try {
      ui.mount()
    } catch (error) {
      mediaPreviewTransitionStyle.remove()
      mediaPreviewTransitionStyle = null
      throw error
    }
  }
})
