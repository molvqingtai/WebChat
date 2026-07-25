import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import ChatRoomDomain from '@/domain/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import type { Database } from '@/domain/externs/Database'
import { createIndexedDBDatabase } from '@/domain/impls/database/IndexedDB'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import {
  MessageDatabaseExtern,
  createMessageDatabaseDefinition,
  createMessageStore,
  type MessageDatabaseSchema
} from '@/domain/MessageStore'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { MESSAGE_TYPE, type ChatMessage, type ChatSession, type ChatUser } from '@/protocol'

const SELF: UserInfo = {
  id: 'local-user',
  name: 'Local',
  avatar: '',
  createTime: 1,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'at'
}
const LOCAL_USER: ChatUser = { id: SELF.id, name: SELF.name, avatar: SELF.avatar }
const REMOTE: ChatUser = { id: 'remote-user', name: 'Remote', avatar: '' }

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

let sequence = 0
const databases = new Set<Database<MessageDatabaseSchema>>()
const names = new Set<string>()

const textRecord = (id: string, body: string, user = LOCAL_USER): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.TEXT,
    id,
    hlc: { timestamp: 4, counter: 0 },
    userId: user.id,
    body,
    mentions: []
  },
  user,
  receivedAt: 4
})

const createPage = (database: Database<MessageDatabaseSchema>, nextId: () => string) => {
  const messageStore = createMessageStore(database)
  const storage: Storage = {
    get: async <T extends StorageValue>() => SELF as T,
    set: async () => {},
    watch: async () => async () => {}
  }
  const listeners = {
    message: new Set<(message: ChatMessage) => void>(),
    join: new Set<(session: ChatSession) => void>(),
    leave: new Set<(session: ChatSession) => void>(),
    sessions: new Set<(sessions: readonly ChatSession[]) => void>(),
    error: new Set<(error: Error) => void>()
  }
  const subscribe = <T>(set: Set<(value: T) => void>, listener: (value: T) => void) => {
    set.add(listener)
    return () => set.delete(listener)
  }
  const chat: ChatRoom = {
    joinRoom: async () => {},
    leaveRoom: async () => {},
    sendMessage: async (command) => {
      const id = nextId()
      if (command.type === 'reaction') {
        const message = {
          type: MESSAGE_TYPE.REACTION,
          id,
          hlc: { timestamp: 4, counter: 0 },
          targetId: command.targetId,
          userId: SELF.id,
          reaction: command.reaction,
          active: command.active
        } as const
        await messageStore.insert({
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          id,
          message,
          user: LOCAL_USER,
          receivedAt: 4
        })
        return message
      }
      const record = textRecord(id, command.body)
      await messageStore.insert(record)
      return record.message
    },
    onMessage: (listener) => subscribe(listeners.message, listener),
    onJoinRoom: (listener) => subscribe(listeners.join, listener),
    onLeaveRoom: (listener) => subscribe(listeners.leave, listener),
    onSessions: (listener) => subscribe(listeners.sessions, listener),
    onError: (listener) => subscribe(listeners.error, listener)
  }

  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(chat),
      ReadinessExtern.impl({ onState: () => () => {} }),
      MessageDatabaseExtern.impl(database),
      BrowserSyncStorageExtern.impl(storage)
    ]
  })
  const chatAction = ChatRoomDomain()
  const listAction = MessageListDomain()
  const userAction = UserInfoDomain()
  const room = store.getDomain(chatAction)
  const list = store.getDomain(listAction)
  const user = store.getDomain(userAction)
  store.igniteDomain(chatAction)
  store.send(user.command.UpdateUserInfoCommand(SELF))
  return {
    store,
    room,
    list,
    messageStore,
    emitMessage: (message: ChatMessage) => listeners.message.forEach((listener) => listener(message)),
    emitSessions: (sessions: readonly ChatSession[]) => listeners.sessions.forEach((listener) => listener(sessions))
  }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all([...databases].map((database) => database.close()))
  databases.clear()
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

