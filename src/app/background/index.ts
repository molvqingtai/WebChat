import { EVENT } from '@/constants/event'
import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/sandbox'

export default defineBackground({
  // Set manifest options
  persistent: true,
  type: 'module',

  main() {
    browser.runtime.onMessage.addListener(async (event: EVENT) => {
      if (event === EVENT.OPTIONS_PAGE_OPEN) {
        browser.runtime.openOptionsPage()
      }
    })
  }
})
