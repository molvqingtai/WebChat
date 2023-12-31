import React from 'react'
import ReactDOM from 'react-dom/client'
import { Remesh } from 'remesh'
import { RemeshRoot } from 'remesh-react'
import { RemeshLogger } from 'remesh-logger'
import App from './App'
import { StorageBrowserSyncImpl } from '@/impl/Storage'
import '@/assets/styles/tailwind.css'

const store = Remesh.store({
  externs: [StorageBrowserSyncImpl],
  inspectors: [RemeshLogger()]
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RemeshRoot store={store}>
      <App />
    </RemeshRoot>
  </React.StrictMode>
)
