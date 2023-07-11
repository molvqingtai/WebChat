// use a separate file from index.ts to keep the diff as simple as possible
import React from 'react'
import type { Root } from 'react-dom/client'

import App from './pages/App'

export const renderApp = ({ root, frameUrl }: { root: Root; frameUrl: string }) => {
  return root.render(
    <React.StrictMode>
      <App frameUrl={frameUrl} />
    </React.StrictMode>
  )
}
