import type { Notification as NotificationExternType } from '@/domain/externs/Notification'
import type { ProjectedTextMessage } from '@/domain/Message'
import { browser, type Browser } from '#imports'
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

type BrowserWindow = Browser.windows.Window
type BrowserTab = Browser.tabs.Tab

const matchingTabs = (window: BrowserWindow, origin: string) =>
  (window.tabs ?? []).filter((tab) => tab.id !== undefined && getOrigin(tab.url) === origin)

const rightmostMatchingTab = (window: BrowserWindow, origin: string) =>
  matchingTabs(window, origin).reduce<BrowserTab | null>(
    (selected, tab) => (selected === null || tab.index > selected.index ? tab : selected),
    null
  )

const mostRecentlyAccessedMatch = (windows: BrowserWindow[], origin: string) => {
  let selected: BrowserTab | null = null
  for (const window of windows) {
    for (const tab of matchingTabs(window, origin)) {
      if (typeof tab.lastAccessed !== 'number' || !Number.isFinite(tab.lastAccessed)) continue
      if (selected === null || tab.lastAccessed > selected.lastAccessed!) selected = tab
    }
  }
  return selected
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
          return
        }
      }
    })

    browser.notifications.onClicked.addListener(async (id) => {
      const fromTab = this.historyNotificationTabs.get(id)
      const origin = getOrigin(fromTab?.url)
      if (origin === null) return

      try {
        const windows = await browser.windows.getAll({ populate: true })
        const focusedWindow = windows.find((window) => window.focused)
        const focusedMatch = focusedWindow ? rightmostMatchingTab(focusedWindow, origin) : null
        const selected =
          focusedMatch ??
          mostRecentlyAccessedMatch(
            windows.filter((window) => window !== focusedWindow),
            origin
          )
        if (selected?.id === undefined) return

        await browser.tabs.update(selected.id, { active: true })
        if (!focusedMatch) await browser.windows.update(selected.windowId, { focused: true })
      } catch {
        return
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
