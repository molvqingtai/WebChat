import React from 'react'
import App from './App'
import createShadowRoot from './createShadowRoot'
import style from './index.css?inline'
import { RemeshRoot } from 'remesh-react'
import { RemeshLogger } from 'remesh-logger'
import { Remesh } from 'remesh'

void (async () => {
  const store = Remesh.store({
    inspectors: [RemeshLogger()]
  })

  createShadowRoot(__NAME__, {
    style: __DEV__ ? '' : style,
    mode: __DEV__ ? 'open' : 'closed'
  }).render(
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
    const shadowRoot = document.querySelector(__NAME__)!.shadowRoot!
    shadowRoot.insertBefore(styleElement, shadowRoot.firstChild)
  }
})()
