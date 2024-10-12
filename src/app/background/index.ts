import { EVENT } from '@/constants/event'
import { messenger } from '@/messenger'
import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/sandbox'

export default defineBackground({
  type: 'module',
  main() {
    messenger.onMessage(EVENT.OPTIONS_PAGE_OPEN, () => {
      browser.runtime.openOptionsPage()
    })
    messenger.onMessage(EVENT.NOTIFICATION_PUSH, async ({ data: message, sender }) => {
      // Check if there is an active tab on the same site
      const tabs = await browser.tabs.query({ active: true })
      const hasActiveSomeSiteTab = tabs.some((tab) => {
        return new URL(tab.url!).origin === new URL(sender.tab!.url!).origin
      })

      if (hasActiveSomeSiteTab) return
      browser.notifications.create(message.id, {
        type: 'basic',
        iconUrl: message.userAvatar,
        title: message.username,
        message: message.body
      })
    })
    messenger.onMessage(EVENT.NOTIFICATION_CLEAR, async ({ data: id }) => {
      browser.notifications.clear(id)
    })
  }
})
