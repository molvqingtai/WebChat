import React from 'react'
import { createRoot } from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot, RemeshScope } from 'remesh-react'
// import { RemeshLogger } from 'remesh-logger'
import { defineContentScript, createShadowRootUi } from '#imports'

import App from './App'
import { LocalStorageImpl, BrowserSyncStorageImpl, prepareLocalConfigurationStorage } from '@/domain/impls/Storage'
import { MessageDatabaseImpl, prepareIndexedDBMessageDatabase } from '@/domain/impls/database/IndexedDB'
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
import { createElement } from '@/utils'
import { requestBrowserSyncStoragePreparation } from '@/service/StoragePreparation'
import ContentBootstrap, { type BootstrapDependencies } from '@/app/content/Bootstrap'

const bootstrapDependencies: BootstrapDependencies = {
  prepareBrowserSyncStorage: requestBrowserSyncStoragePreparation,
  prepareLocalStorage: prepareLocalConfigurationStorage,
  prepareMessageDatabase: prepareIndexedDBMessageDatabase,
  initializeRuntime: initClient,
  detachRuntime: detachClient
}

const createApplication = () => {
  const ChatRoomImpl = createChatRoomImpl(MessageDatabaseImpl.value)
  const WorldRoomImpl = createWorldRoomImpl()
  const ReadinessImpl = createReadinessImpl(whenHostPhase)
  const store = Remesh.store({
    externs: [
      LocalStorageImpl,
      BrowserSyncStorageImpl,
      MessageDatabaseImpl,
      ChatRoomImpl,
      WorldRoomImpl,
      ReadinessImpl,
      AppActionImpl,
      ToastImpl,
      DanmakuImpl,
      NotificationImpl
    ]
    // inspectors: __DEV__ ? [RemeshLogger()] : []
  })

  return (
    <React.StrictMode>
      <RemeshRoot store={store}>
        <RemeshScope domains={[NotificationDomain(), ToastDomain(), ToastPresentationDomain(), AppFeedbackDomain()]}>
          <App />
        </RemeshScope>
      </RemeshRoot>
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
        root.render(<ContentBootstrap dependencies={bootstrapDependencies} createApplication={createApplication} />)
        return root
      },
      onRemove: (root) => {
        root?.unmount()
      }
    })
    ui.mount()
  }
})
