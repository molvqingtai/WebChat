import React from 'react'
import { createRoot } from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot, RemeshScope } from 'remesh-react'
// import { RemeshLogger } from 'remesh-logger'
import { defineContentScript } from 'wxt/sandbox'
import { createShadowRootUi } from 'wxt/client'

import App from './App'
import { LocalStorageImpl, IndexDBStorageImpl, BrowserSyncStorageImpl } from '@/domain/impls/Storage'
import { DanmakuImpl } from '@/domain/impls/Danmaku'
import { NotificationImpl } from '@/domain/impls/Notification'
import { ToastImpl } from '@/domain/impls/Toast'
// import { PeerRoomImpl } from '@/domain/impls/PeerRoom'
import { PeerRoomImpl } from '@/domain/impls/PeerRoom2'
import '@/assets/styles/tailwind.css'
import '@/assets/styles/sonner.css'
import NotificationDomain from '@/domain/Notification'
import { createElement } from '@/utils'

export default defineContentScript({
  cssInjectionMode: 'ui',
  runAt: 'document_end',
  matches: ['https://*/*'],
  excludeMatches: ['*://localhost/*', '*://127.0.0.1/*', '*://*.csdn.net/*', '*://*.csdn.com/*'],
  async main(ctx) {
    window.CSS.registerProperty({
      name: '--shimmer-angle',
      syntax: '<angle>',
      inherits: false,
      initialValue: '0deg'
    })

    const store = Remesh.store({
      externs: [
        LocalStorageImpl,
        IndexDBStorageImpl,
        BrowserSyncStorageImpl,
        PeerRoomImpl,
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