describe.each(backends)('$name causal local send projection', (backend) => {
  it('projects the returned identity before a delayed store watch and only once', async () => {
    vi.stubGlobal('document', {
      location: { origin: 'https://example.test' },
      title: '',
      querySelector: () => null
    })
    const name = `local-watch-${backend.name}-${sequence++}`
    names.add(name)
    const database = backend.create(name)
    databases.add(database)
    const notify = new Set<() => void>()
    const watch = database.watch.bind(database)
    database.watch = ((stores, listener) => watch(stores, () => notify.add(listener))) as typeof database.watch
    const page = createPage(database, () => 'local-message')
    await vi.waitFor(() => expect(page.store.query(page.list.query.LoadIsFinishedQuery())).toBe(true))
    const projected: string[] = []
    const remote: string[] = []
    page.store.subscribeEvent(page.room.event.SendTextMessageEvent, (message) => projected.push(message.id))
    page.store.subscribeEvent(page.room.event.OnTextMessageEvent, (message) => remote.push(message.id))

    page.store.send(page.room.command.SendTextMessageCommand('hello'))

    await vi.waitFor(() => expect(projected).toEqual(['local-message']))
    expect(page.store.query(page.list.query.RecordListQuery())).toEqual([])
    expect(remote).toEqual([])
    notify.forEach((listener) => listener())
    notify.clear()
    await vi.waitFor(() => expect(page.store.query(page.list.query.RecordListQuery())).toHaveLength(1))
    expect(projected).toEqual(['local-message'])
    page.store.discard()
  })

  it('projects one valid live message when an invalid retained row exists after readiness', async () => {
    vi.stubGlobal('document', {
      location: { origin: 'https://example.test' },
      title: '',
      querySelector: () => null
    })
    const name = `retained-invalid-${backend.name}-${sequence++}`
    names.add(name)
    const database = backend.create(name)
    databases.add(database)
    const page = createPage(database, () => 'unused')
    const remote: string[] = []
    const errors: Error[] = []
    page.store.subscribeEvent(page.room.event.OnTextMessageEvent, (message) => remote.push(message.id))
    page.store.subscribeEvent(page.list.event.LoadFailedEvent, (error) => errors.push(error))
    await vi.waitFor(() => expect(page.store.query(page.list.query.LoadIsFinishedQuery())).toBe(true))
    page.emitSessions([{ sessionId: 'remote-session', user: REMOTE }])

    await database.write(['records'], (transaction) =>
      transaction.insert('records', 'qa-legacy-invalid-record', {
        legacy: true,
        schema: 'unsupported-v1'
      })
    )
    const valid = textRecord('valid-remote', 'visible despite retained invalid row', REMOTE)
    await page.messageStore.insert(valid)
    page.emitMessage(valid.message)

    await vi.waitFor(() => expect(remote).toEqual([valid.id]))
    await vi.waitFor(() =>
      expect(page.store.query(page.list.query.RecordListQuery()).map((record) => record.id)).toEqual([valid.id])
    )
    expect(errors).toEqual([])
    await expect(database.read(['records'], (transaction) => transaction.count('records'))).resolves.toBe(2)
    await expect(database.read(['conflicts'], (transaction) => transaction.count('conflicts'))).resolves.toBe(1)
    page.store.discard()
  })

  it('keeps same-content concurrent tabs bound to their own returned identities', async () => {
    vi.stubGlobal('document', {
      location: { origin: 'https://example.test' },
      title: '',
      querySelector: () => null
    })
    const name = `local-tabs-${backend.name}-${sequence++}`
    names.add(name)
    const firstDatabase = backend.create(name)
    const secondDatabase = backend.create(name)
    databases.add(firstDatabase)
    databases.add(secondDatabase)
    const first = createPage(firstDatabase, () => 'first-tab-message')
    const second = createPage(secondDatabase, () => 'second-tab-message')
    await vi.waitFor(() => expect(first.store.query(first.list.query.LoadIsFinishedQuery())).toBe(true))
    await vi.waitFor(() => expect(second.store.query(second.list.query.LoadIsFinishedQuery())).toBe(true))
    const firstProjected: string[] = []
    const secondProjected: string[] = []
    first.store.subscribeEvent(first.room.event.SendTextMessageEvent, (message) => firstProjected.push(message.id))
    second.store.subscribeEvent(second.room.event.SendTextMessageEvent, (message) => secondProjected.push(message.id))

    first.store.send(first.room.command.SendTextMessageCommand('same body'))
    second.store.send(second.room.command.SendTextMessageCommand('same body'))

    await vi.waitFor(() => expect(firstProjected).toEqual(['first-tab-message']))
    await vi.waitFor(() => expect(secondProjected).toEqual(['second-tab-message']))
    await vi.waitFor(() => expect(first.store.query(first.list.query.RecordListQuery())).toHaveLength(2))
    await vi.waitFor(() => expect(second.store.query(second.list.query.RecordListQuery())).toHaveLength(2))
    expect(
      first.store
        .query(first.list.query.RecordListQuery())
        .map((record) => record.id)
        .toSorted()
    ).toEqual(['first-tab-message', 'second-tab-message'])
    expect(
      second.store
        .query(second.list.query.RecordListQuery())
        .map((record) => record.id)
        .toSorted()
    ).toEqual(['first-tab-message', 'second-tab-message'])
    first.store.discard()
    second.store.discard()
  })

  it('projects the allocated message instead of the same-id canonical winner', async () => {
    vi.stubGlobal('document', {
      location: { origin: 'https://example.test' },
      title: '',
      querySelector: () => null
    })
    const name = `local-collision-${backend.name}-${sequence++}`
    names.add(name)
    const database = backend.create(name)
    databases.add(database)
    const messageStore = createMessageStore(database)
    const existing = textRecord('collision', 'existing body', REMOTE)
    await messageStore.insert(existing)
    const page = createPage(database, () => 'collision')
    await vi.waitFor(() => expect(page.store.query(page.list.query.LoadIsFinishedQuery())).toBe(true))
    const projected: Array<{ id: string; body: string }> = []
    page.store.subscribeEvent(page.room.event.SendTextMessageEvent, (message) =>
      projected.push({ id: message.id, body: message.body })
    )

    page.store.send(page.room.command.SendTextMessageCommand('allocated body'))

    await vi.waitFor(() => expect(projected).toEqual([{ id: 'collision', body: 'allocated body' }]))
    await expect(messageStore.query()).resolves.toEqual([existing])
    page.store.discard()
  })
})
