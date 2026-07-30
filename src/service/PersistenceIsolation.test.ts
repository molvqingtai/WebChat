import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { APP_STATUS_STORAGE_KEY, STORAGE_NAME } from '@/constants/config'
import { CONFIG_STORE_VERSION, CONFIG_STORE_VERSION_KEY } from '@/constants/storage'
import { prepareIndexedDBMessageDatabase } from '@/domain/impls/database/IndexedDB'
import { installTestWebLocks } from '@/utils/serializedPreparation.test-utils'
import { createTestLocalStorage } from '@/utils/storage.test-utils'
import { registerBrowserSyncStoragePreparation, requestBrowserSyncStoragePreparation } from './StoragePreparation'

const browserFixture = vi.hoisted(() => ({
  storage: {
    sync: {},
    local: {},
    session: {}
  } as Record<string, unknown>
}))

vi.mock('#imports', () => ({
  browser: {
    storage: browserFixture.storage
  }
}))

let fixtureId = 0
const databaseNames = new Set<string>()
const nextOrigin = (label: string) => `https://${label}-${fixtureId++}.test`
const messageDatabaseName = (origin: string) => `${STORAGE_NAME}:EVENTS_V2_CANONICAL_RECORDS:${origin}`
const localKey = (key: string) => `${STORAGE_NAME}:${key}`

const createBrowserArea = (initial: Record<string, unknown>) => {
  const values = { ...initial }
  return {
    values,
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
}

const prepareBrowserSync = async (storage?: ReturnType<typeof createBrowserArea>) => {
  const listeners: Array<(message: unknown) => Promise<{ readonly ready: boolean }> | undefined> = []
  const runtime = {
    id: `persistence-isolation-${fixtureId++}`,
    onInstalled: { addListener: vi.fn() },
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => Promise<{ readonly ready: boolean }> | undefined) =>
        listeners.push(listener)
      )
    },
    sendMessage: vi.fn(async (message: unknown) => {
      for (const listener of listeners) {
        const response = listener(message)
        if (response) return response
      }
      return undefined
    })
  }
  if (storage) registerBrowserSyncStoragePreparation(runtime, storage)
  else registerBrowserSyncStoragePreparation(runtime)
  await requestBrowserSyncStoragePreparation(runtime)
}

const loadLocalPreparation = async (origin: string, localStorage: Storage) => {
  vi.stubGlobal('window', { localStorage })
  vi.stubGlobal('location', { origin })
  vi.resetModules()
  const { prepareLocalConfigurationStorage } = await import('@/domain/impls/Storage')
  return () => {
    vi.stubGlobal('location', { origin })
    return prepareLocalConfigurationStorage()
  }
}

const seedTargetMessage = async (origin: string, value: unknown) => {
  const name = messageDatabaseName(origin)
  databaseNames.add(name)
  await prepareIndexedDBMessageDatabase(origin)
  const database = await openDB(name)
  await database.put('records', value, 'sentinel')
  database.close()
}

const readTargetMessage = async (origin: string) => {
  const database = await openDB(messageDatabaseName(origin))
  const value = await database.get('records', 'sentinel')
  database.close()
  return value
}

beforeEach(() => {
  installTestWebLocks()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(
    [...databaseNames].map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name)
          request.addEventListener('success', () => resolve(), { once: true })
          request.addEventListener('error', () => resolve(), { once: true })
          request.addEventListener('blocked', () => resolve(), { once: true })
        })
    )
  )
  databaseNames.clear()
})

