import type {
  Database,
  DatabaseItem,
  DatabaseSchema,
  InsertResult,
  QueryOptions,
  ReadTransaction,
  ScanOptions,
  WriteTransaction
} from '@/domain/externs/Database'
import type { Unsubscribe } from '@/domain/Subscription'
import { MESSAGE_STORE_VERSION, STORAGE_NAME } from '@/constants/storage'
import { createMessageDatabaseDefinition, type MessageDatabaseSchema } from '@/domain/MessageStore'
import {
  assertDatabaseKey,
  cloneStoredValue,
  cloneValue,
  validateQuery,
  validateScope,
  validateStoreValue,
  type DatabaseDefinition,
  type StoreDefinition,
  type ValidatedQuery
} from './Definition'
import { withPreparationLock, type PreparationLockCoordinator } from '@/utils/withPreparationLock'

type StoreName<Schema> = keyof Schema & string

const abortError = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('Aborted', 'AbortError')
const inactiveError = () => new DOMException('Database transaction is inactive', 'TransactionInactiveError')

const requestResult = <Result>(request: IDBRequest<Result>): Promise<Result> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), {
      once: true
    })
  })

const transactionResult = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new DOMException('Aborted', 'AbortError')),
      {
        once: true
      }
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed')),
      {
        once: true
      }
    )
  })

const openDatabase = <Schema extends DatabaseSchema<Schema>>(
  definition: DatabaseDefinition<Schema>
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(definition.name, definition.version)
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result
        const transaction = request.transaction
        if (!transaction) throw new Error('IndexedDB upgrade transaction is unavailable')
        Object.entries(definition.stores).forEach(([storeName, rawStore]) => {
          const storeDefinition = rawStore as StoreDefinition<Schema[StoreName<Schema>]>
          const store = database.objectStoreNames.contains(storeName)
            ? transaction.objectStore(storeName)
            : database.createObjectStore(storeName)
          Object.entries(storeDefinition.indexes).forEach(([indexName, indexDefinition]) => {
            if (indexDefinition.introducedIn <= definition.version && !store.indexNames.contains(indexName)) {
              store.createIndex(indexName, indexDefinition.keyPath)
            }
          })
        })
      },
      { once: true }
    )
    request.addEventListener(
      'success',
      () => {
        const database = request.result
        database.addEventListener('versionchange', () => database.close(), { once: true })
        resolve(database)
      },
      { once: true }
    )
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB open failed')), {
      once: true
    })
    request.addEventListener('blocked', () => reject(new Error(`IndexedDB open blocked: ${definition.name}`)), {
      once: true
    })
  })

type RangeResult = IDBKeyRange | undefined | 'empty'

const toKeyRange = (query: ValidatedQuery): RangeResult => {
  const range = query.range
  if (!range) return undefined
  const hasLower = Object.prototype.hasOwnProperty.call(range, 'lower')
  const hasUpper = Object.prototype.hasOwnProperty.call(range, 'upper')
  if (hasLower && hasUpper) {
    if (range.lower === range.upper && (range.lowerOpen === true || range.upperOpen === true)) return 'empty'
    return IDBKeyRange.bound(
      range.lower as IDBValidKey,
      range.upper as IDBValidKey,
      range.lowerOpen === true,
      range.upperOpen === true
    )
  }
  if (hasLower) return IDBKeyRange.lowerBound(range.lower as IDBValidKey, range.lowerOpen === true)
  if (hasUpper) return IDBKeyRange.upperBound(range.upper as IDBValidKey, range.upperOpen === true)
  return undefined
}

class IndexedDBTransaction<
  Schema extends DatabaseSchema<Schema>,
  Allowed extends StoreName<Schema>
