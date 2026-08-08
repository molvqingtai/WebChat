import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/domain/externs/Database'
import { createIndexedDBDatabase } from '@/domain/impls/database/IndexedDB'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import {
  createMessageDatabaseDefinition,
  createMessageStore,
  type MessageDatabaseSchema,
  type MessageQuery,
  type MessageStore
} from '@/domain/MessageStore'
import {
  MESSAGE_RECORD_TYPE,
  NOTICE_TYPE,
  type MessageRecord,
  type SystemNoticeRecord,
  type TextMessageRecord
} from '@/domain/Message'
import { MESSAGE_TYPE } from '@/protocol/ChatRoom'

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

const USER = { id: 'user-1', name: 'User', avatar: '' }
let databaseId = 0
const opened = new Set<Database<MessageDatabaseSchema>>()
const names = new Set<string>()

declare const typedMessageStore: MessageStore

const messageQueryTypeContract = () => {
  void typedMessageStore.query()
  void typedMessageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
  void typedMessageStore.query({ signal: new AbortController().signal })
  // @ts-expect-error MessageQuery has no history or Database scan criteria
  void typedMessageStore.query({ limit: 1 })
  // @ts-expect-error MessageQuery accepts only the exact outer discriminator
  void typedMessageStore.query({ type: 'message' })
  // @ts-expect-error MessageStore query has no second argument
  void typedMessageStore.query({}, new AbortController().signal)
}

const create = (backend: Backend) => {
  const name = `message-store-${backend.name}-${databaseId++}`
  names.add(name)
  const database = backend.create(name)
  opened.add(database)
  return { database, messageStore: createMessageStore(database) }
}

const textRecord = (id: string, body = id, receivedAt = 1): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.TEXT,
    id,
    hlc: { timestamp: 1, counter: 0 },
    userId: USER.id,
    body,
    mentions: []
  },
  user: USER,
  receivedAt
})

const noticeRecord = (id: string): SystemNoticeRecord => ({
  type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
  id,
  notice: {
    id,
    hlc: { timestamp: 2, counter: 0 },
    type: NOTICE_TYPE.INFO,
    body: 'notice'
  },
  user: USER,
  receivedAt: 2
})

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
})

describe('MessageStore static contract', () => {
  it('exposes one optional typed query object and no second argument', () => {
    expect(messageQueryTypeContract).toBeTypeOf('function')
  })
})

