import { type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from '@/utils'

export interface RootOptions {
  mode?: ShadowRootMode
  style?: string
  script?: string
  element?: Element
}

const createShadowRoot = (
  name: string,
  options: RootOptions
): Root & { shadowHost: Element; shadowRoot: ShadowRoot; appRoot: Element } => {
  const { mode = 'open', style = '', script = '', element = '' } = options ?? {}
  const shadowHost = createElement(`<${name}></${name}>`)
  const shadowRoot = shadowHost.attachShadow({ mode })
  const appRoot = createElement(`<div id="app"></div>`)
  const appStyle = style && createElement(`<style type="text/css">${style}</style>`)
  const appScript = script && createElement(`<script type="application/javascript">${script}</script>`)
  const reactRoot = createRoot(appRoot)

  shadowRoot.append(appStyle, appRoot, appScript, element)

  return {
    shadowHost,
    shadowRoot,
    appRoot,
    render: (children: ReactNode) => {
      document.body.appendChild(shadowHost)
      return reactRoot.render(children)
    },
    unmount: () => {
      reactRoot.unmount()
      shadowHost.remove()
    }
  }
}

export default createShadowRoot