> implements WriteTransaction<Schema, Allowed> {
  readonly mutated = new Set<string>()
  private active = true
  private pending = 0
  private idleGeneration = 0
  private idleTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  constructor(
    private readonly definition: DatabaseDefinition<Schema>,
    private readonly transaction: IDBTransaction,
    private readonly allowed: ReadonlySet<string>,
    private readonly writable: boolean,
    private readonly onIdle: () => void,
    private readonly signal?: AbortSignal
  ) {}

  observeCallback() {
    if (this.pending === 0) this.idle()
  }

  assertCallbackActive() {
    if (!this.active) throw inactiveError()
  }

  finish() {
    this.active = false
    this.touch()
  }

  private touch() {
    this.idleGeneration += 1
    if (this.idleTimer !== null) globalThis.clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  // Keep one native request pending until the zero-delay callback window either continues or aborts.
  private keepAlive(generation: number) {
    if (!this.active || this.pending > 0 || this.idleGeneration !== generation) return
    const storeName = this.allowed.values().next().value
    if (!storeName) return
    let request: IDBRequest<number>
    try {
      request = this.transaction.objectStore(storeName).count()
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === 'InvalidStateError' || error.name === 'TransactionInactiveError')
      ) {
        return
      }
      console.error(error)
      return
    }
    const continueKeepingAlive = () => this.keepAlive(generation)
    request.addEventListener('success', continueKeepingAlive, { once: true })
    request.addEventListener('error', continueKeepingAlive, { once: true })
  }

  private idle() {
    this.touch()
    const generation = this.idleGeneration
    this.idleTimer = globalThis.setTimeout(() => {
      if (!this.active || this.pending > 0 || this.idleGeneration !== generation) return
      this.idleTimer = null
      this.active = false
      this.onIdle()
    }, 0)
    this.keepAlive(generation)
  }

  private track<Result>(operation: Promise<Result>): Promise<Result> {
    this.touch()
    this.pending += 1
    const releasePending = () => {
      this.pending -= 1
      if (this.pending === 0 && this.active) this.idle()
    }
    void operation.then(releasePending, releasePending)
    return operation
  }

  private store<Store extends Allowed>(
    name: Store
  ): {
    store: IDBObjectStore
    definition: StoreDefinition<Schema[Store]>
  } {
    if (!this.active) throw inactiveError()
    this.signal?.throwIfAborted()
    if (!this.allowed.has(name)) throw new TypeError(`Store is outside transaction scope: ${name}`)
    try {
      return { store: this.transaction.objectStore(name), definition: this.definition.stores[name] }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'InvalidStateError') throw inactiveError()
      throw error
    }
  }

  private writeStore<Store extends Allowed>(name: Store) {
    if (!this.writable) throw new DOMException('Database transaction is readonly', 'ReadOnlyError')
    return this.store(name)
  }

  get<Store extends Allowed>(storeName: Store, key: Schema[Store]['key']): Promise<Schema[Store]['value'] | undefined> {
    return this.track(
      (async () => {
        const { store, definition } = this.store(storeName)
        assertDatabaseKey(key, definition.key)
        const value = await requestResult(store.get(key))
        this.signal?.throwIfAborted()
        return value === undefined ? undefined : cloneStoredValue(value as Schema[Store]['value'])
      })()
    )
  }

  scan<Store extends Allowed>(
    storeName: Store,
    options?: ScanOptions<Schema[Store]>
  ): Promise<readonly DatabaseItem<Schema[Store]['key'], Schema[Store]['value']>[]> {
    return this.track(
      (async () => {
        const { store, definition } = this.store(storeName)
        const query = validateQuery(definition, options, true)
        if (query.limit === 0) return []
        const range = toKeyRange(query)
        if (range === 'empty') return []
        const source: IDBObjectStore | IDBIndex = query.index ? store.index(query.index) : store
        const direction: IDBCursorDirection = query.direction === 'desc' ? 'prev' : 'next'
        return new Promise<readonly DatabaseItem<Schema[Store]['key'], Schema[Store]['value']>[]>((resolve, reject) => {
          const items: DatabaseItem<Schema[Store]['key'], Schema[Store]['value']>[] = []
          const request = source.openCursor(range, direction)
          request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB cursor failed')), {
            once: true
          })
          request.addEventListener('success', () => {
            try {
              this.signal?.throwIfAborted()
              const cursor = request.result
              if (!cursor || (query.limit !== undefined && items.length >= query.limit)) {
                resolve(items)
                return
              }
              const key = query.index ? cursor.primaryKey : cursor.key
              items.push({
                key: key as Schema[Store]['key'],
                value: cloneStoredValue(cursor.value as Schema[Store]['value'])
              })
              cursor.continue()
            } catch (error) {
              reject(error)
            }
          })
        })
      })()
    )
  }

  count<Store extends Allowed>(storeName: Store, options?: QueryOptions<Schema[Store]>): Promise<number> {
    return this.track(
      (async () => {
        const { store, definition } = this.store(storeName)
        const query = validateQuery(definition, options)
        const range = toKeyRange(query)
        if (range === 'empty') return 0
        const source: IDBObjectStore | IDBIndex = query.index ? store.index(query.index) : store
        const count = await requestResult(source.count(range))
        this.signal?.throwIfAborted()
        return count
      })()
    )
  }

  insert<Store extends Allowed>(
    storeName: Store,
    key: Schema[Store]['key'],
    value: Schema[Store]['value']
  ): Promise<InsertResult<Schema[Store]['value']>> {
    return this.track(
      (async () => {
        const { store, definition } = this.writeStore(storeName)
        assertDatabaseKey(key, definition.key)
        validateStoreValue(definition, value)
        return new Promise<InsertResult<Schema[Store]['value']>>((resolve, reject) => {
          const request = store.add(cloneValue(value), key)
          request.addEventListener(
            'success',
            () => {
              this.mutated.add(storeName)
              resolve({ inserted: true })
            },
            { once: true }
          )
          request.addEventListener(
            'error',
            (event) => {
              if (request.error?.name !== 'ConstraintError') {
                reject(request.error ?? new Error('IndexedDB insert failed'))
                return
              }
              event.preventDefault()
              event.stopPropagation()
              const existingRequest = store.get(key)
              requestResult(existingRequest).then((existing) => {
                if (existing === undefined) {
                  reject(new Error(`Database insert conflicted without an existing value: ${String(key)}`))
                  return
                }
                resolve({ inserted: false, existing: cloneStoredValue(existing as Schema[Store]['value']) })
              }, reject)
            },
            { once: true }
          )
        })
      })()
    )
  }

  put<Store extends Allowed>(
    storeName: Store,
    key: Schema[Store]['key'],
    value: Schema[Store]['value']
  ): Promise<void> {
    return this.track(
      (async () => {
        const { store, definition } = this.writeStore(storeName)
        assertDatabaseKey(key, definition.key)
        validateStoreValue(definition, value)
        await requestResult(store.put(cloneValue(value), key))
        this.mutated.add(storeName)
      })()
    )
  }

  delete<Store extends Allowed>(storeName: Store, key: Schema[Store]['key']): Promise<void> {
    return this.track(
      (async () => {
        const { store, definition } = this.writeStore(storeName)
        assertDatabaseKey(key, definition.key)
        await requestResult(store.delete(key))
        this.mutated.add(storeName)
      })()
    )
  }

  clear<Store extends Allowed>(storeName: Store): Promise<void> {
    return this.track(
      (async () => {
        const { store } = this.writeStore(storeName)
        await requestResult(store.clear())
        this.mutated.add(storeName)
      })()
    )
  }
}

