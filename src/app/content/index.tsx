import ReactDOM from 'react-dom/client'
import React from 'react'
import { Remesh } from 'remesh'
import { RemeshRoot } from 'remesh-react'
import { RemeshLogger } from 'remesh-logger'
import App from './App'
import StorageImpl from '@/impl/Storage'
import '@/assets/styles/tailwind.css'

export default defineContentScript({
  cssInjectionMode: 'ui',
  matches: ['*://*.example.com/*', '*://*.google.com/*', '*://*.v2ex.com/*'],
  async main(ctx) {
    const store = Remesh.store({
      externs: [StorageImpl]
      // inspectors: [RemeshLogger()]
    })

    const ui = await createContentScriptUi(ctx, {
      name: __NAME__,
      type: 'overlay',
      mount(container) {
        const root = ReactDOM.createRoot(container)
        root.render(
          <React.StrictMode>
            <RemeshRoot store={store}>
              <App />
            </RemeshRoot>
          </React.StrictMode>
        )
        return root
      },
      onRemove(root) {
        root.unmount()
      }
    })
    ui.mount()
  }
})
