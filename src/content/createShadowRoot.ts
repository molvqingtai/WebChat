import createElement from '@/utils'
import { type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

export interface RootOptions {
  name: string
  mode?: ShadowRootMode
  css?: string
}

const createShadowRoot = (options: RootOptions): Root => {
  const { name, mode = 'open', css = '' } = options
  const shadowRoot = createElement(`<${name}></${name}>`)
  const appStyle = createElement(`<style type="text/css">${css}</style>`)
  const appRoot = createElement(`<div id="app"></div>`)
  const reactRoot = createRoot(appRoot)

  class WebChat extends HTMLElement {
    constructor() {
      super()
      const shadow = this.attachShadow({ mode })
      shadow.append(appStyle, appRoot)
    }
  }

  return {
    ...reactRoot,
    render: (children: ReactNode) => {
      customElements.define(name, WebChat)
      document.body.appendChild(shadowRoot)
      reactRoot.render(children)
    }
  }
}

export default createShadowRoot
