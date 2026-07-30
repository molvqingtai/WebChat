import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { createMessageStore } from '@/domain/MessageStore'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import { MESSAGE_TYPE } from '@/protocol/ChatRoom'
import { MESSAGE_STORE_NAME, MESSAGE_STORE_VERSION, STORAGE_NAME } from '@/constants/storage'
import { installTestWebLocks } from '@/utils/withPreparationLock.test-utils'
import { createIndexedDBMessageDatabase, prepareIndexedDBMessageDatabase } from './IndexedDB'

const USER = { id: 'user-1', name: 'User', avatar: '' }
let databaseId = 0
const names = new Set<string>()

const trackWebChatDatabases = async () => {
  const databases = (await indexedDB.databases()).filter((database) => database.name?.startsWith(STORAGE_NAME))
  databases.forEach((database) => {
    if (database.name) names.add(database.name)
  })
  return databases
}

const failedRequest = (error: DOMException): IDBOpenDBRequest => {
  const request = new EventTarget() as IDBOpenDBRequest
  Object.defineProperty(request, 'error', { get: () => error })
  queueMicrotask(() => request.dispatchEvent(new Event('error')))
  return request
}

const textRecord = (id: string): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.TEXT,
    id,
    hlc: { timestamp: 1, counter: 0 },
    userId: USER.id,
    body: id,
    mentions: []
  },
  user: USER,
  receivedAt: 1
})

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const importMessageDatabaseRealm = async () => {
  vi.resetModules()
  return import('./IndexedDB')
}

beforeEach(() => {
  installTestWebLocks()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    [...names].map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name)
          request.addEventListener('success', () => resolve(), { once: true })
          request.addEventListener('error', () => resolve(), { once: true })
          request.addEventListener('blocked', () => resolve(), { once: true })
        })
    )
  )
  names.clear()
  vi.unstubAllGlobals()
})