describe('physical persistence isolation', () => {
  it('keeps configuration scopes and deprecated unstorage data during a message reset', async () => {
    const origin = nextOrigin('message-family')
    const localStorage = createTestLocalStorage()
    const prepareLocal = await loadLocalPreparation(origin, localStorage)
    localStorage.setItem(localKey(APP_STATUS_STORAGE_KEY), 'local-configuration')
    await prepareLocal()
    const sync = createBrowserArea({ user: 'sync-configuration' })
    await prepareBrowserSync(sync)

    const deprecatedName = 'web-chat'
    databaseNames.add(deprecatedName)
    const deprecated = await openDB(deprecatedName, 1, {
      upgrade(database) {
        database.createObjectStore(deprecatedName)
      }
    })
    await deprecated.put(deprecatedName, 'deprecated-message', `${STORAGE_NAME}::message`)
    deprecated.close()

    const name = messageDatabaseName(origin)
    databaseNames.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()

    await prepareIndexedDBMessageDatabase(origin)

    expect(localStorage.getItem(localKey(APP_STATUS_STORAGE_KEY))).toBe('local-configuration')
    expect(localStorage.getItem(localKey(CONFIG_STORE_VERSION_KEY))).toBe(String(CONFIG_STORE_VERSION))
    expect(sync.values).toEqual({ user: 'sync-configuration', [CONFIG_STORE_VERSION_KEY]: CONFIG_STORE_VERSION })
    const preservedDeprecated = await openDB(deprecatedName)
    await expect(preservedDeprecated.get(deprecatedName, `${STORAGE_NAME}::message`)).resolves.toBe(
      'deprecated-message'
    )
    preservedDeprecated.close()
  })

  it('keeps the canonical database while physical local origins reset lazily and independently', async () => {
    const currentOrigin = nextOrigin('local-current')
    const otherOrigin = nextOrigin('local-other')
    const currentStorage = createTestLocalStorage()
    const otherStorage = createTestLocalStorage()
    const prepareCurrent = await loadLocalPreparation(currentOrigin, currentStorage)
    const prepareOther = await loadLocalPreparation(otherOrigin, otherStorage)
    currentStorage.setItem('CURRENT_HOST_KEY', 'preserved')
    currentStorage.setItem(localKey(CONFIG_STORE_VERSION_KEY), '2')
    currentStorage.setItem(localKey(APP_STATUS_STORAGE_KEY), 'current-old')
    otherStorage.setItem('OTHER_HOST_KEY', 'preserved')
    otherStorage.setItem(localKey(CONFIG_STORE_VERSION_KEY), '7')
    otherStorage.setItem(localKey(APP_STATUS_STORAGE_KEY), 'other-old')
    await seedTargetMessage(currentOrigin, 'canonical-message')

    await prepareCurrent()

    expect(currentStorage.getItem(localKey(APP_STATUS_STORAGE_KEY))).toBeNull()
    expect(currentStorage.getItem(localKey(CONFIG_STORE_VERSION_KEY))).toBe(String(CONFIG_STORE_VERSION))
    expect(currentStorage.getItem('CURRENT_HOST_KEY')).toBe('preserved')
    expect(otherStorage.getItem(localKey(APP_STATUS_STORAGE_KEY))).toBe('other-old')
    expect(otherStorage.getItem(localKey(CONFIG_STORE_VERSION_KEY))).toBe('7')
    await expect(readTargetMessage(currentOrigin)).resolves.toBe('canonical-message')

    currentStorage.setItem(localKey(APP_STATUS_STORAGE_KEY), 'current-new')
    await prepareOther()

    expect(otherStorage.getItem(localKey(APP_STATUS_STORAGE_KEY))).toBeNull()
    expect(otherStorage.getItem(localKey(CONFIG_STORE_VERSION_KEY))).toBe(String(CONFIG_STORE_VERSION))
    expect(otherStorage.getItem('OTHER_HOST_KEY')).toBe('preserved')
    expect(currentStorage.getItem(localKey(APP_STATUS_STORAGE_KEY))).toBe('current-new')
    await expect(readTargetMessage(currentOrigin)).resolves.toBe('canonical-message')
  })

  it('keeps canonical, origin-local, and non-sync browser areas during a sync reset', async () => {
    const origin = nextOrigin('sync-family')
    const localStorage = createTestLocalStorage()
    const prepareLocal = await loadLocalPreparation(origin, localStorage)
    localStorage.setItem(localKey(APP_STATUS_STORAGE_KEY), 'local-current')
    await prepareLocal()
    await seedTargetMessage(origin, 'canonical-current')
    const sync = createBrowserArea({ [CONFIG_STORE_VERSION_KEY]: 2, user: 'sync-old' })
    const browserLocal = createBrowserArea({ sentinel: 'browser-local' })
    const browserSession = createBrowserArea({ sentinel: 'browser-session' })
    browserFixture.storage.sync = sync
    browserFixture.storage.local = browserLocal
    browserFixture.storage.session = browserSession

    await prepareBrowserSync()

    expect(sync.values).toEqual({ [CONFIG_STORE_VERSION_KEY]: CONFIG_STORE_VERSION })
    expect(sync.clear).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(localKey(APP_STATUS_STORAGE_KEY))).toBe('local-current')
    await expect(readTargetMessage(origin)).resolves.toBe('canonical-current')
    expect(browserLocal.values).toEqual({ sentinel: 'browser-local' })
    expect(browserSession.values).toEqual({ sentinel: 'browser-session' })
    expect(browserLocal.clear).not.toHaveBeenCalled()
    expect(browserSession.clear).not.toHaveBeenCalled()
  })
})
