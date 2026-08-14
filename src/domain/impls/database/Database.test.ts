import 'fake-indexeddb/auto'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/domain/externs/Database'
import { createMessageDatabaseDefinition, type MessageDatabaseSchema } from '@/domain/MessageStore'
import { createIndexedDBDatabase } from './IndexedDB'
import { createMemoryDatabase, createMemoryMessageDatabase } from './Memory'
import type { DatabaseDefinition } from './Definition'

interface Backend {
  readonly name: string
  create(name: string): Database<MessageDatabaseSchema>
}

const backends: Backend[] = [
  { name: 'Memory', create: createMemoryMessageDatabase },
  {
    name: 'IndexedDB',
    create: (name) => createIndexedDBDatabase(createMessageDatabaseDefinition(name, 2))
  }
]

let databaseId = 0
const opened = new Set<Database<MessageDatabaseSchema>>()
const names = new Set<string>()

const create = (backend: Backend, logicalName?: string) => {
  const name = logicalName ?? `database-contract-${backend.name}-${databaseId++}`
  names.add(name)
  const database = backend.create(name)
  opened.add(database)
  return database
}

const record = (value: string) => ({ value, nested: { count: 1 } })
const conflict = (eventId: string, value: string) => ({ eventId, value })

interface PortableKeySchema {
  items: {
    key: string | number
    value: { group: string }
    indexes: { byGroup: string }
  }
}

const portableDefinition = (name: string): DatabaseDefinition<PortableKeySchema> => ({
  name,
  version: 1,
  channelName: `${name}:WATCH`,
  stores: {
    items: {
      key: 'string-or-number',
      introducedIn: 1,
      indexes: { byGroup: { key: 'string', keyPath: 'group', introducedIn: 1 } }
    }
  }
})

const waitFor = async (assertion: () => void) => {
  await vi.waitFor(assertion, { timeout: 1000 })
}

