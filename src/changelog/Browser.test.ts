import { describe, expect, it, vi } from 'vitest'
import { CHANGELOG_ACKNOWLEDGEMENT, CHANGELOG_PAGE_PATH, CHANGELOG_STATE_KEY } from '@/constants/changelog'
import { acknowledgeCurrentChangelog, registerChangelogLifecycle } from './Browser'

const VERSION = '2.0.1'

type ChangelogBrowser = Parameters<typeof registerChangelogLifecycle>[0]
type InstalledListener = Parameters<ChangelogBrowser['runtime']['onInstalled']['addListener']>[0]
type MessageListener = Parameters<ChangelogBrowser['runtime']['onMessage']['addListener']>[0]

const createBrowser = () => {
  let installedListener: InstalledListener | undefined
  let messageListener: MessageListener | undefined
  const storage: Record<string, unknown> = {}
  const tabs: Array<{ id: number; url: string; windowId: number }> = []
  const sendMessage = vi.fn(async () => undefined)
  const set = vi.fn(async (entries: Record<string, unknown>) => Object.assign(storage, entries))
  const create = vi.fn(async ({ url }: { url?: string }) => {
    tabs.push({ id: tabs.length + 1, url: url ?? '', windowId: 1 })
  })

  const browser = {
    runtime: {
      getURL: vi.fn((path: string) => `moz-extension://webchat${path}`),
      getManifest: vi.fn(() => ({ version: VERSION })),
      onInstalled: {
        addListener: vi.fn((listener: InstalledListener) => (installedListener = listener))
      },
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => (messageListener = listener))
      },
      sendMessage
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set
      }
    },
    tabs: {
      query: vi.fn(async () => tabs),
      update: vi.fn(async () => undefined),
      create
    },
    windows: {
      update: vi.fn(async () => undefined)
    }
  } as unknown as ChangelogBrowser

  return {
    browser,
    storage,
    tabs,
    sendMessage,
    set,
    emitInstalled(details: { reason: string; previousVersion?: string }) {
      if (!installedListener) throw new Error('Install listener was not registered')
      Reflect.apply(installedListener, undefined, [details])
    },
    emitMessage(message: unknown, sender: Parameters<MessageListener>[1] = {}) {
      if (!messageListener) throw new Error('Message listener was not registered')
      return Reflect.apply(messageListener, undefined, [message, sender, vi.fn()])
    }
  }
}

describe('browser changelog lifecycle', () => {
  it('registers both listeners synchronously and preserves an update delivered after startup begins', async () => {
    const fixture = createBrowser()

    const coordinator = registerChangelogLifecycle(fixture.browser)

    expect(fixture.browser.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1)
    expect(fixture.browser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
    expect(fixture.browser.runtime.getURL).toHaveBeenCalledWith(CHANGELOG_PAGE_PATH)

    fixture.emitInstalled({ reason: 'update', previousVersion: '2.0.0' })
    await coordinator.reconcile()

    expect(fixture.storage[CHANGELOG_STATE_KEY]).toEqual({
      observedVersion: VERSION,
      pendingVersion: VERSION,
      shownVersions: []
    })
    expect(fixture.tabs).toHaveLength(1)
    expect(fixture.tabs[0]?.url).toBe(`moz-extension://webchat${CHANGELOG_PAGE_PATH}`)
  })

  it('accepts acknowledgement only from the exact Changelog page for the installed version', async () => {
    const fixture = createBrowser()
    fixture.storage[CHANGELOG_STATE_KEY] = {
      observedVersion: VERSION,
      pendingVersion: VERSION,
      shownVersions: []
    }
    const coordinator = registerChangelogLifecycle(fixture.browser)
    await coordinator.reconcile()
    fixture.set.mockClear()
    vi.mocked(fixture.browser.runtime.getManifest).mockClear()
    const changelogSender = { url: `moz-extension://webchat${CHANGELOG_PAGE_PATH}` }

    await fixture.emitMessage({ type: 'unrelated', version: VERSION }, changelogSender)
    expect(fixture.set).not.toHaveBeenCalled()

    await fixture.emitMessage({ type: CHANGELOG_ACKNOWLEDGEMENT, version: VERSION }, {})
    await fixture.emitMessage(
      { type: CHANGELOG_ACKNOWLEDGEMENT, version: VERSION },
      { url: `${changelogSender.url}?forged` }
    )
    await fixture.emitMessage({ type: CHANGELOG_ACKNOWLEDGEMENT, version: '2.0.0' }, changelogSender)
    expect(fixture.set).not.toHaveBeenCalled()

    await fixture.emitMessage({ type: CHANGELOG_ACKNOWLEDGEMENT, version: VERSION }, changelogSender)

    expect(fixture.storage[CHANGELOG_STATE_KEY]).toEqual({
      observedVersion: VERSION,
      shownVersions: [VERSION]
    })
    expect(fixture.set).toHaveBeenCalledTimes(1)
    expect(fixture.browser.runtime.getManifest).toHaveBeenCalledTimes(2)
  })

  it('sends the rendered manifest version through the background acknowledgement boundary', async () => {
    const fixture = createBrowser()

    await acknowledgeCurrentChangelog(fixture.browser)

    expect(fixture.sendMessage).toHaveBeenCalledWith({
      type: CHANGELOG_ACKNOWLEDGEMENT,
      version: VERSION
    })
  })
})
