import React from 'react'
import { createRoot } from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot } from 'remesh-react'
import { RemeshLogger } from 'remesh-logger'
import { defineContentScript } from 'wxt/sandbox'
import { createShadowRootUi } from 'wxt/client'

import App from './App'
import { IndexDBStorageImpl, BrowserSyncStorageImpl } from '@/domain/impls/Storage'
import { PeerRoomImpl } from '@/domain/impls/PeerRoom'
// import { PeerRoomImpl } from '@/domain/impls/PeerRoom2'
import '@/assets/styles/tailwind.css'
import { createElement } from '@/utils'
import { ToastImpl } from '@/domain/impls/Toast'

export default defineContentScript({
  cssInjectionMode: 'ui',
  matches: ['*://*.example.com/*', '*://*.v2ex.com/*'],
  async main(ctx) {
    const store = Remesh.store({
      externs: [IndexDBStorageImpl, BrowserSyncStorageImpl, PeerRoomImpl, ToastImpl],
      inspectors: __DEV__ ? [RemeshLogger()] : []
    })

    const ui = await createShadowRootUi(ctx, {
      name: __NAME__,
      position: 'inline',
      anchor: 'body',
      mode: __DEV__ ? 'open' : 'closed',
      onMount: (container) => {
        const app = createElement('<div id="app"></div>')
        container.append(app)

        const root = createRoot(app)
        root.render(
          <React.StrictMode>
            <RemeshRoot store={store}>
              <App />
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
