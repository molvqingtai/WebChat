import React from 'react'
import { createRoot } from 'react-dom/client'
import { Remesh, type RemeshExtern, type RemeshExternImpl } from 'remesh'
import { RemeshRoot, RemeshScope } from 'remesh-react'
// import { RemeshLogger } from 'remesh-logger'
import { defineContentScript, createShadowRootUi } from '#imports'

import App from './App'
import { LocalStorageImpl, BrowserSyncStorageImpl, prepareLocalConfigurationStorage } from '@/domain/impls/Storage'
import { createIndexedDBMessageDatabase, prepareIndexedDBMessageDatabase } from '@/domain/impls/database/IndexedDB'
import { detachClient, initClient, whenHostPhase } from '@/domain/impls/runtime/Client'
import { DanmakuImpl } from '@/domain/impls/Danmaku'
import { NotificationImpl } from '@/domain/impls/Notification'
import { ToastImpl } from '@/domain/impls/Toast'
import { createChatRoomImpl } from '@/domain/impls/ChatRoom'
import { createWorldRoomImpl } from '@/domain/impls/WorldRoom'
import { createReadinessImpl } from '@/domain/impls/Readiness'
import { AppActionImpl } from '@/domain/impls/AppAction'
// Remove import after merging: https://github.com/emilkowalski/sonner/pull/508
import 'sonner/dist/styles.css'
import '@/assets/styles/tailwind.css'
import '@/assets/styles/overlay.css'
import NotificationDomain from '@/domain/Notification'
import ToastDomain from '@/domain/Toast'
import ToastPresentationDomain from '@/domain/ToastPresentation'
import AppFeedbackDomain from '@/domain/AppFeedback'
import AppStatusDomain from '@/domain/AppStatus'
import AppStatusEffectsDomain from '@/domain/AppStatusEffects'
import { createElement } from '@/utils'
import { requestBrowserSyncStoragePreparation } from '@/service/StoragePreparation'
import ContentBootstrap, { type BootstrapDependencies } from '@/app/content/Bootstrap'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'

const bootstrapDependencies: BootstrapDependencies = {
  prepareBrowserSyncStorage: requestBrowserSyncStoragePreparation,
  prepareLocalStorage: prepareLocalConfigurationStorage,
  prepareMessageDatabase: prepareIndexedDBMessageDatabase,
  initializeRuntime: initClient,
  detachRuntime: detachClient
}

const createDeferredExtern = <Value,>(Extern: RemeshExtern<Value>) => {
  let resolved: { value: Value } | null = null
  const implementation: RemeshExternImpl<Value> = {
    type: 'RemeshExternImpl',
    Extern,
    get value() {
      if (!resolved) throw new Error('Application dependency is unavailable before bootstrap')
      return resolved.value
    }
  }
  return {
    implementation,
    resolve: (value: Value) => {
      if (resolved) throw new Error('Application dependency is already initialized')
      resolved = { value }
    }
  }
}

const createShellStore = () => {
  const messageDatabase = createDeferredExtern(MessageDatabaseExtern)
  const chatRoom = createDeferredExtern(ChatRoomExtern)
  const worldRoom = createDeferredExtern(WorldRoomExtern)
  const readiness = createDeferredExtern(ReadinessExtern)
  const store = Remesh.store({
    externs: [
      LocalStorageImpl,
      BrowserSyncStorageImpl,
      messageDatabase.implementation,
      chatRoom.implementation,
      worldRoom.implementation,
      readiness.implementation,
      AppActionImpl,
      ToastImpl,
      DanmakuImpl,
      NotificationImpl
    ]
    // inspectors: __DEV__ ? [RemeshLogger()] : []
  })
  return {
    store,
    activateApplicationDependencies: () => {
      const database = createIndexedDBMessageDatabase()
      const ChatRoomImpl = createChatRoomImpl(database)
      const WorldRoomImpl = createWorldRoomImpl()
      const ReadinessImpl = createReadinessImpl(whenHostPhase)
      messageDatabase.resolve(database)
      chatRoom.resolve(ChatRoomImpl.value)
      worldRoom.resolve(WorldRoomImpl.value)
      readiness.resolve(ReadinessImpl.value)
    }
  }
}

const createApplication = () => {
  return (
    <React.StrictMode>
      <RemeshScope domains={[AppStatusEffectsDomain(), NotificationDomain(), ToastDomain(), AppFeedbackDomain()]}>
        <App />
      </RemeshScope>
    </React.StrictMode>
  )
}

export default defineContentScript({
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  matches: ['https://*/*'],
  excludeMatches: ['*://localhost/*', '*://127.0.0.1/*', '*://*.csdn.net/*', '*://*.csdn.com/*'],
  async main(ctx) {
    // Attach to the shared Runtime before igniting any domain: the background
    // coordinator creates the host single-flight; pages own no WebRTC state.
    window.addEventListener('beforeunload', detachClient, { once: true })

    const ui = await createShadowRootUi(ctx, {
      name: __NAME__,
      position: 'inline',
      anchor: 'body',
      append: 'last',
      mode: 'open',
      isolateEvents: ['keyup', 'keydown', 'keypress'],
      onMount: (container) => {
        const app = createElement('<div id="root"></div>')
        container.append(app)
        const root = createRoot(app)
        const { store, activateApplicationDependencies } = createShellStore()
        const createReadyApplication = () => {
          activateApplicationDependencies()
          return createApplication()
        }
        root.render(
          <RemeshRoot store={store}>
            <RemeshScope domains={[AppStatusDomain(), ToastPresentationDomain()]}>
              <ContentBootstrap dependencies={bootstrapDependencies} createApplication={createReadyApplication} />
            </RemeshScope>
          </RemeshRoot>
        )
        return root
      },
      onRemove: (root) => {
        root?.unmount()
      }
    })
    ui.mount()
  }
})