describe.each(backends)('$name MessageStore contract', (backend) => {
  it('classifies a reordered-key receivedAt-only replay as existing with no conflict', async () => {
    const { database, messageStore } = create(backend)
    const first = textRecord('reorder-id', 'first', 1)
    await expect(messageStore.insert(first)).resolves.toEqual({ inserted: true })
    // The stored occupant may have been written with a different property insertion order: the
    // canonical comparison is structural, so the same-ID value differing only in the top-level
    // receivedAt is still a replay (first row retained, no conflict).
    const reorderedRaw = JSON.parse(
      JSON.stringify({ ...first, receivedAt: 99 }, ['receivedAt', 'message', 'type', 'id', 'user'])
    )
    await database.write(['records'], (transaction) => transaction.insert('records', 'reorder-id', reorderedRaw))
    const replay = await messageStore.insert({ ...first, receivedAt: 99 })
    expect(replay.inserted).toBe(false)
    if (!replay.inserted) expect(replay.existing).toEqual({ ...first, receivedAt: 99 })
    await expect(messageStore.query()).resolves.toEqual([first])
    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(0)
  })

  it('classifies a receivedAt-only replay as existing with no conflict', async () => {
    const { database, messageStore } = create(backend)
    const first = textRecord('replay-id', 'first', 1)
    await expect(messageStore.insert(first)).resolves.toEqual({ inserted: true })
    // `receivedAt` is receiver-local metadata, not canonical identity: a same-ID value identical
    // except the top-level receivedAt is a replay — keep the first row, no conflict.
    const replay = await messageStore.insert({ ...first, receivedAt: 99 })
    expect(replay.inserted).toBe(false)
    if (!replay.inserted) expect(replay.existing).toEqual({ ...first, receivedAt: 99 })
    await expect(messageStore.query()).resolves.toEqual([first])
    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(0)
  })

  it('keeps the first stored value and compares duplicate content without protocol parsing', async () => {
    const { messageStore } = create(backend)
    const first = textRecord('message-1', 'first', 1)

    await expect(messageStore.insert(first)).resolves.toEqual({ inserted: true })
    // An exact duplicate is content-equal and returns the typed record as existing.
    await expect(messageStore.insert(first)).resolves.toEqual({ inserted: false, existing: first })
    await expect(messageStore.query()).resolves.toEqual([first])
  })

  it('preserves the first stored value and records content and cross-variant id conflicts', async () => {
    const { database, messageStore } = create(backend)
    const first = textRecord('shared-id', 'first')
    const changed = textRecord('shared-id', 'different')

    await messageStore.insert(first)
    // The conflict result exposes the raw stored value as unknown, never as a typed record.
    const changedResult = await messageStore.insert(changed)
    expect(changedResult.inserted).toBe(false)
    if (!changedResult.inserted) expect(changedResult.existing).toMatchObject({ id: 'shared-id' })
    const crossVariantResult = await messageStore.insert(noticeRecord('shared-id'))
    expect(crossVariantResult.inserted).toBe(false)
    if (!crossVariantResult.inserted) expect(crossVariantResult.existing).toMatchObject({ id: 'shared-id' })
    await expect(messageStore.query()).resolves.toEqual([first])
    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(2)
  })

  it('bounds different-content diagnostics per outer record id', async () => {
    const { database, messageStore } = create(backend)
    await messageStore.insert(textRecord('bounded', 'first'))

    for (let index = 0; index < 6; index += 1) {
      await messageStore.insert(textRecord('bounded', `conflict-${index}`))
    }

    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(4)
    await expect(messageStore.query()).resolves.toEqual([textRecord('bounded', 'first')])
  })

  it('isolates records outside the strict outer-type union', async () => {
    const invalid: Array<{ key: string; value: unknown }> = [
      { key: 'legacy', value: { event: textRecord('legacy').message, user: USER, receivedAt: 1 } },
      {
        key: 'missing-type',
        value: { id: 'missing-type', message: textRecord('missing-type').message, user: USER, receivedAt: 1 }
      },
      {
        key: 'unknown-field',
        value: { ...textRecord('unknown-field'), unknown: true }
      },
      {
        key: 'property-shape',
        value: {
          ...noticeRecord('property-shape'),
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE
        }
      }
    ]

    for (const item of invalid) {
      const { database, messageStore } = create(backend)
      const valid = textRecord(`valid-${item.key}`)
      await database.write(['records'], (transaction) => transaction.insert('records', item.key, item.value))
      await messageStore.insert(valid)

      await expect(messageStore.query()).resolves.toEqual([valid])
      await expect(database.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(2)
      await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(1)
    }
  })

  it('loads records whose key/identity/user relationships differ (relationships are unvalidated)', async () => {
    const { database } = create(backend)
    // The declarative record schema cannot express key/identity/user equality, so a stored row
    // with a mismatched key, outer id, or user id is still accepted at load.
    const equalityRows: Array<{ key: string; value: unknown }> = [
      { key: 'wrong-key', value: textRecord('different-id') },
      { key: 'outer-mismatch', value: { ...textRecord('outer-mismatch'), id: 'other' } },
      { key: 'user-mismatch', value: { ...textRecord('user-mismatch'), user: { ...USER, id: 'other-user' } } }
    ]
    for (const { key, value } of equalityRows) {
      const { database: db, messageStore: store } = create(backend)
      await db.write(['records'], (transaction) => transaction.insert('records', key, value))
      await expect(store.query()).resolves.toEqual([value])
    }
    await expect(database.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(0)
  })

  it('accepts finite fractional receivedAt values for both record variants at load', async () => {
    const { database, messageStore } = create(backend)
    const fractionalChat = { ...textRecord('fractional-chat'), receivedAt: 1.5 }
    const fractionalNotice = {
      ...noticeRecord('fractional-notice'),
      receivedAt: 1.5
    }
    await database.write(['records'], async (transaction) => {
      await transaction.insert('records', 'fractional-chat', fractionalChat)
      await transaction.insert('records', 'fractional-notice', fractionalNotice)
    })
    // The record schemas use the declarative v.finite() action for both variants.
    await expect(messageStore.query()).resolves.toEqual([fractionalChat, fractionalNotice])
  })

  it('accepts finite fractional receivedAt values at load (persisted format is a finite number)', async () => {
    const { database, messageStore } = create(backend)
    const fractional = { ...textRecord('fractional'), receivedAt: 1.5 }
    await database.write(['records'], (transaction) => transaction.insert('records', 'fractional', fractional))
    // The record schema uses the declarative v.finite() action, so fractional values remain
    // loadable; the database layer itself rejects non-finite numbers before storage.
    await expect(messageStore.query()).resolves.toEqual([fractional])
  })

  it('trusts typed inputs at write and omits invalid stored values at load', async () => {
    const { messageStore } = create(backend)
    // Persistence write does not validate protocol shape: typed inputs are trusted.
    const prefixedButUntyped = {
      id: 'chat-message:looks-typed',
      message: textRecord('chat-message:looks-typed').message,
      user: USER,
      receivedAt: 1
    }

    for (const input of [prefixedButUntyped, { id: 'missing-fields' }]) {
      await expect(messageStore.insert(input as unknown as MessageRecord)).resolves.toEqual({ inserted: true })
    }
    await expect(messageStore.query()).resolves.toEqual([])
    const valid = textRecord('valid-after-invalid-input')
    await expect(messageStore.insert(valid)).resolves.toEqual({ inserted: true })
    await expect(messageStore.query()).resolves.toEqual([valid])
  })

  it('queries one primary scan in order and filters only by exact outer type', async () => {
    const { database, messageStore } = create(backend)
    await messageStore.insert(textRecord('z-chat'))
    await messageStore.insert(noticeRecord('a-notice'))
    await messageStore.insert(textRecord('m-chat'))
    const read = vi.spyOn(database, 'read')

    await expect(messageStore.query()).resolves.toEqual([
      noticeRecord('a-notice'),
      textRecord('m-chat'),
      textRecord('z-chat')
    ])
    expect(read).toHaveBeenCalledOnce()
    await expect(messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })).resolves.toEqual([
      textRecord('m-chat'),
      textRecord('z-chat')
    ])
    await expect(messageStore.query({ type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE })).resolves.toEqual([
      noticeRecord('a-notice')
    ])
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('strictly decodes and isolates the complete physical scan before filtering by type', async () => {
    const { database, messageStore } = create(backend)
    await messageStore.insert(textRecord('valid-chat'))
    await messageStore.insert(noticeRecord('valid-notice'))
    await database.write(['records'], (transaction) =>
      transaction.insert('records', 'invalid-notice', {
        ...noticeRecord('invalid-notice'),
        notice: { id: 'invalid-notice', hlc: { timestamp: 2, counter: 0 }, type: NOTICE_TYPE.INFO }
      })
    )

    await expect(messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })).resolves.toEqual([
      textRecord('valid-chat')
    ])
    await expect(messageStore.query()).resolves.toEqual([textRecord('valid-chat'), noticeRecord('valid-notice')])
    await expect(database.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(3)
    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(1)
  })

  it('keeps an all-invalid store operational and bounds diagnostics without deleting raw rows', async () => {
    const { database, messageStore } = create(backend)
    const listener = vi.fn()
    const unsubscribe = messageStore.watch(listener)

    for (let version = 0; version < 6; version += 1) {
      await database.write(['records'], (transaction) =>
        transaction.put('records', 'legacy-record', { legacy: true, version })
      )
      await expect(messageStore.query()).resolves.toEqual([])
    }

    expect(listener).toHaveBeenCalledTimes(6)
    await expect(database.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(1)
    await expect(
      database.read(['records'], (transaction) => transaction.get('records', 'legacy-record'))
    ).resolves.toEqual({ legacy: true, version: 5 })
    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(4)

    const valid = textRecord('valid-after-invalid')
    await messageStore.insert(valid)
    await expect(messageStore.query()).resolves.toEqual([valid])
    unsubscribe()
  })

  it('rejects invalid query shapes, unknown own fields, types, and signals before reading', async () => {
    const { database, messageStore } = create(backend)
    const read = vi.spyOn(database, 'read')
    const unknownSymbol = Symbol('unknown')
    const invalid = [
      null,
      [],
      new (class Query {})(),
      { limit: 1 },
      { [unknownSymbol]: true },
      { type: 'message' },
      { signal: {} }
    ]

    for (const query of invalid) {
      await expect(messageStore.query(query as MessageQuery)).rejects.toThrow(TypeError)
    }
    expect(read).not.toHaveBeenCalled()
  })

  it('watches canonical commits, ignores conflict-only writes, and clears both stores explicitly', async () => {
    const { database, messageStore } = create(backend)
    const listener = vi.fn()
    const unsubscribe = messageStore.watch(listener)
    const first = textRecord('message-1', 'first')

    await messageStore.insert(first)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    await messageStore.insert(textRecord('message-1', 'different'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(listener).toHaveBeenCalledOnce()
    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(1)

    await messageStore.clear()
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
    await expect(messageStore.query()).resolves.toEqual([])
    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(0)
    unsubscribe()
  })

  it('rejects a query whose signal is already aborted', async () => {
    const { messageStore } = create(backend)
    await messageStore.insert(textRecord('message-1'))
    const controller = new AbortController()
    controller.abort()

    await expect(messageStore.query({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps the signal active through decode and filter settlement', async () => {
    const { database, messageStore } = create(backend)
    await messageStore.insert(textRecord('message-1'))
    const controller = new AbortController()
    const abortingDatabase: Database<MessageDatabaseSchema> = {
      read: (stores, operation, signal) =>
        database.read(stores, operation, signal).then((result) => {
          controller.abort()
          return result
        }),
      write: (stores, operation, signal) => database.write(stores, operation, signal),
      watch: (stores, listener) => database.watch(stores, listener),
      close: () => database.close()
    }

    await expect(
      createMessageStore(abortingDatabase).query({
        type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
