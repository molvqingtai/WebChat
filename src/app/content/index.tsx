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
import { createRuntimePorts } from '@/domain/impls/ChatRoom'
import { createHostLocator } from '@/runtime/locator'
import { DanmakuImpl } from '@/domain/impls/Danmaku'
import { NotificationImpl } from '@/domain/impls/Notification'
import { ToastImpl } from '@/domain/impls/Toast'
import { AppActionImpl } from '@/domain/impls/AppAction'
// Remove import after merging: https://github.com/emilkowalski/sonner/pull/508
import 'sonner/dist/styles.css'
import '@/assets/styles/tailwind.css'
import '@/assets/styles/overlay.css'
import NotificationDomain from '@/domain/Notification'
import AppFeedbackDomain from '@/domain/AppFeedback'
import { bindDocumentLifecycle } from './documentLifecycle'
import ToastDomain from '@/domain/Toast'
import { createElement } from '@/utils'
import { requestBrowserSyncStoragePreparation } from '@/service/StoragePreparation'
import { createDirectPreparationCoordinator, createWebLocksPreparationCoordinator } from '@/utils/withPreparationLock'
import { createMessageStore, MessageDatabaseExtern, type MessageDatabaseSchema } from '@/domain/MessageStore'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
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

const createDeferredValue = <Value,>() => {
  let current: Value | null = null
  const { promise, resolve } = Promise.withResolvers<Value>()
  return {
    get: () => (current === null ? promise : Promise.resolve(current)),
    resolve: (value: Value) => {
      if (current !== null) throw new Error('Application dependency is already initialized')
      current = value
      resolve(value)
    }
  }
}

/**
 * Storage must be prepared (migrated) before anything reads it, but the store and its domains are
 * created first. These two ports therefore wait for `activateStorage`.
 */
const createContentStore = () => {
  const browserSyncStorage = createDeferredValue<Storage>()
  const messageDatabase = createDeferredValue<Database<MessageDatabaseSchema>>()

  const deferredBrowserSyncStorage: Storage = {
    get: async <Value extends StorageValue>(key: string) => (await browserSyncStorage.get()).get<Value>(key),
    set: async <Value extends StorageValue>(key: string, value: Value) =>
      (await browserSyncStorage.get()).set(key, value),
    watch: async (callback) => (await browserSyncStorage.get()).watch(callback)
  }
  const deferredMessageDatabase: Database<MessageDatabaseSchema> = {
    read: async (stores, operation, signal) => (await messageDatabase.get()).read(stores, operation, signal),
    write: async (stores, operation, signal) => (await messageDatabase.get()).write(stores, operation, signal),
    watch: (stores, listener) => {
      let active = true
      let unsubscribe = () => {}
      void messageDatabase.get().then((database) => {
        if (active) unsubscribe = database.watch(stores, listener)
      })
      return () => {
        active = false
        unsubscribe()
      }
    }
  }

  const runtime = createRuntimePorts(createHostLocator(), createMessageStore(deferredMessageDatabase))

  const store = Remesh.store({
    externs: [
      LocalStorageImpl,
      BrowserSyncStorageExtern.impl(deferredBrowserSyncStorage),
      MessageDatabaseExtern.impl(deferredMessageDatabase),
      ChatRoomExtern.impl(runtime.chatRoom),
      WorldRoomExtern.impl(runtime.worldRoom),
      ReadinessExtern.impl(runtime.readiness),
      AppActionImpl,
      ToastImpl,
      DanmakuImpl,
      NotificationImpl
    ]
  })
  const toast = store.getDomain(ToastDomain())

  runtime.onHistoryFeedback((event) =>
    store.send(
      event.type === 'loading'
        ? toast.command.LoadingCommand({ id: event.ownerId, message: 'Syncing message history...' })
        : toast.command.CancelCommand(event.ownerId)
    )
  )

  let storageActivated = false
  const activateStorage = () => {
    if (storageActivated) return
    storageActivated = true
    browserSyncStorage.resolve(BrowserSyncStorageImpl.value)
    messageDatabase.resolve(
      createIndexedDBMessageDatabase({
        onWatcherError: (error) =>
          store.send(toast.command.ErrorCommand(error instanceof Error ? error.message : String(error)))
      })
    )
  }

  const initialization: InitializationDependencies = {
    prepareBrowserSyncStorage: requestBrowserSyncStoragePreparation,
    prepareLocalStorage: () => prepareLocalConfigurationStorage(preparationLockCoordinator),
    prepareMessageDatabase: () => prepareIndexedDBMessageDatabase(preparationLockCoordinator),
    initializeRuntime: () => {
      activateStorage()
      return runtime.start()
    },
    detachRuntime: runtime.stop
  }

  return { store, runtime, activateStorage, initialization }
}

export default defineContentScript({
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  matches: ['https://*/*'],
  excludeMatches: ['*://localhost/*', '*://127.0.0.1/*', '*://accounts.google.com/*'],
  async main(ctx) {
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
        const { store, runtime, activateStorage, initialization } = createContentStore()
        const unbindDocumentLifecycle = bindDocumentLifecycle({
          store,
          startRuntime: runtime.start,
          stopRuntime: runtime.stop
        })

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
          dependencies: initialization,
          activateApplicationDependencies: activateStorage
        })
        return { root, store, stopInitialization, unbindDocumentLifecycle }
      },
      onRemove: (content) => {
        content?.unbindDocumentLifecycle()
        content?.stopInitialization()
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
