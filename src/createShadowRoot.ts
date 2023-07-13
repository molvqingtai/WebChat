import { createElement } from '@/utils'
import { type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

export interface RootOptions {
  mode?: ShadowRootMode
  style?: string
  script?: string
}

const createShadowRoot = (name: string, options: RootOptions): Root => {
  const { mode = 'open', style = '', script = '' } = options ?? {}
  const shadowApp = createElement(`<${name}></${name}>`)
  const shadowRoot = shadowApp.attachShadow({ mode })
  const appRoot = createElement(`<div id="app"></div>`)
  const appStyle = style && createElement(`<style type="text/css">${style}</style>`)
  const appScript = script && createElement(`<script type="application/javascript">${script}</script>`)
  const reactRoot = createRoot(appRoot)

  shadowRoot.append(appStyle, appRoot, appScript)

  return {
    ...reactRoot,
    render: (children: ReactNode) => {
      document.body.appendChild(shadowApp)
      reactRoot.render(children)
    }
  }
}

export default createShadowRoot
