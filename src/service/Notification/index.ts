import type { Notification as NotificationExternType } from '@/domain/externs/Notification'
import type { ChatRoomTextMessage } from '@/protocol'
import { browser } from '#imports'
import type { MessageTab } from '@/service/adapter/runtimeMessage'

export class Notification implements NotificationExternType {
  historyNotificationTabs = new Map<string, MessageTab>()
  constructor() {
    browser.notifications.onButtonClicked.addListener(async (id) => {
      const formTab = this.historyNotificationTabs.get(id)
      if (formTab?.id) {
        try {
          const tab = await browser.tabs.get(formTab.id)
          browser.tabs.update(tab.id!, { active: true, highlighted: true })
          browser.windows.update(tab.windowId!, { focused: true })
        } catch {
          browser.tabs.create({ url: formTab.url })
        }
      }
    })

    browser.notifications.onClicked.addListener(async (id) => {
      const fromTab = this.historyNotificationTabs.get(id)
      if (fromTab?.id) {
        try {
          const tab = await browser.tabs.get(fromTab.id)
          browser.tabs.update(tab.id!, { active: true })
        } catch {
          browser.tabs.create({ url: fromTab.url })
        }
      }
    })
    browser.notifications.onClosed.addListener(async (id) => {
      this.historyNotificationTabs.delete(id)
    })
  }
  async push(message: ChatRoomTextMessage & { meta?: { tab?: MessageTab } }) {
    const messageTab = message.meta?.tab
    const tabs = await browser.tabs.query({ active: true })
    const hasActiveSameSiteTab =
      messageTab?.url &&
      tabs.some((tab) => {
        return tab.url && new URL(messageTab.url!).origin === new URL(tab.url).origin
      })

    if (hasActiveSameSiteTab) return

    const id = await browser.notifications.create({
      type: 'basic',
      iconUrl: message.sender.avatar,
      title: message.sender.name,
      message: message.body,
      contextMessage: messageTab?.url
    })
    messageTab && this.historyNotificationTabs.set(id, messageTab)
  }
}
