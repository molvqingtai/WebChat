import React from 'react'
import ReactDOM from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot } from 'remesh-react'
import App from './App'
import { BrowserSyncStorageImpl } from '@/domain/impls/Storage'
import '@/assets/styles/tailwind.css'

import { ToastImpl } from '@/domain/impls/Toast'

const store = Remesh.store({
  externs: [BrowserSyncStorageImpl, ToastImpl]
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RemeshRoot store={store}>
      <App />
    </RemeshRoot>
  </React.StrictMode>
)
