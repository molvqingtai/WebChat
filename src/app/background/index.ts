import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/sandbox'

export default defineBackground({
  // Set manifest options
  persistent: true,
  type: 'module',

  main() {
    browser.runtime.onMessage.addListener(async () => {
      browser.runtime.openOptionsPage()
    })
  }
})
