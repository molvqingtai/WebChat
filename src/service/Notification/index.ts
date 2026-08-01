import type { Notification as NotificationExternType } from '@/domain/externs/Notification'
import type { ProjectedTextMessage } from '@/domain/Message'
import { browser } from '#imports'
import type { MessageTab } from '@/service/adapter/runtime'

const getOrigin = (url?: string) => {
  if (!url) return null
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

const getCurrentTabOrigin = async () => {
  try {
    const currentWindow = await browser.windows.getLastFocused({ populate: true })
    if (!currentWindow.focused) return null
    const currentTab = currentWindow.tabs?.find((tab) => tab.active && tab.highlighted)
    return getOrigin(currentTab?.url)
  } catch {
    return null
  }
}

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
  async push(message: ProjectedTextMessage & { meta?: { tab?: MessageTab } }) {
    const messageTab = message.meta?.tab
    const messageOrigin = getOrigin(messageTab?.url)
    const currentTabOrigin = await getCurrentTabOrigin()

    if (messageOrigin !== null && messageOrigin === currentTabOrigin) return

    const id = await browser.notifications.create({
      type: 'basic',
      iconUrl: message.author.avatar,
      title: message.author.name,
      message: message.body,
      contextMessage: messageTab?.url
    })
    if (messageTab) this.historyNotificationTabs.set(id, messageTab)
  }
}
