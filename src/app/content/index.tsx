import React from 'react'
import { createRoot } from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot, RemeshScope } from 'remesh-react'
// import { RemeshLogger } from 'remesh-logger'
import { defineContentScript, createShadowRootUi } from '#imports'

import App from './App'
import { LocalStorageImpl, BrowserSyncStorageImpl } from '@/domain/impls/Storage'
import { MessageDatabaseImpl } from '@/domain/impls/database/IndexedDB'
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
import { createElement } from '@/utils'
import { AlertCircleIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default defineContentScript({
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  matches: ['https://*/*'],
  excludeMatches: ['*://localhost/*', '*://127.0.0.1/*', '*://*.csdn.net/*', '*://*.csdn.com/*'],
  async main(ctx) {
    // Attach to the shared Runtime before igniting any domain: the background
    // coordinator creates the host single-flight; pages own no WebRTC state.
    window.addEventListener('beforeunload', detachClient, { once: true })
    try {
      if (!(await initClient())) return
    } catch (error) {
      console.error(
        '%c[WebChat]%c Shared runtime unavailable:',
        'color: #10b981; font-weight: bold;',
        'color: inherit;',
        error
      )
      const unavailableUi = await createShadowRootUi(ctx, {
        name: `${__NAME__}-runtime-unavailable`,
        position: 'inline',
        anchor: 'body',
        append: 'last',
        mode: 'open',
        onMount: (container) => {
          const app = createElement('<div id="runtime-unavailable"></div>')
          container.append(app)
          const root = createRoot(app)
          root.render(
            <div
              role="alert"
              className="z-infinity fixed right-4 bottom-4 flex items-center gap-2 rounded-md border border-red-300 bg-white p-2 text-sm text-red-700 shadow-lg dark:border-red-800 dark:bg-slate-950 dark:text-red-300"
            >
              <AlertCircleIcon className="size-4" />
              <span>WebChat unavailable</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Retry"
                aria-label="Retry"
                onClick={() => location.reload()}
              >
                <RefreshCwIcon className="size-4" />
              </Button>
            </div>
          )
          return root
        },
        onRemove: (root) => root?.unmount()
      })
      unavailableUi.mount()
      return
    }

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
        root.render(
          <React.StrictMode>
            <RemeshRoot store={store}>
              <RemeshScope domains={[NotificationDomain()]}>
                <App />
              </RemeshScope>
            </RemeshRoot>
          </React.StrictMode>
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
