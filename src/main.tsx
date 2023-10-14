import React from 'react'
import { RemeshRoot } from 'remesh-react'
import { RemeshLogger } from 'remesh-logger'
import { Remesh } from 'remesh'
import App from './App'
import createShadowRoot from './createShadowRoot'
import StorageImpl from './impl/Storage'
import style from './index.css?inline'

const store = Remesh.store({
  externs: [StorageImpl],
  inspectors: [RemeshLogger()]
})

const root = createShadowRoot(__NAME__, {
  style: __DEV__ ? '' : style,
  mode: __DEV__ ? 'open' : 'closed'
})
root.render(
  <React.StrictMode>
    <RemeshRoot store={store}>
      <App />
    </RemeshRoot>
  </React.StrictMode>
)

// HMR Hack
// https://github.com/crxjs/chrome-extension-tools/issues/600
if (__DEV__) {
  await import('./index.css')
  const styleElement = document.querySelector('[data-vite-dev-id]')!

  root.shadowRoot.insertBefore(styleElement, root.shadowRoot.firstChild)
}
