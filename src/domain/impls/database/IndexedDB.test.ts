import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import { createMessageDatabaseDefinition, createMessageStore } from '@/domain/MessageStore'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import { MESSAGE_TYPE } from '@/protocol/ChatRoom'
import { createIndexedDBDatabase } from './IndexedDB'

const USER = { id: 'user-1', name: 'User', avatar: '' }
let databaseId = 0
const names = new Set<string>()

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

afterEach(async () => {
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

describe('IndexedDB Message database version ownership', () => {
  it('upgrades the existing v1 stores to v2 without clearing canonical records', async () => {
    const name = `message-upgrade-${databaseId++}`
    names.add(name)
    const record = textRecord('survives-upgrade')
    const v1 = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('records')
        database.createObjectStore('conflicts')
      }
    })
    await v1.put('records', record, record.id)
    v1.close()

    const database = createIndexedDBDatabase(createMessageDatabaseDefinition(name, 2))
    const messageStore = createMessageStore(database)
    await expect(messageStore.query()).resolves.toEqual([record])
    await database.close()

    const physical = await openDB(name)
    expect(physical.version).toBe(2)
    expect(physical.transaction('conflicts').store.indexNames.contains('byEventId')).toBe(true)
    physical.close()
  })

  it('reopens v2 without clearing or advancing the schema', async () => {
    const name = `message-reopen-${databaseId++}`
    names.add(name)
    const firstDatabase = createIndexedDBDatabase(createMessageDatabaseDefinition(name, 2))
    const firstStore = createMessageStore(firstDatabase)
    const record = textRecord('survives-reopen')
    await firstStore.insert(record)
    await firstDatabase.close()

    const secondDatabase = createIndexedDBDatabase(createMessageDatabaseDefinition(name, 2))
    await expect(createMessageStore(secondDatabase).query()).resolves.toEqual([record])
    await secondDatabase.close()

    const physical = await openDB(name)
    expect(physical.version).toBe(2)
    physical.close()
  })
})
