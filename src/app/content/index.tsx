import React from 'react'
import { createRoot } from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot, RemeshScope } from 'remesh-react'
// import { RemeshLogger } from 'remesh-logger'
import { defineContentScript, createShadowRootUi } from '#imports'

import App from './App'
import { LocalStorageImpl, IndexDBStorageImpl, BrowserSyncStorageImpl, indexDBStorage } from '@/domain/impls/Storage'
import { DanmakuImpl } from '@/domain/impls/Danmaku'
import { NotificationImpl } from '@/domain/impls/Notification'
import { ToastImpl } from '@/domain/impls/Toast'
import { ChatRoomImpl } from '@/domain/impls/ChatRoom'
import { WorldRoomImpl } from '@/domain/impls/WorldRoom'
// Remove import after merging: https://github.com/emilkowalski/sonner/pull/508
import 'sonner/dist/styles.css'
import '@/assets/styles/tailwind.css'
import '@/assets/styles/overlay.css'
import NotificationDomain from '@/domain/Notification'
import { createElement } from '@/utils'
import { version } from '@/../package.json'
import { VERSION_STORAGE_KEY } from '@/constants/config'

export default defineContentScript({
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  matches: ['https://*/*'],
  excludeMatches: ['*://localhost/*', '*://127.0.0.1/*', '*://*.csdn.net/*', '*://*.csdn.com/*'],
  async main(ctx) {
    // Check version and clear IndexDB if updated
    const storedVersion = await indexDBStorage.getItem<string>(VERSION_STORAGE_KEY)
    if (storedVersion !== version) {
      try {
        if (storedVersion) {
          await indexDBStorage.clear()
          console.log(
            `%c[WebChat]%c IndexDB cleared due to version update: ${storedVersion} -> ${version}`,
            'color: #10b981; font-weight: bold;',
            'color: inherit;'
          )
        }
        await indexDBStorage.setItem(VERSION_STORAGE_KEY, version)
      } catch (error) {
        console.error(
          '%c[WebChat]%c Failed to clear IndexDB on update:',
          'color: #10b981; font-weight: bold;',
          'color: inherit;',
          error
        )
      }
    }

    const store = Remesh.store({
      externs: [
        LocalStorageImpl,
        IndexDBStorageImpl,
        BrowserSyncStorageImpl,
        ChatRoomImpl,
        WorldRoomImpl,
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
