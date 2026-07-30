import { describe, expect, it, vi } from 'vitest'
import { CONFIG_STORE_VERSION, CONFIG_STORE_VERSION_KEY } from '@/constants/storage'

vi.mock('#imports', () => ({
  browser: { runtime: {}, storage: { sync: {} } }
}))

import { registerBrowserSyncStoragePreparation, requestBrowserSyncStoragePreparation } from './StoragePreparation'

let runtimeId = 0

const createFixture = (initial: Record<string, unknown>) => {
  const values = { ...initial }
  const installedListeners: Array<() => Promise<void>> = []
  const messageListeners: Array<(message: unknown) => Promise<{ readonly ready: boolean }> | undefined> = []
  const storage = {
    get: vi.fn(async (key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? { [key]: values[key] } : {}
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, items)
    }),
    clear: vi.fn(async () => {
      Object.keys(values).forEach((key) => delete values[key])
    })
  }
  const runtime = {
    id: `runtime-${runtimeId++}`,
    onInstalled: {
      addListener: vi.fn((listener: () => Promise<void>) => installedListeners.push(listener))
    },
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => Promise<{ readonly ready: boolean }> | undefined) =>
        messageListeners.push(listener)
      )
    },
    sendMessage: vi.fn(async (message: unknown) => {
      for (const listener of messageListeners) {
        const response = listener(message)
        if (response) return response
      }
      return undefined
    })
  }
  return { values, installedListeners, messageListeners, runtime, storage }
}

describe('browser sync configuration preparation', () => {
  it('awaits onInstalled while establishing a non-destructive baseline', async () => {
    const fixture = createFixture({ user: 'preserved' })
    registerBrowserSyncStoragePreparation(fixture.runtime, fixture.storage)

    expect(fixture.installedListeners).toHaveLength(1)
    const installation = fixture.installedListeners[0]()
    expect(fixture.storage.set).not.toHaveBeenCalled()
    await installation

    expect(fixture.storage.clear).not.toHaveBeenCalled()
    expect(fixture.values.user).toBe('preserved')
    expect(fixture.values[CONFIG_STORE_VERSION_KEY]).toBe(CONFIG_STORE_VERSION)
  })

  it('uses the content request as an awaited fallback and preserves later same-version updates', async () => {
    const fixture = createFixture({ [CONFIG_STORE_VERSION_KEY]: 2, user: 'old-generation' })
    registerBrowserSyncStoragePreparation(fixture.runtime, fixture.storage)

    await requestBrowserSyncStoragePreparation(fixture.runtime)
    expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
    expect(fixture.values).toEqual({ [CONFIG_STORE_VERSION_KEY]: CONFIG_STORE_VERSION })

    fixture.values.user = 'new-generation'
    await fixture.installedListeners[0]()
    expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
    expect(fixture.values.user).toBe('new-generation')
  })

  it('returns non-ready after a console-only failure without advancing the marker', async () => {
    const fixture = createFixture({ [CONFIG_STORE_VERSION_KEY]: 2, user: 'private-value' })
    fixture.storage.clear.mockRejectedValueOnce(new Error('private failure'))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerBrowserSyncStoragePreparation(fixture.runtime, fixture.storage)

    await expect(requestBrowserSyncStoragePreparation(fixture.runtime)).rejects.toThrow(
      'Browser sync configuration preparation failed'
    )

    expect(fixture.values[CONFIG_STORE_VERSION_KEY]).toBe(2)
    expect(fixture.values.user).toBe('private-value')
    expect(diagnostic).toHaveBeenCalledTimes(1)
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Configuration store preparation failed')
    diagnostic.mockRestore()
  })

  it('ignores unrelated extension messages', async () => {
    const fixture = createFixture({ [CONFIG_STORE_VERSION_KEY]: CONFIG_STORE_VERSION })
    registerBrowserSyncStoragePreparation(fixture.runtime, fixture.storage)

    await expect(fixture.messageListeners[0]({ type: 'unrelated' })).toBeUndefined()
    expect(fixture.storage.get).not.toHaveBeenCalled()
  })
})
