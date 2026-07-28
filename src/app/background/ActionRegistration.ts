import type { WxtBrowser } from 'wxt/browser'

type ActionBrowser = Pick<WxtBrowser, 'action' | 'browserAction'>

export const registerActionClick = (browser: ActionBrowser, openOptionsPage: () => Promise<void>) => {
  const namespaceName = import.meta.env.FIREFOX ? 'browserAction' : 'action'
  const namespace = browser[namespaceName]

  if (!namespace) throw new Error(`browser.${namespaceName} is unavailable`)
  if (!namespace.onClicked || typeof namespace.onClicked.addListener !== 'function') {
    throw new Error(`browser.${namespaceName}.onClicked.addListener is unavailable`)
  }

  namespace.onClicked.addListener(() => openOptionsPage())
}