export class IndexedDBDatabase<Schema extends DatabaseSchema<Schema>> implements Database<Schema> {
  private databasePromise: Promise<IDBDatabase> | null = null
  private readonly watchers = new Set<{ stores: ReadonlySet<string>; listener: () => void }>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly channel: BroadcastChannel | null
  private closed = false
  private closePromise: Promise<void> | null = null

  constructor(
    private readonly definition: DatabaseDefinition<Schema>,
    private readonly onWatcherError?: (error: unknown) => void
  ) {
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(definition.channelName)
    this.channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!Array.isArray(event.data) || !event.data.every((store) => typeof store === 'string')) return
      this.notify(event.data)
    })
  }

  private assertOpen() {
    if (this.closed) throw new Error('Database is closed')
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openDatabase(this.definition)
    return this.databasePromise
  }

  private track<Result>(operation: Promise<Result>): Promise<Result> {
    this.inFlight.add(operation)
    const releaseOwnership = () => this.inFlight.delete(operation)
    // The returned operation owns its result; both side outcomes perform only in-flight cleanup.
    void operation.then(releaseOwnership, releaseOwnership)
    return operation
  }

  private notify(stores: readonly string[]) {
    if (this.closed) return
    this.watchers.forEach((watcher) => {
      if (!stores.some((store) => watcher.stores.has(store))) return
      try {
        watcher.listener()
      } catch (error) {
        // A watcher failure never rolls back the committed write and never stops later listeners;
        // the composition-owned reporter (or direct console fallback) keeps the original Error.
        if (!this.onWatcherError) {
          console.error(error)
          return
        }
        try {
          this.onWatcherError(error)
        } catch (reporterError) {
          // Error delivery failure is independently diagnostic and cannot affect the committed
          // write or later watchers.
          console.error(reporterError)
        }
      }
    })
  }

  private execute<Stores extends readonly [StoreName<Schema>, ...StoreName<Schema>[]], Result>(
    stores: Stores,
    operation: (transaction: WriteTransaction<Schema, Stores[number]>) => Promise<Result>,
    writable: boolean,
    signal?: AbortSignal
  ): Promise<Result> {
    const available = !this.closed
    const task = (async () => {
      if (!available) throw new Error('Database is closed')
      const scope = validateScope(this.definition, stores)
      signal?.throwIfAborted()
      const database = await this.database()
      signal?.throwIfAborted()
      const transaction = database.transaction(scope, writable ? 'readwrite' : 'readonly')
      const settled = transactionResult(transaction).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      )
      const abort = () => {
        try {
          transaction.abort()
        } catch (error) {
          // IDBTransaction.abort() throws InvalidStateError only when the transaction already
          // reached its terminal committed/aborted state — that exact condition is benign.
          if (error instanceof DOMException && error.name === 'InvalidStateError') return
          console.error(error)
        }
      }
      let callbackSettled = false
      const wrapped = new IndexedDBTransaction(
        this.definition,
        transaction,
        new Set(scope),
        writable,
        () => {
          if (!callbackSettled) abort()
        },
        signal
      )
      let removeAbort = () => {}
      const aborted = new Promise<never>((_, reject) => {
        if (!signal) return
        const onAbort = () => {
          abort()
          reject(abortError(signal))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        removeAbort = () => signal.removeEventListener('abort', onAbort)
      })
      wrapped.observeCallback()
      let callback: Promise<Result>
      try {
        callback = operation(wrapped)
      } catch (error) {
        callback = Promise.reject(error)
      }
      void callback.then(
        () => {
          callbackSettled = true
        },
        () => {
          callbackSettled = true
        }
      )
      try {
        const result = await Promise.race([callback, aborted])
        callbackSettled = true
        signal?.throwIfAborted()
        wrapped.assertCallbackActive()
        wrapped.finish()
        const settlement = await settled
        if (!settlement.ok) throw settlement.error
        if (writable && wrapped.mutated.size > 0) {
          const mutated = [...wrapped.mutated]
          this.notify(mutated)
          this.channel?.postMessage(mutated)
        }
        return result
      } catch (error) {
        wrapped.finish()
        abort()
        const settlement = await settled
        // A distinct non-abort settlement failure is secondary to the callback/abort primary.
        // When settlement itself is the returned primary, identity equality prevents duplication.
        if (
          !settlement.ok &&
          settlement.error !== error &&
          !(settlement.error instanceof DOMException && settlement.error.name === 'AbortError')
        ) {
          console.error(settlement.error)
        }
        signal?.throwIfAborted()
        throw error
      } finally {
        wrapped.finish()
        removeAbort()
      }
    })()
    return this.track(task)
  }

  read<const Stores extends readonly [StoreName<Schema>, ...StoreName<Schema>[]], Result>(
    stores: Stores,
    operation: (transaction: ReadTransaction<Schema, Stores[number]>) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result> {
    return this.execute(stores, operation, false, signal)
  }

  write<const Stores extends readonly [StoreName<Schema>, ...StoreName<Schema>[]], Result>(
    stores: Stores,
    operation: (transaction: WriteTransaction<Schema, Stores[number]>) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result> {
    return this.execute(stores, operation, true, signal)
  }

  watch<const Stores extends readonly [StoreName<Schema>, ...StoreName<Schema>[]]>(
    stores: Stores,
    listener: () => void
  ): Unsubscribe {
    this.assertOpen()
    const watcher = { stores: new Set(validateScope(this.definition, stores)), listener }
    this.watchers.add(watcher)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.watchers.delete(watcher)
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.watchers.clear()
    this.closePromise = Promise.allSettled(this.inFlight).then(async () => {
      const database = await this.databasePromise?.catch(() => null)
      database?.close()
      this.channel?.close()
    })
    return this.closePromise
  }
}

export const createIndexedDBDatabase = <Schema extends DatabaseSchema<Schema>>(
  definition: DatabaseDefinition<Schema>,
  options?: { onWatcherError?: (error: unknown) => void }
): Database<Schema> => new IndexedDBDatabase(definition, options?.onWatcherError)

/**
 * A cross-tab deletion contender can hold the old store open indefinitely (Firefox preparation runs without
 * cross-tab locking); bound the blocked window so migration fails visibly instead of hanging forever.
 */
const MESSAGE_STORE_DELETION_BLOCKED_TIMEOUT_MS = 5000

const deleteMessageDatabase = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(STORAGE_NAME)
    let blockedTimer: ReturnType<typeof globalThis.setTimeout> | null = null
    const clearBlockedTimer = () => {
      if (blockedTimer === null) return
      globalThis.clearTimeout(blockedTimer)
      blockedTimer = null
    }
    request.addEventListener(
      'blocked',
      () => {
        console.warn('[WebChat] Message store reset is blocked')
        blockedTimer ??= globalThis.setTimeout(() => {
          reject(new Error('Message store deletion blocked'))
        }, MESSAGE_STORE_DELETION_BLOCKED_TIMEOUT_MS)
      },
      { once: true }
    )
    request.addEventListener(
      'success',
      () => {
        clearBlockedTimer()
        resolve()
      },
      { once: true }
    )
    request.addEventListener(
      'error',
      () => {
        clearBlockedTimer()
        reject(new Error('Message store deletion failed'))
      },
      { once: true }
    )
  })

export const prepareIndexedDBMessageDatabase = (coordinator?: PreparationLockCoordinator): Promise<void> => {
  const definition = createMessageDatabaseDefinition(STORAGE_NAME, MESSAGE_STORE_VERSION)

  return withPreparationLock(
    `message:${STORAGE_NAME}`,
    async (lock) => {
      try {
        const databases = await lock.read(indexedDB.databases())
        const existing = databases.find((database) => database.name === STORAGE_NAME)
        if (existing && existing.version !== MESSAGE_STORE_VERSION) {
          await lock.write(async () => {
            await deleteMessageDatabase()
          })
          lock.checkpoint()
        }

        const database = await lock.write(() => openDatabase(definition))
        database.close()
        lock.checkpoint()
      } catch (error) {
        if (lock.signal.aborted) throw error
        console.error('[WebChat] Message store preparation failed')
        throw new Error('Message store preparation failed')
      }
    },
    coordinator
  )
}

export const createIndexedDBMessageDatabase = (options?: {
  onWatcherError?: (error: unknown) => void
}): Database<MessageDatabaseSchema> =>
  createIndexedDBDatabase(createMessageDatabaseDefinition(STORAGE_NAME, MESSAGE_STORE_VERSION), options)
