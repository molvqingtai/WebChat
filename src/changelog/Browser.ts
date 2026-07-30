import type { WxtBrowser } from 'wxt/browser'
import { CHANGELOG_ACKNOWLEDGEMENT, CHANGELOG_PAGE_PATH, CHANGELOG_STATE_KEY } from '@/constants/changelog'
import {
  ChangelogCoordinator,
  isExtensionVersion,
  type ChangelogInstallRuntime,
  type ChangelogStateStore,
  type ChangelogTab,
  type ChangelogTabs
} from './Coordinator'

type ChangelogBrowser = Pick<WxtBrowser, 'runtime' | 'storage' | 'tabs' | 'windows'>

interface ChangelogAcknowledgement {
  type: typeof CHANGELOG_ACKNOWLEDGEMENT
  version: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isAcknowledgement = (value: unknown): value is ChangelogAcknowledgement =>
  isRecord(value) && value.type === CHANGELOG_ACKNOWLEDGEMENT && isExtensionVersion(value.version)

const createStore = (browser: ChangelogBrowser): ChangelogStateStore => ({
  async read() {
    const stored = await browser.storage.local.get(CHANGELOG_STATE_KEY)
    return stored[CHANGELOG_STATE_KEY]
  },
  async write(state) {
    await browser.storage.local.set({ [CHANGELOG_STATE_KEY]: state })
  }
})

const createTabs = (browser: ChangelogBrowser, pageUrl: string): ChangelogTabs => ({
  async find() {
    const tabs = await browser.tabs.query({})
    const tab = tabs.find((candidate) => candidate.url === pageUrl && typeof candidate.id === 'number')
    if (!tab || typeof tab.id !== 'number') return undefined
    return { id: tab.id, ...(typeof tab.windowId === 'number' ? { windowId: tab.windowId } : {}) }
  },
  async focus(tab: ChangelogTab) {
    if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true })
    await browser.tabs.update(tab.id, { active: true })
  },
  async create() {
    await browser.tabs.create({ url: pageUrl, active: true })
  }
})

const createInstallRuntime = (browser: ChangelogBrowser): ChangelogInstallRuntime => ({
  onInstalled: {
    addListener(listener) {
      browser.runtime.onInstalled.addListener((details) =>
        listener({
          reason: details.reason,
          ...(details.previousVersion ? { previousVersion: details.previousVersion } : {})
        })
      )
    }
  }
})

export const registerChangelogLifecycle = (browser: ChangelogBrowser) => {
  const pageUrl = browser.runtime.getURL(CHANGELOG_PAGE_PATH)
  const coordinator = new ChangelogCoordinator({
    currentVersion: () => browser.runtime.getManifest().version,
    store: createStore(browser),
    tabs: createTabs(browser, pageUrl),
    log: (message) => console.error(message)
  })

  const startup = coordinator.start(createInstallRuntime(browser))
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.url !== pageUrl || !isAcknowledgement(message)) return undefined
    const currentVersion = browser.runtime.getManifest().version
    if (message.version !== currentVersion || !isExtensionVersion(currentVersion)) return undefined
    return coordinator.acknowledge(currentVersion)
  })
  void startup

  return coordinator
}

export const acknowledgeCurrentChangelog = async (browser: Pick<WxtBrowser, 'runtime'>) => {
  try {
    await browser.runtime.sendMessage({
      type: CHANGELOG_ACKNOWLEDGEMENT,
      version: browser.runtime.getManifest().version
    } satisfies ChangelogAcknowledgement)
  } catch {
    console.error('Changelog acknowledgement failed')
  }
}
