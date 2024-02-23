import React from 'react'
import { createRoot } from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot } from 'remesh-react'
import { RemeshLogger } from 'remesh-logger'
import { defineContentScript } from 'wxt/sandbox'
import { createShadowRootUi } from 'wxt/client'

import App from './App'
import { IndexDBStorageImpl, BrowserSyncStorageImpl } from '@/impl/Storage'
import { PeerClientImpl } from '@/impl/PeerClient'
import '@/assets/styles/tailwind.css'

export default defineContentScript({
  cssInjectionMode: 'ui',
  matches: ['*://*.example.com/*', '*://*.google.com/*', '*://*.v2ex.com/*'],
  async main(ctx) {
    const store = Remesh.store({
      externs: [IndexDBStorageImpl, BrowserSyncStorageImpl, PeerClientImpl],
      inspectors: [RemeshLogger()]
    })

    const ui = await createShadowRootUi(ctx, {
      name: __NAME__,
      position: 'inline',
      // anchor: 'body',
      // append: 'first',
      onMount: (container) => {
        const app = document.createElement('div')
        app.id = 'app'
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
