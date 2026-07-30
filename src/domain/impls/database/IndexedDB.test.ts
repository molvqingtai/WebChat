import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { createMessageStore } from '@/domain/MessageStore'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import { MESSAGE_TYPE } from '@/protocol/ChatRoom'
import { STORAGE_NAME } from '@/constants/config'
import { MESSAGE_STORE_VERSION } from '@/constants/storage'
import { installTestWebLocks } from '@/utils/serializedPreparation.test-utils'
import { createIndexedDBMessageDatabase, prepareIndexedDBMessageDatabase } from './IndexedDB'

const USER = { id: 'user-1', name: 'User', avatar: '' }
let databaseId = 0
const names = new Set<string>()
const nextOrigin = (label: string) => `https://${label}-${databaseId++}.test`
const messageDatabaseName = (origin: string) => `${STORAGE_NAME}:EVENTS_V2_CANONICAL_RECORDS:${origin}`

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
  it('creates an absent database at the target without issuing a delete', async () => {
    const origin = nextOrigin('message-baseline')
    const name = messageDatabaseName(origin)
    names.add(name)
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')

    await prepareIndexedDBMessageDatabase(origin)

    expect(deletion).not.toHaveBeenCalled()
    deletion.mockRestore()
    const physical = await openDB(name)
    expect(physical.version).toBe(MESSAGE_STORE_VERSION)
    physical.close()
  })

  it('deletes the complete existing v1 database before rebuilding v2', async () => {
    const origin = nextOrigin('message-upgrade')
    const name = messageDatabaseName(origin)
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

    await prepareIndexedDBMessageDatabase(origin)
    const database = createIndexedDBMessageDatabase(origin)
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
    const origin = nextOrigin('message-reopen')
    const name = messageDatabaseName(origin)
    names.add(name)
    await prepareIndexedDBMessageDatabase(origin)
    const firstDatabase = createIndexedDBMessageDatabase(origin)
    const firstStore = createMessageStore(firstDatabase)
    const record = textRecord('survives-reopen')
    await firstStore.insert(record)
    await firstDatabase.close()

    await prepareIndexedDBMessageDatabase(origin)
    const secondDatabase = createIndexedDBMessageDatabase(origin)
    await expect(createMessageStore(secondDatabase).query()).resolves.toEqual([record])
    await secondDatabase.close()

    const physical = await openDB(name)
    expect(physical.version).toBe(MESSAGE_STORE_VERSION)
    physical.close()
  })

  it.each([3, 7])('uses the same destructive reset for reverse/skipped native version %s', async (version) => {
    const origin = nextOrigin(`message-version-${version}`)
    const name = messageDatabaseName(origin)
    names.add(name)
    const legacy = await openDB(name, version, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    await legacy.put('legacy', 'old-generation', 'sentinel')
    legacy.close()

    await prepareIndexedDBMessageDatabase(origin)

    const physical = await openDB(name)
    expect(physical.version).toBe(MESSAGE_STORE_VERSION)
    expect([...physical.objectStoreNames]).toEqual(['conflicts', 'records'])
    physical.close()
  })

  it('joins concurrent same-origin contenders and deletes only once', async () => {
    const origin = nextOrigin('message-concurrent')
    const name = messageDatabaseName(origin)
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')

    await Promise.all([
      prepareIndexedDBMessageDatabase(origin),
      prepareIndexedDBMessageDatabase(origin),
      prepareIndexedDBMessageDatabase(origin)
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
    const origin = nextOrigin('message-cross-realm')
    const name = messageDatabaseName(origin)
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')

    const first = firstRealm.prepareIndexedDBMessageDatabase(origin)
    const second = secondRealm.prepareIndexedDBMessageDatabase(origin)
    await first
    const target = firstRealm.createIndexedDBMessageDatabase(origin)
    const record = textRecord('new-generation-cross-realm')
    await createMessageStore(target).insert(record)
    await target.close()
    secondGrant.resolve()
    await second

    const reopened = firstRealm.createIndexedDBMessageDatabase(origin)
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
    const origin = nextOrigin('message-lost-lock')
    const name = messageDatabaseName(origin)
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

    const first = firstRealm.prepareIndexedDBMessageDatabase(origin)
    await firstReadStarted.promise
    vi.stubGlobal('navigator', {})
    const second = secondRealm.prepareIndexedDBMessageDatabase(origin)
    const secondSettled = second.then(
      () => undefined,
      () => undefined
    )
    await Promise.race([secondReadStarted.promise, secondSettled])

    releaseFirstRead.resolve()
    await first
    const target = firstRealm.createIndexedDBMessageDatabase(origin)
    const record = textRecord('new-generation-lost-lock')
    await createMessageStore(target).insert(record)
    await target.close()
    releaseSecondRead.resolve()

    const secondResult = await second.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    )
    const reopened = firstRealm.createIndexedDBMessageDatabase(origin)
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
    const origin = nextOrigin('message-blocked')
    const name = messageDatabaseName(origin)
    names.add(name)
    const blocker = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase')
    let ready = false

    const preparation = prepareIndexedDBMessageDatabase(origin).then(() => {
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
    const origin = nextOrigin('message-retry')
    const name = messageDatabaseName(origin)
    names.add(name)
    const legacy = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('legacy')
      }
    })
    legacy.close()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const enumeration = vi.spyOn(indexedDB, 'databases').mockRejectedValueOnce(new Error('private failure'))

    await expect(prepareIndexedDBMessageDatabase(origin)).rejects.toThrow('Message store preparation failed')
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Message store preparation failed')
    enumeration.mockRestore()

    const unchanged = await openDB(name)
    expect(unchanged.version).toBe(1)
    unchanged.close()

    await prepareIndexedDBMessageDatabase(origin)
    const rebuilt = await openDB(name)
    expect(rebuilt.version).toBe(MESSAGE_STORE_VERSION)
    rebuilt.close()
    diagnostic.mockRestore()
  })

  it('does not advance past a deletion error and retries the old generation', async () => {
    const origin = nextOrigin('message-delete-error')
    const name = messageDatabaseName(origin)
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

    await expect(prepareIndexedDBMessageDatabase(origin)).rejects.toThrow('Message store preparation failed')
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Message store preparation failed')
    deletion.mockImplementation(nativeDelete)

    const unchanged = await openDB(name)
    expect(unchanged.version).toBe(1)
    unchanged.close()

    await prepareIndexedDBMessageDatabase(origin)
    expect(deletion).toHaveBeenCalledTimes(2)
    deletion.mockRestore()
    diagnostic.mockRestore()
  })

  it('rebuilds empty on retry when target recreation failed after deletion', async () => {
    const origin = nextOrigin('message-recreate-error')
    const name = messageDatabaseName(origin)
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

    await expect(prepareIndexedDBMessageDatabase(origin)).rejects.toThrow('Message store preparation failed')
    expect((await indexedDB.databases()).some((database) => database.name === name)).toBe(false)
    opening.mockImplementation(nativeOpen)

    await prepareIndexedDBMessageDatabase(origin)
    const rebuilt = await openDB(name)
    expect(rebuilt.version).toBe(MESSAGE_STORE_VERSION)
    expect([...rebuilt.objectStoreNames]).toEqual(['conflicts', 'records'])
    rebuilt.close()
    opening.mockRestore()
    diagnostic.mockRestore()
  })

  it('preserves another origin and unrelated IndexedDB identities', async () => {
    const currentOrigin = nextOrigin('message-current-origin')
    const otherOrigin = nextOrigin('message-other-origin')
    const currentName = messageDatabaseName(currentOrigin)
    const otherName = messageDatabaseName(otherOrigin)
    const unrelatedName = `unrelated-${databaseId++}`
    names.add(currentName)
    names.add(otherName)
    names.add(unrelatedName)
    const seed = async (name: string) => {
      const database = await openDB(name, 1, {
        upgrade(value) {
          value.createObjectStore('sentinels')
        }
      })
      await database.put('sentinels', 'preserved', 'key')
      database.close()
    }
    await Promise.all([seed(currentName), seed(otherName), seed(unrelatedName)])

    await prepareIndexedDBMessageDatabase(currentOrigin)

    const other = await openDB(otherName)
    const unrelated = await openDB(unrelatedName)
    await expect(other.get('sentinels', 'key')).resolves.toBe('preserved')
    await expect(unrelated.get('sentinels', 'key')).resolves.toBe('preserved')
    other.close()
    unrelated.close()
  })
})
