import React from 'react'
import App from './App'
import createShadowRoot from './createShadowRoot'
import style from './index.css?inline'

void (async () => {
  createShadowRoot(__NAME__, {
    style: __DEV__ ? '' : style,
    mode: __DEV__ ? 'open' : 'closed'
  }).render(
    <React.StrictMode>
      <App />
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
