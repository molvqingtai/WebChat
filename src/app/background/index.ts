import { EVENT } from '@/constants/event'
import { messenger } from '@/messenger'
import { browser, Tabs } from 'wxt/browser'
import { defineBackground } from 'wxt/sandbox'

export default defineBackground({
  type: 'module',
  main() {
    browser.action.onClicked.addListener(() => {
      browser.runtime.openOptionsPage()
    })

    const historyNotificationTabs = new Map<string, Tabs.Tab>()
    messenger.onMessage(EVENT.OPTIONS_PAGE_OPEN, () => {
      browser.runtime.openOptionsPage()
    })

    messenger.onMessage(EVENT.NOTIFICATION_PUSH, async ({ data: message, sender }) => {
      // Check if there is an active tab on the same site
      const tabs = await browser.tabs.query({ active: true })
      const hasActiveSomeSiteTab = tabs.some((tab) => {
        return new URL(tab.url!).origin === new URL(sender.tab!.url!).origin
      })

      console.log('sender', sender)

      if (hasActiveSomeSiteTab) return

      browser.notifications.create(message.id, {
        type: 'basic',
        iconUrl: message.userAvatar,
        title: message.username,
        message: message.body,
        contextMessage: sender.tab!.url!
      })
      historyNotificationTabs.set(message.id, sender.tab!)
    })
    messenger.onMessage(EVENT.NOTIFICATION_CLEAR, async ({ data: id }) => {
      browser.notifications.clear(id)
    })

    browser.notifications.onButtonClicked.addListener(async (id) => {
      const fromTab = historyNotificationTabs.get(id)
      if (fromTab?.id) {
        try {
          const tab = await browser.tabs.get(fromTab.id)
          browser.tabs.update(tab.id, { active: true, highlighted: true })
          browser.windows.update(tab.windowId!, { focused: true })
        } catch {
          browser.tabs.create({ url: fromTab.url })
        }
      }
    })

    browser.notifications.onClicked.addListener(async (id) => {
      const fromTab = historyNotificationTabs.get(id)
      if (fromTab?.id) {
        try {
          const tab = await browser.tabs.get(fromTab.id)
          browser.tabs.update(tab.id, { active: true })
        } catch {
          browser.tabs.create({ url: fromTab.url })
        }
      }
    })

    browser.notifications.onClosed.addListener(async (id) => {
      historyNotificationTabs.delete(id)
    })
  }
})
