import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_OPEN_STORAGE_KEY,
  APP_POSITION_STORAGE_KEY,
  APP_UNREAD_STORAGE_KEY,
  CONFIG_STORE_VERSION,
  CONFIG_STORE_VERSION_KEY,
  STORAGE_NAME
} from '@/constants/storage'
import { installTestWebLocks } from '@/utils/withPreparationLock.test-utils'
import { createTestLocalStorage } from '@/utils/storage.test-utils'
import type { ConfigurationVersionStorage } from './Storage'

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

const deferredValue = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

let configurationStorageId = 0

const createVersionStorage = (version: { exists: boolean; value?: unknown }, values = new Map<string, unknown>()) => {
  let storedVersion = version
  const storage: ConfigurationVersionStorage = {
    readVersion: vi.fn(async () => ({ exists: storedVersion.exists, value: storedVersion.value })),
    writeVersion: vi.fn(async (value) => {
      storedVersion = { exists: true, value }
    }),
    clear: vi.fn(async () => {
      values.clear()
      storedVersion = { exists: false }
    })
  }
  return { storage, values, version: () => storedVersion }
}

const prepareVersionStorage = async (fixture: ReturnType<typeof createVersionStorage>) => {
  vi.stubGlobal('window', { localStorage: createTestLocalStorage() })
  vi.stubGlobal('location', { origin: 'https://version-storage.test' })
  const { prepareConfigurationStorage } = await import('./Storage')
  return prepareConfigurationStorage(`test-${configurationStorageId++}`, fixture.storage)
}

const loadConfigurationPreparationRealm = async () => {
  vi.stubGlobal('window', { localStorage: createTestLocalStorage() })
  vi.stubGlobal('location', { origin: `https://version-realm-${configurationStorageId++}.test` })
  vi.resetModules()
  return (await import('./Storage')).prepareConfigurationStorage
}

const loadLocalPreparationRealm = async (origin: string, localStorage: Storage) => {
  vi.stubGlobal('window', { localStorage })
  vi.stubGlobal('location', { origin })
  vi.resetModules()
  return (await import('./Storage')).prepareLocalConfigurationStorage
}