afterEach(async () => {
  await Promise.all([...opened].map((database) => database.close()))
  opened.clear()
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

describe('IndexedDB output realm boundary', () => {
  it('normalizes foreign-realm duplicate winners, gets, and scans', async () => {
    const name = `database-foreign-realm-${databaseId++}`
    const definition = portableDefinition(name)
    const database = createIndexedDBDatabase(definition)
    const foreignValue = runInNewContext('({ group: "foreign" })') as { group: string }
    const nativeStructuredClone = globalThis.structuredClone.bind(globalThis)
    let passThroughForeignValue = false

    names.add(name)
    vi.stubGlobal('structuredClone', ((value: unknown, options?: StructuredSerializeOptions) => {
      if (value === foreignValue && passThroughForeignValue) {
        passThroughForeignValue = false
        return value
      }
      return nativeStructuredClone(value, options)
    }) as typeof structuredClone)

    await database.read(['items'], (transaction) => transaction.count('items'))
    const physical = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    passThroughForeignValue = true
    await new Promise<void>((resolve, reject) => {
      const transaction = physical.transaction('items', 'readwrite')
      transaction.objectStore('items').put(foreignValue, 'same')
      transaction.addEventListener('complete', () => resolve(), { once: true })
      transaction.addEventListener('error', () => reject(transaction.error), { once: true })
    })
    physical.close()

    expect(Object.getPrototypeOf(foreignValue)).not.toBe(Object.prototype)

    passThroughForeignValue = true
    const duplicateOperation = database.write(['items'], (transaction) =>
      transaction.insert('items', 'same', { group: 'challenger' })
    )
    const duplicate = await new Promise<Awaited<typeof duplicateOperation>>((resolve, reject) => {
      const timeout = globalThis.setTimeout(
        () => reject(new Error('Foreign-realm duplicate conflict did not settle')),
        250
      )
      duplicateOperation.then(
        (result) => {
          globalThis.clearTimeout(timeout)
          resolve(result)
        },
        (error) => {
          globalThis.clearTimeout(timeout)
          reject(error)
        }
      )
    })
    expect(duplicate).toEqual({ inserted: false, existing: foreignValue })
    if (!duplicate.inserted) expect(Object.getPrototypeOf(duplicate.existing)).toBe(Object.prototype)

    passThroughForeignValue = true
    const value = await database.read(['items'], (transaction) => transaction.get('items', 'same'))
    expect(value).toEqual(foreignValue)
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)

    passThroughForeignValue = true
    const items = await database.read(['items'], (transaction) => transaction.scan('items'))
    expect(items).toEqual([{ key: 'same', value: foreignValue }])
    expect(Object.getPrototypeOf(items[0]?.value)).toBe(Object.prototype)
    await database.close()
  })
})

describe.each(backends)('$name Database contract', (backend) => {
  it('enforces non-empty duplicate-free scope and enlisted store access', async () => {
    const database = create(backend)

    await expect(database.read([] as never, async () => null)).rejects.toThrow('must not be empty')
    await expect(database.read(['records', 'records'] as never, async () => null)).rejects.toThrow(
      'must not contain duplicates'
    )
    await expect(
      database.read(['records'], async (transaction) =>
        (transaction as unknown as { get(store: string, key: string): Promise<unknown> }).get('conflicts', 'key')
      )
    ).rejects.toThrow('outside transaction scope')
    await expect(database.read(['missing'] as never, async () => null)).rejects.toThrow('Unknown database store')
  })

  it('closes the transaction callback active window across external waits', async () => {
    const database = create(backend)

    await expect(
      database.read(['records'], async (transaction) => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        return transaction.count('records')
      })
    ).rejects.toMatchObject({ name: 'TransactionInactiveError' })
  })

  it('rejects a callback that externally settles without another transaction call', async () => {
    const database = create(backend)

    await expect(
      database.read(['records'], async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'externally-settled'
      })
    ).rejects.toMatchObject({ name: 'TransactionInactiveError' })
  })

  it('rolls a completed write request back when its callback later rejects', async () => {
    const database = create(backend)
    const listener = vi.fn()
    database.watch(['records'], listener)

    await expect(
      database.write(['records'], async (transaction) => {
        await transaction.insert('records', 'record-1', record('first'))
        await new Promise((resolve) => setTimeout(resolve, 10))
        throw new Error('callback rejected')
      })
    ).rejects.toThrow('callback rejected')

    await expect(database.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(0)
    expect(listener).not.toHaveBeenCalled()
  })

  it('commits multi-store writes atomically and rolls callback failures back', async () => {
    const database = create(backend)

    await expect(
      database.write(['records', 'conflicts'], async (transaction) => {
        await transaction.insert('records', 'record-1', record('first'))
        await transaction.insert('conflicts', 'conflict-1', conflict('record-1', 'first'))
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')
    await expect(
      database.read(['records', 'conflicts'], async (transaction) => [
        await transaction.count('records'),
        await transaction.count('conflicts')
      ])
    ).resolves.toEqual([0, 0])

    await database.write(['records', 'conflicts'], async (transaction) => {
      await Promise.all([
        transaction.insert('records', 'record-1', record('first')),
        transaction.insert('conflicts', 'conflict-1', conflict('record-1', 'first'))
      ])
    })
    await expect(
      database.read(['records', 'conflicts'], async (transaction) => [
        await transaction.count('records'),
        await transaction.count('conflicts')
      ])
    ).resolves.toEqual([1, 1])
  })

  it('aborts before commit without persistence or watch notification', async () => {
    const database = create(backend)
    const listener = vi.fn()
    database.watch(['records'], listener)
    const controller = new AbortController()

    await expect(
      database.write(
        ['records'],
        async (transaction) => {
          await transaction.insert('records', 'record-1', record('first'))
          controller.abort()
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(database.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(0)
    expect(listener).not.toHaveBeenCalled()
  })

  it('settles an aborted pending callback and lets close drain', async () => {
    const database = create(backend)
    const controller = new AbortController()
    let markEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const pending = database.read(
      ['records'],
      async () => {
        markEntered()
        return new Promise<never>(() => {})
      },
      controller.signal
    )

    await entered
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect(database.close()).resolves.toBeUndefined()
  })

  it('returns one exact isolated existing winner for concurrent inserts', async () => {
    const name = `database-collision-${backend.name}-${databaseId++}`
    const first = create(backend, name)
    const second = create(backend, name)
    const values = [record('first'), record('second')]

    const results = await Promise.all([
      first.write(['records'], (transaction) => transaction.insert('records', 'same', values[0])),
      second.write(['records'], (transaction) => transaction.insert('records', 'same', values[1]))
    ])
    expect(results.filter((result) => result.inserted)).toHaveLength(1)
    const loser = results.find((result) => !result.inserted)
    const winner = await first.read(['records'], (transaction) => transaction.get('records', 'same'))
    expect(loser).toEqual({ inserted: false, existing: winner })
    if (loser && !loser.inserted) {
      ;(loser.existing as { nested: { count: number } }).nested.count = 99
    }
    await expect(first.read(['records'], (transaction) => transaction.get('records', 'same'))).resolves.toEqual(winner)
  })

  it('orders primary and index scans with deterministic bounds, tie-breaks, direction, and limits', async () => {
    const database = create(backend)
    await database.write(['records', 'conflicts'], async (transaction) => {
      await Promise.all([
        transaction.insert('records', 'b', record('b')),
        transaction.insert('records', 'a', record('a')),
        transaction.insert('records', 'c', record('c')),
        transaction.insert('conflicts', 'z', conflict('group-a', 'z')),
        transaction.insert('conflicts', 'a', conflict('group-a', 'a')),
        transaction.insert('conflicts', 'm', conflict('group-b', 'm'))
      ])
    })

    await expect(database.read(['records'], (transaction) => transaction.scan('records'))).resolves.toMatchObject([
      { key: 'a' },
      { key: 'b' },
      { key: 'c' }
    ])
    await expect(
      database.read(['records'], (transaction) =>
        transaction.scan('records', { range: { lower: 'a', upper: 'c', lowerOpen: true }, direction: 'desc', limit: 1 })
      )
    ).resolves.toMatchObject([{ key: 'c' }])
    await expect(
      database.read(['conflicts'], (transaction) => transaction.scan('conflicts', { index: 'byEventId' }))
    ).resolves.toMatchObject([{ key: 'a' }, { key: 'z' }, { key: 'm' }])
    await expect(
      database.read(['conflicts'], (transaction) =>
        transaction.scan('conflicts', { index: 'byEventId', direction: 'desc' })
      )
    ).resolves.toMatchObject([{ key: 'm' }, { key: 'z' }, { key: 'a' }])
    await expect(
      database.read(['records'], (transaction) =>
        transaction.scan('records', { range: { lower: 'a', upper: 'a', upperOpen: true } })
      )
    ).resolves.toEqual([])
  })

  it('orders the complete portable string-or-finite-number key domain', async () => {
    const name = `database-portable-keys-${backend.name}-${databaseId++}`
    names.add(name)
    const definition = portableDefinition(name)
    const database = backend.name === 'Memory' ? createMemoryDatabase(definition) : createIndexedDBDatabase(definition)

    await database.write(['items'], async (transaction) => {
      await Promise.all([
        transaction.insert('items', 'a', { group: 'same' }),
        transaction.insert('items', 10, { group: 'same' }),
        transaction.insert('items', 2, { group: 'same' })
      ])
    })
    await expect(database.read(['items'], (transaction) => transaction.scan('items'))).resolves.toMatchObject([
      { key: 2 },
      { key: 10 },
      { key: 'a' }
    ])
    await expect(
      database.write(['items'], (transaction) => transaction.insert('items', Number.NaN, { group: 'same' }))
    ).rejects.toThrow('finite numbers')
    await database.close()
  })

  it('rejects invalid keys, indexes, ranges, limits, and canonical values', async () => {
    const database = create(backend)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const sparse = Array(2)
    sparse[1] = 'value'

    await expect(
      database.write(['records'], (transaction) => transaction.insert('records', Number.NaN as never, record('x')))
    ).rejects.toThrow('finite numbers')
    await expect(
      database.read(['records'], (transaction) => transaction.scan('records', { index: 'missing' } as never))
    ).rejects.toThrow('Unknown database index')
    await expect(
      database.read(['records'], (transaction) => transaction.scan('records', { range: { lower: 'z', upper: 'a' } }))
    ).rejects.toThrow('lower bound exceeds')
    await expect(
      database.read(['records'], (transaction) => transaction.scan('records', { range: { lowerOpen: true } } as never))
    ).rejects.toThrow('lowerOpen requires lower')
    await expect(
      database.read(['records'], (transaction) => transaction.scan('records', { limit: -1 }))
    ).rejects.toThrow('non-negative safe integer')
    await expect(
      database.read(['records'], (transaction) =>
        transaction.scan('records', { range: { lower: 'a', lowerOpen: 'yes' } } as never)
      )
    ).rejects.toThrow('lowerOpen must be a boolean')
    await expect(
      database.read(['records'], (transaction) => transaction.scan('records', { unexpected: true } as never))
    ).rejects.toThrow('unknown field')

    // functional-loop: owner-commit — ordered per-item emission with no bulk primitive

    // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
    for (const value of [undefined, Number.POSITIVE_INFINITY, 1n, new Date(), new Map(), sparse, cyclic]) {
      await expect(
        database.write(['records'], (transaction) => transaction.insert('records', 'invalid', value))
      ).rejects.toThrow()
    }
    await expect(database.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(0)
  })

  it('isolates nested values until an explicit put replaces them', async () => {
    const database = create(backend)
    await database.write(['records'], (transaction) => transaction.insert('records', 'record-1', record('first')))

    const value = (await database.read(['records'], (transaction) => transaction.get('records', 'record-1'))) as {
      value: string
      nested: { count: number }
    }
    value.nested.count = 9
    await expect(database.read(['records'], (transaction) => transaction.get('records', 'record-1'))).resolves.toEqual(
      record('first')
    )

    await database.write(['records'], (transaction) => transaction.put('records', 'record-1', value))
    await expect(database.read(['records'], (transaction) => transaction.get('records', 'record-1'))).resolves.toEqual(
      value
    )
  })

  it('invalidates each watching instance once per relevant commit and isolates listener failures', async () => {
    const name = `database-watch-${backend.name}-${databaseId++}`
    const writer = create(backend, name)
    const reader = create(backend, name)
    const throwing = vi.fn(() => {
      throw new Error('listener failure')
    })
    const listener = vi.fn()
    const unsubscribeThrowing = reader.watch(['records'], throwing)
    const unsubscribe = reader.watch(['records'], listener)

    await writer.write(['records', 'conflicts'], async (transaction) => {
      await Promise.all([
        transaction.insert('records', 'record-1', record('first')),
        transaction.insert('conflicts', 'conflict-1', conflict('record-1', 'first'))
      ])
    })
    await waitFor(() => {
      expect(throwing).toHaveBeenCalledOnce()
      expect(listener).toHaveBeenCalledOnce()
    })

    await writer.write(['records'], (transaction) => transaction.insert('records', 'record-1', record('second')))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(listener).toHaveBeenCalledOnce()

    unsubscribe()
    unsubscribe()
    unsubscribeThrowing()
    await writer.write(['records'], (transaction) => transaction.put('records', 'record-1', record('next')))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(listener).toHaveBeenCalledOnce()
  })

  it('closes idempotently, drains started work, and rejects new operations and watches', async () => {
    const name = `database-close-${backend.name}-${databaseId++}`
    const database = create(backend, name)
    const observer = create(backend, name)
    const listener = vi.fn()
    observer.watch(['records'], listener)
    const started = database.write(['records'], (transaction) =>
      transaction.insert('records', 'record-1', record('first'))
    )
    const firstClose = database.close()
    const secondClose = database.close()

    await expect(started).resolves.toEqual({ inserted: true })
    await expect(firstClose).resolves.toBeUndefined()
    await expect(secondClose).resolves.toBeUndefined()
    await waitFor(() => expect(listener).toHaveBeenCalledOnce())
    await expect(observer.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(1)
    await expect(database.read(['records'], (transaction) => transaction.count('records'))).rejects.toThrow(
      'Database is closed'
    )
    expect(() => database.watch(['records'], () => {})).toThrow('Database is closed')
  })
})