describe('IndexedDB Message database version ownership', () => {
  describe('version-neutral target identity', () => {
    it('creates an absent target directly at the configured version', async () => {
      await prepareIndexedDBMessageDatabase()

      expect(await trackWebChatDatabases()).toEqual([{ name: MESSAGE_STORE_NAME, version: MESSAGE_STORE_VERSION }])
    })

    it('preserves records in an existing same-version target', async () => {
      names.add(MESSAGE_STORE_NAME)
      const record = textRecord('target-same-version')
      const target = await openDB(MESSAGE_STORE_NAME, MESSAGE_STORE_VERSION, {
        upgrade(database) {
          database.createObjectStore('records')
          database.createObjectStore('conflicts').createIndex('byEventId', 'eventId')
        }
      })
      await target.put('records', record, record.id)
      target.close()

      await prepareIndexedDBMessageDatabase()

      expect(await trackWebChatDatabases()).toEqual([{ name: MESSAGE_STORE_NAME, version: MESSAGE_STORE_VERSION }])
      const reopened = await openDB(MESSAGE_STORE_NAME)
      await expect(reopened.get('records', record.id)).resolves.toEqual(record)
      reopened.close()
    })

    it('destructively rebuilds an existing mismatched target', async () => {
      names.add(MESSAGE_STORE_NAME)
      const target = await openDB(MESSAGE_STORE_NAME, 1, {
        upgrade(database) {
          database.createObjectStore('legacy')
        }
      })
      await target.put('legacy', 'old-generation', 'sentinel')
      target.close()

      await prepareIndexedDBMessageDatabase()

      expect(await trackWebChatDatabases()).toEqual([{ name: MESSAGE_STORE_NAME, version: MESSAGE_STORE_VERSION }])
      const rebuilt = await openDB(MESSAGE_STORE_NAME)
      expect([...rebuilt.objectStoreNames]).toEqual(['conflicts', 'records'])
      rebuilt.close()
    })
  })

  it('creates an absent database at the target without issuing a delete', async () => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')

    await prepareIndexedDBMessageDatabase()

    expect(deletion).not.toHaveBeenCalled()
    deletion.mockRestore()
    const physical = await openDB(name)
    expect(physical.version).toBe(MESSAGE_STORE_VERSION)
    physical.close()
  })

  it('deletes the complete existing v1 database before rebuilding v2', async () => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const record = textRecord('survives-upgrade')
    const v1 = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('records')
        database.createObjectStore('conflicts')
        database.createObjectStore('unknown-residue')
      }
    })
    await v1.put('records', record, record.id)
    await v1.put('unknown-residue', 'old-generation', 'sentinel')
    v1.close()

    await prepareIndexedDBMessageDatabase()
    const database = createIndexedDBMessageDatabase()
    const messageStore = createMessageStore(database)
    await expect(messageStore.query()).resolves.toEqual([])
    await database.close()

    const physical = await openDB(name)
    expect(physical.version).toBe(MESSAGE_STORE_VERSION)
    expect([...physical.objectStoreNames]).toEqual(['conflicts', 'records'])
    expect(physical.transaction('conflicts').store.indexNames.contains('byEventId')).toBe(true)
    physical.close()
  })

  it('reopens v2 without clearing or advancing the schema', async () => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    await prepareIndexedDBMessageDatabase()
    const firstDatabase = createIndexedDBMessageDatabase()
    const firstStore = createMessageStore(firstDatabase)
    const record = textRecord('survives-reopen')
    await firstStore.insert(record)
    await firstDatabase.close()

    await prepareIndexedDBMessageDatabase()
    const secondDatabase = createIndexedDBMessageDatabase()
    await expect(createMessageStore(secondDatabase).query()).resolves.toEqual([record])
    await secondDatabase.close()

    const physical = await openDB(name)
    expect(physical.version).toBe(MESSAGE_STORE_VERSION)
    physical.close()
  })

  it.each([3, 7])('uses the same destructive reset for reverse/skipped native version %s', async (version) => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const legacy = await openDB(name, version, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    await legacy.put('legacy', 'old-generation', 'sentinel')
    legacy.close()

    await prepareIndexedDBMessageDatabase()

    const physical = await openDB(name)
    expect(physical.version).toBe(MESSAGE_STORE_VERSION)
    expect([...physical.objectStoreNames]).toEqual(['conflicts', 'records'])
    physical.close()
  })

  it('joins concurrent target contenders and deletes only once', async () => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')

    await Promise.all([
      prepareIndexedDBMessageDatabase(),
      prepareIndexedDBMessageDatabase(),
      prepareIndexedDBMessageDatabase()
    ])

    expect(deletion).toHaveBeenCalledTimes(1)
    deletion.mockRestore()
  })

  it('serializes independent realms so the later message owner preserves target writes', async () => {
    const secondGrant = deferred()
    installTestWebLocks({
      beforeGrant: (_name, request) => (request === 2 ? secondGrant.promise : undefined)
    })
    const firstRealm = await importMessageDatabaseRealm()
    const secondRealm = await importMessageDatabaseRealm()
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')

    const first = firstRealm.prepareIndexedDBMessageDatabase()
    const second = secondRealm.prepareIndexedDBMessageDatabase()
    await first
    const target = firstRealm.createIndexedDBMessageDatabase()
    const record = textRecord('new-generation-cross-realm')
    await createMessageStore(target).insert(record)
    await target.close()
    secondGrant.resolve()
    await second

    const reopened = firstRealm.createIndexedDBMessageDatabase()
    await expect(createMessageStore(reopened).query()).resolves.toEqual([record])
    await reopened.close()
    expect(deletion).toHaveBeenCalledTimes(1)
    deletion.mockRestore()
  })

  it('fails an independent late message owner closed when cross-realm locking disappears', async () => {
    const firstReadStarted = deferred()
    const releaseFirstRead = deferred()
    const secondReadStarted = deferred()
    const releaseSecondRead = deferred()
    const firstRealm = await importMessageDatabaseRealm()
    const secondRealm = await importMessageDatabaseRealm()
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()
    const nativeDatabases = indexedDB.databases.bind(indexedDB)
    let readCount = 0
    const databaseEnumeration = vi.spyOn(indexedDB, 'databases').mockImplementation(async () => {
      const snapshot = await nativeDatabases()
      readCount += 1
      if (readCount === 1) {
        firstReadStarted.resolve()
        await releaseFirstRead.promise
      } else if (readCount === 2) {
        secondReadStarted.resolve()
        await releaseSecondRead.promise
      }
      return snapshot
    })
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    const first = firstRealm.prepareIndexedDBMessageDatabase()
    await firstReadStarted.promise
    vi.stubGlobal('navigator', {})
    const second = secondRealm.prepareIndexedDBMessageDatabase()
    const secondSettled = second.then(
      () => undefined,
      () => undefined
    )
    await Promise.race([secondReadStarted.promise, secondSettled])

    releaseFirstRead.resolve()
    await first
    const target = firstRealm.createIndexedDBMessageDatabase()
    const record = textRecord('new-generation-lost-lock')
    await createMessageStore(target).insert(record)
    await target.close()
    releaseSecondRead.resolve()

    const secondResult = await second.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    )
    const reopened = firstRealm.createIndexedDBMessageDatabase()
    const records = await createMessageStore(reopened).query()
    await reopened.close()
    const deletionCount = deletion.mock.calls.length
    const diagnostics = diagnostic.mock.calls
    databaseEnumeration.mockRestore()
    deletion.mockRestore()
    diagnostic.mockRestore()

    expect(secondResult.status).toBe('rejected')
    if (secondResult.status === 'rejected') {
      expect(secondResult.error).toEqual(new Error('Persistence preparation coordination unavailable'))
    }
    expect(records).toEqual([record])
    expect(deletionCount).toBe(1)
    expect(diagnostics).toContainEqual(['[WebChat] Persistence preparation coordination unavailable'])
  })

  it('keeps a blocked delete non-ready and completes the same request after release', async () => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const blocker = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')
    let ready = false

    const preparation = prepareIndexedDBMessageDatabase().then(() => {
      ready = true
    })
    await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1))
    expect(ready).toBe(false)
    expect(deletion).toHaveBeenCalledTimes(1)

    blocker.close()
    await preparation
    expect(ready).toBe(true)
    expect(deletion).toHaveBeenCalledTimes(1)
    warning.mockRestore()
    deletion.mockRestore()
  })

  it('logs a bounded read failure, leaves the old version intact, and retries', async () => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const enumeration = vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new Error('private failure'))

    await expect(prepareIndexedDBMessageDatabase()).rejects.toThrow('Message store preparation failed')
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Message store preparation failed')
    enumeration.mockRestore()

    const unchanged = await openDB(name)
    expect(unchanged.version).toBe(1)
    unchanged.close()

    await prepareIndexedDBMessageDatabase()
    const rebuilt = await openDB(name)
    expect(rebuilt.version).toBe(MESSAGE_STORE_VERSION)
    rebuilt.close()
    diagnostic.mockRestore()
  })

  it('does not advance past a deletion error and retries the old generation', async () => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()
    const nativeDelete = indexedDB.deleteDatabase.bind(indexedDB)
    const deletion = vi
      .spyOn(indexedDB, 'deleteDatabase')
      .mockImplementationOnce(() => failedRequest(new DOMException('private failure', 'UnknownError')))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(prepareIndexedDBMessageDatabase()).rejects.toThrow('Message store preparation failed')
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Message store preparation failed')
    deletion.mockImplementation(nativeDelete)

    const unchanged = await openDB(name)
    expect(unchanged.version).toBe(1)
    unchanged.close()

    await prepareIndexedDBMessageDatabase()
    expect(deletion).toHaveBeenCalledTimes(2)
    deletion.mockRestore()
    diagnostic.mockRestore()
  })

  it('rebuilds empty on retry when target recreation failed after deletion', async () => {
    const name = MESSAGE_STORE_NAME
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    await legacy.put('legacy', 'old-generation', 'sentinel')
    legacy.close()
    const nativeOpen = indexedDB.open.bind(indexedDB)
    const opening = vi
      .spyOn(indexedDB, 'open')
      .mockImplementationOnce(() => failedRequest(new DOMException('private failure', 'UnknownError')))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(prepareIndexedDBMessageDatabase()).rejects.toThrow('Message store preparation failed')
    expect((await indexedDB.databases()).some((database) => database.name === name)).toBe(false)
    opening.mockImplementation(nativeOpen)

    await prepareIndexedDBMessageDatabase()
    const rebuilt = await openDB(name)
    expect(rebuilt.version).toBe(MESSAGE_STORE_VERSION)
    expect([...rebuilt.objectStoreNames]).toEqual(['conflicts', 'records'])
    rebuilt.close()
    opening.mockRestore()
    diagnostic.mockRestore()
  })

  it('preserves unrelated IndexedDB identities during a target reset', async () => {
    const name = MESSAGE_STORE_NAME
    const unrelatedName = `unrelated-${databaseId++}`
    names.add(name)
    names.add(unrelatedName)
    const target = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    target.close()
    const unrelated = await openDB(unrelatedName, 1, {
      upgrade(database) {
        database.createObjectStore('sentinels')
      }
    })
    await unrelated.put('sentinels', 'preserved', 'key')
    unrelated.close()

    await prepareIndexedDBMessageDatabase()

    const preserved = await openDB(unrelatedName)
    await expect(preserved.get('sentinels', 'key')).resolves.toBe('preserved')
    preserved.close()
  })

  it('uses the same target name in independent native origin partitions', async () => {
    const firstFactory = new IDBFactory()
    const secondFactory = new IDBFactory()
    const firstRecord = textRecord('first-origin')
    const secondRecord = textRecord('second-origin')

    const seedPartition = async (factory: IDBFactory, record: TextMessageRecord) => {
      vi.stubGlobal('indexedDB', factory)
      await prepareIndexedDBMessageDatabase()
      const database = createIndexedDBMessageDatabase()
      await createMessageStore(database).insert(record)
      await database.close()
      expect(await factory.databases()).toEqual([{ name: MESSAGE_STORE_NAME, version: MESSAGE_STORE_VERSION }])
    }

    await seedPartition(firstFactory, firstRecord)
    await seedPartition(secondFactory, secondRecord)

    vi.stubGlobal('indexedDB', firstFactory)
    const first = createIndexedDBMessageDatabase()
    await expect(createMessageStore(first).query()).resolves.toEqual([firstRecord])
    await first.close()

    vi.stubGlobal('indexedDB', secondFactory)
    const second = createIndexedDBMessageDatabase()
    await expect(createMessageStore(second).query()).resolves.toEqual([secondRecord])
    await second.close()
  })
})
