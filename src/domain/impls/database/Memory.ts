import type {
  Database,
  DatabaseItem,
  DatabaseKey,
  DatabaseSchema,
  InsertResult,
  QueryOptions,
  ReadTransaction,
  ScanOptions,
  WriteTransaction
} from '@/domain/externs/Database'
import type { Unsubscribe } from '@/domain/Subscription'
import { createMessageDatabaseDefinition, type MessageDatabaseSchema } from '@/domain/MessageStore'
import {
  assertDatabaseKey,
  cloneValue,
  compareDatabaseKeys,
  getPathValue,
  keyInRange,
  validateQuery,
  validateScope,
  validateStoreValue,
  type DatabaseDefinition,
  type StoreDefinition
} from './Definition'

type StoreName<Schema> = keyof Schema & string
type StoreMap = Map<DatabaseKey, unknown>

interface MemoryInstance {
  notify(stores: readonly string[]): void
}

interface MemoryState {
  readonly stores: Map<string, StoreMap>
  readonly instances: Set<MemoryInstance>
  tail: Promise<void>
}

const states = new Map<string, MemoryState>()

const getState = <Schema extends DatabaseSchema<Schema>>(definition: DatabaseDefinition<Schema>): MemoryState => {
  let state = states.get(definition.name)
  if (!state) {
    state = {
      stores: new Map(Object.keys(definition.stores).map((store) => [store, new Map()])),
      instances: new Set(),
      tail: Promise.resolve()
    }
    states.set(definition.name, state)
  }
  return state
}

const abortError = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('Aborted', 'AbortError')

/** The original returned/emitted Promise remains the sole product owner of its rejection; this
 * named observer only settles a derived side branch so it can never become an unhandled
 * rejection, and it intentionally records nothing further for the same Error. */
const observeDerivedRejection = () => undefined

class MemoryTransaction<
  Schema extends DatabaseSchema<Schema>,
  Allowed extends StoreName<Schema>
