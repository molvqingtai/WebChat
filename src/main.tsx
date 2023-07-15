import React from 'react'
import App from './App'
import createShadowRoot from './createShadowRoot'
import style from './index.css?inline'

// TODO: css hmr not work
// https://github.com/crxjs/chrome-extension-tools/issues/671
void (() => {
  createShadowRoot(__NAME__, {
    style,
    mode: __DEV__ ? 'open' : 'closed'
  }).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})()