describe('origin-local configuration preparation', () => {
  it('preserves host keys and AppStatus fields while applying mismatch rules to version-managed local values', async () => {
    const localStorage = createTestLocalStorage()
    vi.stubGlobal('window', { localStorage })
    vi.stubGlobal('location', { origin: 'https://storage.test' })
    const { prepareLocalConfigurationStorage } = await import('./Storage')
    const statusKeys = [APP_OPEN_STORAGE_KEY, APP_POSITION_STORAGE_KEY, APP_UNREAD_STORAGE_KEY].map(
      (key) => `${STORAGE_NAME}:${key}`
    )
    const versionKey = `${STORAGE_NAME}:${CONFIG_STORE_VERSION_KEY}`
    const versionManagedKey = `${STORAGE_NAME}:VERSION_MANAGED_SETTING`
    localStorage.setItem('HOST_PAGE_KEY', 'preserved')
    statusKeys.forEach((key, index) => localStorage.setItem(key, `status-${index}`))

    await prepareLocalConfigurationStorage()
    expect(statusKeys.map((key) => localStorage.getItem(key))).toEqual(['status-0', 'status-1', 'status-2'])
    expect(localStorage.getItem(versionKey)).toBe('1')

    statusKeys.forEach((key, index) => localStorage.setItem(key, `current-${index}`))
    await prepareLocalConfigurationStorage()
    expect(statusKeys.map((key) => localStorage.getItem(key))).toEqual(['current-0', 'current-1', 'current-2'])

    localStorage.setItem(versionKey, '7')
    localStorage.setItem(versionManagedKey, 'old-generation')
    await prepareLocalConfigurationStorage()
    expect(statusKeys.map((key) => localStorage.getItem(key))).toEqual(['current-0', 'current-1', 'current-2'])
    expect(localStorage.getItem(versionManagedKey)).toBeNull()
    expect(localStorage.getItem(versionKey)).toBe('1')
    expect(localStorage.getItem('HOST_PAGE_KEY')).toBe('preserved')
  })

  it('keeps hydrated AppStatus through a real mismatch and restores it in a second shell store', async () => {
    const localStorage = createTestLocalStorage()
    vi.stubGlobal('window', {
      localStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    vi.stubGlobal('location', { origin: 'https://status-mismatch.test' })
    vi.resetModules()
    const [
      { Remesh: RealmRemesh },
      { default: AppStatusDomain },
      { LocalStorageImpl, prepareLocalConfigurationStorage },
      { BrowserSyncStorageExtern },
      { ChatRoomExtern },
      { ReadinessExtern },
      { MessageDatabaseExtern },
      { createMemoryMessageDatabase }
    ] = await Promise.all([
      import('remesh'),
      import('@/domain/AppStatus'),
      import('./Storage'),
      import('@/domain/externs/Storage'),
      import('@/domain/externs/ChatRoom'),
      import('@/domain/externs/Readiness'),
      import('@/domain/MessageStore'),
      import('@/domain/impls/database/Memory')
    ])
    const openKey = `${STORAGE_NAME}:${APP_OPEN_STORAGE_KEY}`
    const positionKey = `${STORAGE_NAME}:${APP_POSITION_STORAGE_KEY}`
    const unreadKey = `${STORAGE_NAME}:${APP_UNREAD_STORAGE_KEY}`
    const versionKey = `${STORAGE_NAME}:${CONFIG_STORE_VERSION_KEY}`
    const persistedStatus = { open: true, unread: false, position: { x: -84, y: 36 } }
    localStorage.setItem(openKey, JSON.stringify(persistedStatus.open))
    localStorage.setItem(positionKey, JSON.stringify(persistedStatus.position))
    localStorage.setItem(unreadKey, JSON.stringify(persistedStatus.unread))
    localStorage.setItem(versionKey, String(CONFIG_STORE_VERSION + 1))

    const browserStorage = BrowserSyncStorageExtern.impl({
      get: async () => null,
      set: async () => {},
      watch: async () => async () => {}
    })
    const chatRoom = ChatRoomExtern.impl({
      joinRoom: async () => {},
      leaveRoom: async () => {},
      sendMessage: async () => {
        throw new Error('unused')
      },
      onMessage: () => () => {},
      onJoinRoom: () => () => {},
      onLeaveRoom: () => () => {},
      onSessions: () => () => {},
      onError: () => () => {}
    })
    const readiness = ReadinessExtern.impl({ onState: () => () => {} })
    const createExterns = () => [
      LocalStorageImpl,
      browserStorage,
      chatRoom,
      readiness,
      MessageDatabaseExtern.impl(createMemoryMessageDatabase(`status-mismatch-${configurationStorageId++}`))
    ]

    const firstStore = RealmRemesh.store({ externs: createExterns() })
    const firstStatus = firstStore.getDomain(AppStatusDomain())
    firstStore.igniteDomain(AppStatusDomain())
    await vi.waitFor(() => expect(firstStore.query(firstStatus.query.StatusLoadIsFinishedQuery())).toBe(true))
    expect(firstStore.query(firstStatus.query.OpenQuery())).toBe(true)

    await prepareLocalConfigurationStorage()
    firstStore.discard()

    const secondStore = RealmRemesh.store({ externs: createExterns() })
    const secondStatus = secondStore.getDomain(AppStatusDomain())
    secondStore.igniteDomain(AppStatusDomain())
    await vi.waitFor(() => expect(secondStore.query(secondStatus.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(secondStore.query(secondStatus.query.OpenQuery())).toBe(true)
    expect(secondStore.query(secondStatus.query.HasUnreadQuery())).toBe(false)
    expect(secondStore.query(secondStatus.query.PositionQuery())).toEqual({ x: -84, y: 36 })
    expect(JSON.parse(localStorage.getItem(openKey)!)).toBe(persistedStatus.open)
    expect(JSON.parse(localStorage.getItem(positionKey)!)).toEqual(persistedStatus.position)
    expect(JSON.parse(localStorage.getItem(unreadKey)!)).toBe(persistedStatus.unread)
    expect(localStorage.getItem(versionKey)).toBe(String(CONFIG_STORE_VERSION))
    secondStore.discard()
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
    const statusKeys = [APP_OPEN_STORAGE_KEY, APP_POSITION_STORAGE_KEY, APP_UNREAD_STORAGE_KEY].map(
      (key) => `${STORAGE_NAME}:${key}`
    )
    const versionKey = `${STORAGE_NAME}:${CONFIG_STORE_VERSION_KEY}`
    statusKeys.forEach((key) => localStorage.setItem(key, 'old-generation'))
    localStorage.setItem(versionKey, '7')

    const first = firstRealm()
    const second = secondRealm()
    await first
    statusKeys.forEach((key) => localStorage.setItem(key, 'new-generation'))
    secondGrant.resolve()
    await second

    expect(statusKeys.map((key) => localStorage.getItem(key))).toEqual([
      'new-generation',
      'new-generation',
      'new-generation'
    ])
    expect(localStorage.getItem(versionKey)).toBe('1')
  })
})

describe('configuration storage version ownership', () => {
  it('establishes a missing baseline without clearing pre-version data', async () => {
    const fixture = createVersionStorage({ exists: false }, new Map([['user-info', 'preserved']]))

    await prepareVersionStorage(fixture)

    expect(fixture.storage.clear).not.toHaveBeenCalled()
    expect(fixture.values.get('user-info')).toBe('preserved')
    expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
  })

  it('preserves all values on the same version', async () => {
    const fixture = createVersionStorage(
      { exists: true, value: CONFIG_STORE_VERSION },
      new Map([['app-status', 'preserved']])
    )

    await prepareVersionStorage(fixture)

    expect(fixture.storage.clear).not.toHaveBeenCalled()
    expect(fixture.storage.writeVersion).not.toHaveBeenCalled()
    expect(fixture.values.get('app-status')).toBe('preserved')
  })

  it.each([0, 2, 7, -1, '1', null, { version: 1 }])(
    'clears an existing non-equal or malformed completion value %j',
    async (storedVersion) => {
      const fixture = createVersionStorage({ exists: true, value: storedVersion }, new Map([['old', 'generation']]))

      await prepareVersionStorage(fixture)

      expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
      expect(fixture.values.size).toBe(0)
      expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
    }
  )

  it('joins concurrent contenders and preserves writes after target completion', async () => {
    const fixture = createVersionStorage({ exists: true, value: 2 }, new Map([['old', 'generation']]))
    let releaseClear!: () => void
    vi.mocked(fixture.storage.clear).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseClear = () => {
            fixture.values.clear()
            resolve()
          }
        })
    )
    const identity = `concurrent-${configurationStorageId++}`
    const { prepareConfigurationStorage } = await import('./Storage')

    const first = prepareConfigurationStorage(identity, fixture.storage)
    const second = prepareConfigurationStorage(identity, fixture.storage)
    await vi.waitFor(() => expect(fixture.storage.clear).toHaveBeenCalledTimes(1))
    releaseClear()
    await Promise.all([first, second])

    fixture.values.set('new', 'generation')
    await prepareConfigurationStorage(identity, fixture.storage)
    expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
    expect(fixture.values.get('new')).toBe('generation')
  })

  it('shares one completion while Retry replaces an unresolved read owner and fences the late result', async () => {
    const staleRead = deferredValue<{ readonly exists: boolean; readonly value: unknown }>()
    const storage: ConfigurationVersionStorage = {
      readVersion: vi
        .fn()
        .mockImplementationOnce(() => staleRead.promise)
        .mockResolvedValue({ exists: true, value: CONFIG_STORE_VERSION }),
      writeVersion: vi.fn(async () => {}),
      clear: vi.fn(async () => {})
    }
    const identity = `retry-unresolved-${configurationStorageId++}`
    const { prepareConfigurationStorage } = await import('./Storage')

    const first = prepareConfigurationStorage(identity, storage)
    await vi.waitFor(() => expect(storage.readVersion).toHaveBeenCalledOnce())
    const retry = prepareConfigurationStorage(identity, storage)

    try {
      expect(retry).toBe(first)
      await vi.waitFor(() => expect(storage.readVersion).toHaveBeenCalledTimes(2), { interval: 5, timeout: 100 })
      await expect(retry).resolves.toBeUndefined()
      await expect(first).resolves.toBeUndefined()

      staleRead.resolve({ exists: true, value: CONFIG_STORE_VERSION + 1 })
      await Promise.resolve()

      expect(storage.clear).not.toHaveBeenCalled()
      expect(storage.writeVersion).not.toHaveBeenCalled()
    } finally {
      staleRead.resolve({ exists: true, value: CONFIG_STORE_VERSION + 1 })
      await Promise.allSettled([first, retry])
    }
  })

  it('serializes independent realms so the later owner rereads target completion', async () => {
    const secondGrant = deferred()
    installTestWebLocks({
      beforeGrant: (_name, request) => (request === 2 ? secondGrant.promise : undefined)
    })
    const firstRealm = await loadConfigurationPreparationRealm()
    const secondRealm = await loadConfigurationPreparationRealm()
    const fixture = createVersionStorage({ exists: true, value: 2 }, new Map([['old', 'generation']]))
    const identity = `cross-realm-${configurationStorageId++}`

    const first = firstRealm(identity, fixture.storage)
    const second = secondRealm(identity, fixture.storage)
    await first
    fixture.values.set('new', 'generation')
    secondGrant.resolve()
    await second

    expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
    expect(fixture.values.get('new')).toBe('generation')
    expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
  })

  it('fails an independent late owner closed when cross-realm locking disappears', async () => {
    const firstClearStarted = deferred()
    const releaseFirstClear = deferred()
    const secondClearStarted = deferred()
    const releaseSecondClear = deferred()
    let storedVersion: { exists: boolean; value: unknown } = { exists: true, value: 2 }
    const values = new Map<string, unknown>([['old', 'generation']])
    const createOwnerStorage = (clearStarted: ReturnType<typeof deferred>, clearRelease: ReturnType<typeof deferred>) =>
      ({
        readVersion: vi.fn(async () => ({ ...storedVersion })),
        writeVersion: vi.fn(async (value: number) => {
          storedVersion = { exists: true, value }
        }),
        clear: vi.fn(async () => {
          clearStarted.resolve()
          await clearRelease.promise
          values.clear()
          storedVersion = { exists: false, value: undefined }
        })
      }) satisfies ConfigurationVersionStorage
    const firstStorage = createOwnerStorage(firstClearStarted, releaseFirstClear)
    const secondStorage = createOwnerStorage(secondClearStarted, releaseSecondClear)
    const firstRealm = await loadConfigurationPreparationRealm()
    const secondRealm = await loadConfigurationPreparationRealm()
    const identity = `lost-lock-${configurationStorageId++}`
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    const first = firstRealm(identity, firstStorage)
    await firstClearStarted.promise
    vi.stubGlobal('navigator', {})
    const second = secondRealm(identity, secondStorage)
    const secondSettled = second.then(
      () => undefined,
      () => undefined
    )
    await Promise.race([secondClearStarted.promise, secondSettled])

    releaseFirstClear.resolve()
    await first
    values.set('new', 'generation')
    releaseSecondClear.resolve()

    await expect(second).rejects.toThrow('Persistence preparation coordination unavailable')
    expect(secondStorage.readVersion).not.toHaveBeenCalled()
    expect(secondStorage.clear).not.toHaveBeenCalled()
    expect(values.get('new')).toBe('generation')
    expect(storedVersion).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Persistence preparation coordination unavailable')
    diagnostic.mockRestore()
  })

  it('does not advance completion after clear failure and retries later', async () => {
    const fixture = createVersionStorage({ exists: true, value: 2 }, new Map([['old', 'generation']]))
    vi.mocked(fixture.storage.clear).mockRejectedValueOnce(new Error('private failure'))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const identity = `retry-${configurationStorageId++}`
    const { prepareConfigurationStorage } = await import('./Storage')

    await expect(prepareConfigurationStorage(identity, fixture.storage)).rejects.toThrow(
      'Configuration store preparation failed'
    )
    expect(fixture.version()).toEqual({ exists: true, value: 2 })
    expect(fixture.storage.writeVersion).not.toHaveBeenCalled()
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Configuration store preparation failed')

    await prepareConfigurationStorage(identity, fixture.storage)
    expect(fixture.storage.clear).toHaveBeenCalledTimes(2)
    expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
    diagnostic.mockRestore()
  })

  it('retries marker completion after a successful clear without clearing twice', async () => {
    const fixture = createVersionStorage({ exists: true, value: 2 }, new Map([['old', 'generation']]))
    vi.mocked(fixture.storage.writeVersion).mockRejectedValueOnce(new Error('private failure'))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const identity = `completion-retry-${configurationStorageId++}`
    const { prepareConfigurationStorage } = await import('./Storage')

    await expect(prepareConfigurationStorage(identity, fixture.storage)).rejects.toThrow(
      'Configuration store preparation failed'
    )
    expect(fixture.values.size).toBe(0)
    expect(fixture.version()).toEqual({ exists: false })

    await prepareConfigurationStorage(identity, fixture.storage)
    expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
    expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
    expect(diagnostic).toHaveBeenCalledTimes(1)
    diagnostic.mockRestore()
  })

  it('keeps independent physical scopes isolated', async () => {
    const current = createVersionStorage({ exists: true, value: 2 }, new Map([['current', 'old']]))
    const other = createVersionStorage({ exists: true, value: CONFIG_STORE_VERSION }, new Map([['other', 'preserved']]))
    const { prepareConfigurationStorage } = await import('./Storage')

    await Promise.all([
      prepareConfigurationStorage(`current-${configurationStorageId++}`, current.storage),
      prepareConfigurationStorage(`other-${configurationStorageId++}`, other.storage)
    ])

    expect(current.values.size).toBe(0)
    expect(other.values.get('other')).toBe('preserved')
    expect(other.storage.clear).not.toHaveBeenCalled()
  })

  it('arbitrates an injected coordinator lease across the preparation lifecycle', async () => {
    const fixture = createVersionStorage({ exists: false })
    const events: string[] = []
    const coordinator = {
      acquire: vi.fn(async () => {
        events.push('acquire')
        return () => {
          events.push('release')
        }
      })
    }
    const identity = `coordinated-${configurationStorageId++}`
    const { prepareConfigurationStorage } = await import('./Storage')

    await prepareConfigurationStorage(identity, fixture.storage, coordinator)

    expect(coordinator.acquire).toHaveBeenCalledWith(`configuration:${identity}`)
    expect(events).toEqual(['acquire', 'release'])
    expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
  })
})