> implements WriteTransaction<Schema, Allowed> {
  readonly mutated = new Set<string>()
  private active = true
  private idleTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  constructor(
    private readonly definition: DatabaseDefinition<Schema>,
    private readonly stores: Map<string, StoreMap>,
    private readonly allowed: ReadonlySet<string>,
    private readonly writable: boolean,
    private readonly signal?: AbortSignal
  ) {
    this.idle()
  }

  finish() {
    this.active = false
    if (this.idleTimer !== null) globalThis.clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  assertActive() {
    if (!this.active) throw new DOMException('Database transaction is inactive', 'TransactionInactiveError')
  }

  private touch() {
    if (this.idleTimer !== null) globalThis.clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private idle() {
    this.touch()
    this.idleTimer = globalThis.setTimeout(() => {
      this.active = false
      this.idleTimer = null
    }, 0)
  }

  private store<Store extends Allowed>(
    name: Store
  ): {
    data: StoreMap
    definition: StoreDefinition<Schema[Store]>
  } {
    this.assertActive()
    this.touch()
    this.signal?.throwIfAborted()
    if (!this.allowed.has(name)) throw new TypeError(`Store is outside transaction scope: ${name}`)
    const data = this.stores.get(name)
    if (!data) throw new TypeError(`Unknown database store: ${name}`)
    return { data, definition: this.definition.stores[name] }
  }

  private writeStore<Store extends Allowed>(name: Store) {
    if (!this.writable) throw new DOMException('Database transaction is readonly', 'ReadOnlyError')
    return this.store(name)
  }

  async get<Store extends Allowed>(
    store: Store,
    key: Schema[Store]['key']
  ): Promise<Schema[Store]['value'] | undefined> {
    const { data, definition } = this.store(store)
    assertDatabaseKey(key, definition.key)
    const value = data.get(key)
    this.idle()
    return value === undefined ? undefined : cloneValue(value as Schema[Store]['value'])
  }

  async scan<Store extends Allowed>(
    store: Store,
    options?: ScanOptions<Schema[Store]>
  ): Promise<readonly DatabaseItem<Schema[Store]['key'], Schema[Store]['value']>[]> {
    const { data, definition } = this.store(store)
    const query = validateQuery(definition, options, true)
    if (query.limit === 0) {
      this.idle()
      return []
    }
    const indexDefinition = query.index
      ? (definition.indexes as Record<string, { keyPath: string }>)[query.index]
      : undefined
    const items = [...data].flatMap(([key, value]) => {
      const queryKey = indexDefinition ? getPathValue(value, indexDefinition.keyPath) : key
      if (typeof queryKey !== 'string' && typeof queryKey !== 'number') return []
      return keyInRange(queryKey, query.range) ? [{ key, value, queryKey }] : []
    })
    const sorted = items.toSorted((left, right) => {
      const order = compareDatabaseKeys(left.queryKey, right.queryKey) || compareDatabaseKeys(left.key, right.key)
      return query.direction === 'desc' ? -order : order
    })
    const selected = query.limit === undefined ? sorted : sorted.slice(0, query.limit)
    this.idle()
    return selected.map(({ key, value }) => ({
      key: key as Schema[Store]['key'],
      value: cloneValue(value as Schema[Store]['value'])
    }))
  }

  async count<Store extends Allowed>(store: Store, options?: QueryOptions<Schema[Store]>): Promise<number> {
    const { data, definition } = this.store(store)
    const query = validateQuery(definition, options)
    const indexDefinition = query.index
      ? (definition.indexes as Record<string, { keyPath: string }>)[query.index]
      : undefined
    const count = [...data].reduce((acc, [key, value]) => {
      const queryKey = indexDefinition ? getPathValue(value, indexDefinition.keyPath) : key
      return (typeof queryKey === 'string' || typeof queryKey === 'number') && keyInRange(queryKey, query.range)
        ? acc + 1
        : acc
    }, 0)
    this.idle()
    return count
  }

  async insert<Store extends Allowed>(
    store: Store,
    key: Schema[Store]['key'],
    value: Schema[Store]['value']
  ): Promise<InsertResult<Schema[Store]['value']>> {
    const { data, definition } = this.writeStore(store)
    assertDatabaseKey(key, definition.key)
    validateStoreValue(definition, value)
    const existing = data.get(key)
    if (existing !== undefined) {
      this.idle()
      return { inserted: false, existing: cloneValue(existing as Schema[Store]['value']) }
    }
    data.set(key, cloneValue(value))
    this.mutated.add(store)
    this.idle()
    return { inserted: true }
  }

  async put<Store extends Allowed>(
    store: Store,
    key: Schema[Store]['key'],
    value: Schema[Store]['value']
  ): Promise<void> {
    const { data, definition } = this.writeStore(store)
    assertDatabaseKey(key, definition.key)
    validateStoreValue(definition, value)
    data.set(key, cloneValue(value))
    this.mutated.add(store)
    this.idle()
  }

  async delete<Store extends Allowed>(store: Store, key: Schema[Store]['key']): Promise<void> {
    const { data, definition } = this.writeStore(store)
    assertDatabaseKey(key, definition.key)
    data.delete(key)
    this.mutated.add(store)
    this.idle()
  }

  async clear<Store extends Allowed>(store: Store): Promise<void> {
    const { data } = this.writeStore(store)
    data.clear()
    this.mutated.add(store)
    this.idle()
  }
}

export class MemoryDatabase<Schema extends DatabaseSchema<Schema>> implements Database<Schema>, MemoryInstance {
  private readonly state: MemoryState
  private readonly watchers = new Set<{ stores: ReadonlySet<string>; listener: () => void }>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private closed = false
  private closePromise: Promise<void> | null = null

  constructor(
    private readonly definition: DatabaseDefinition<Schema>,
    private readonly onWatcherError?: (error: unknown) => void
  ) {
    this.state = getState(definition)
    this.state.instances.add(this)
  }

  private assertOpen() {
    if (this.closed) throw new Error('Database is closed')
  }

  private track<Result>(operation: Promise<Result>): Promise<Result> {
    this.inFlight.add(operation)
    // The returned operation stays the sole failure owner; the derived branch only maintains the
    // in-flight set, and its rejection is observed so it cannot become an unhandled rejection.
    void operation.finally(() => this.inFlight.delete(operation)).catch(observeDerivedRejection)
    return operation
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
      let release!: () => void
      const previous = this.state.tail
      this.state.tail = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      try {
        signal?.throwIfAborted()
        const working = new Map(
          [...this.state.stores].map(([name, data]) => [
            name,
            new Map([...data].map(([key, value]) => [key, cloneValue(value)]))
          ])
        )
        const transaction = new MemoryTransaction(this.definition, working, new Set(scope), writable, signal)
        let removeAbort = () => {}
        const aborted = new Promise<never>((_, reject) => {
          if (!signal) return
          const onAbort = () => reject(abortError(signal))
          signal.addEventListener('abort', onAbort, { once: true })
          removeAbort = () => signal.removeEventListener('abort', onAbort)
        })
        try {
          const result = await Promise.race([operation(transaction), aborted])
          transaction.assertActive()
          signal?.throwIfAborted()
          transaction.finish()
          if (writable && transaction.mutated.size > 0) {
            transaction.mutated.forEach((store) => this.state.stores.set(store, working.get(store) ?? new Map()))
            this.state.instances.forEach((instance) => instance.notify([...transaction.mutated]))
          }
          return result
        } finally {
          transaction.finish()
          removeAbort()
        }
      } finally {
        release()
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

  notify(stores: readonly string[]): void {
    if (this.closed) return
    this.watchers.forEach((watcher) => {
      if (!stores.some((store) => watcher.stores.has(store))) return
      try {
        watcher.listener()
      } catch (error) {
        // A watcher failure never rolls back the committed write and never stops later listeners;
        // the composition-owned reporter (or direct console fallback) keeps the original Error.
        if (this.onWatcherError) this.onWatcherError(error)
        else console.error(error)
      }
    })
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.watchers.clear()
    this.state.instances.delete(this)
    this.closePromise = Promise.allSettled(this.inFlight).then(() => {})
    return this.closePromise
  }
}

export const createMemoryDatabase = <Schema extends DatabaseSchema<Schema>>(
  definition: DatabaseDefinition<Schema>,
  options?: { onWatcherError?: (error: unknown) => void }
): Database<Schema> => new MemoryDatabase(definition, options?.onWatcherError)

export const createMemoryMessageDatabase = (
  name: string,
  options?: { onWatcherError?: (error: unknown) => void }
): Database<MessageDatabaseSchema> => createMemoryDatabase(createMessageDatabaseDefinition(name, 2), options)
