import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_STATUS_STORAGE_KEY, STORAGE_NAME } from '@/constants/config'
import { CONFIG_STORE_VERSION_KEY } from '@/constants/storage'
import { installTestWebLocks } from '@/utils/serializedPreparation.test-utils'
import { createTestLocalStorage } from '@/utils/storage.test-utils'

vi.mock('#imports', () => ({
  browser: {
    storage: {
      sync: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
      }
    }
  }
}))

beforeEach(() => {
  installTestWebLocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const loadLocalPreparationRealm = async (origin: string, localStorage: Storage) => {
  vi.stubGlobal('window', { localStorage })
  vi.stubGlobal('location', { origin })
  vi.resetModules()
  return (await import('./Storage')).prepareLocalConfigurationStorage
}

describe('origin-local configuration preparation', () => {
  it('preserves host keys and applies baseline, same-version, and mismatch rules only to the WebChat namespace', async () => {
    const localStorage = createTestLocalStorage()
    vi.stubGlobal('window', { localStorage })
    vi.stubGlobal('location', { origin: 'https://storage.test' })
    const { prepareLocalConfigurationStorage } = await import('./Storage')
    const statusKey = `${STORAGE_NAME}:${APP_STATUS_STORAGE_KEY}`
    const versionKey = `${STORAGE_NAME}:${CONFIG_STORE_VERSION_KEY}`
    localStorage.setItem('HOST_PAGE_KEY', 'preserved')
    localStorage.setItem(statusKey, '{"open":true}')

    await prepareLocalConfigurationStorage()
    expect(localStorage.getItem(statusKey)).toBe('{"open":true}')
    expect(localStorage.getItem(versionKey)).toBe('1')

    localStorage.setItem(statusKey, '{"open":false}')
    await prepareLocalConfigurationStorage()
    expect(localStorage.getItem(statusKey)).toBe('{"open":false}')

    localStorage.setItem(versionKey, '7')
    await prepareLocalConfigurationStorage()
    expect(localStorage.getItem(statusKey)).toBeNull()
    expect(localStorage.getItem(versionKey)).toBe('1')
    expect(localStorage.getItem('HOST_PAGE_KEY')).toBe('preserved')
  })

  it('serializes independent local-adapter realms before preserving target-generation writes', async () => {
    const secondGrant = deferred()
    installTestWebLocks({
      beforeGrant: (_name, request) => (request === 2 ? secondGrant.promise : undefined)
    })
    const origin = 'https://storage-cross-realm.test'
    const localStorage = createTestLocalStorage()
    const firstRealm = await loadLocalPreparationRealm(origin, localStorage)
    const secondRealm = await loadLocalPreparationRealm(origin, localStorage)
    const statusKey = `${STORAGE_NAME}:${APP_STATUS_STORAGE_KEY}`
    const versionKey = `${STORAGE_NAME}:${CONFIG_STORE_VERSION_KEY}`
    localStorage.setItem(statusKey, 'old-generation')
    localStorage.setItem(versionKey, '7')

    const first = firstRealm()
    const second = secondRealm()
    await first
    localStorage.setItem(statusKey, 'new-generation')
    secondGrant.resolve()
    await second

    expect(localStorage.getItem(statusKey)).toBe('new-generation')
    expect(localStorage.getItem(versionKey)).toBe('1')
  })
})
