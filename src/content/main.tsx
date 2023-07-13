import React from 'react'
import App from './App'
import createShadowRoot from './createShadowRoot'

import css from './main.css?inline'

void (() => {
  createShadowRoot({ name: 'web-chat', css }).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})()
