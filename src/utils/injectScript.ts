import { type PublicPath, browser } from 'wxt/browser'
import createElement from './createElement'

const injectScript = async (path: PublicPath) => {
  const src = browser.runtime.getURL(path)
  const script = createElement<HTMLScriptElement>(`<script src="${src}"></script>`)
  script.async = false
  script.defer = false
  document.documentElement.appendChild(script)
  document.documentElement.removeChild(script)
  return await new Promise<Event>((resolve, reject) => {
    script.onload = resolve
    script.onerror = reject
  })
}

export default injectScript
