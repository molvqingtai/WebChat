import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database, ReadTransaction, WriteTransaction } from '@/domain/externs/Database'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createConnectionLifecycle } from '@/domain/impls/ConnectionLifecycle'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { createMessageStore, type MessageDatabaseSchema } from '@/domain/MessageStore'
import {
  MESSAGE_RECORD_TYPE,
  NOTICE_TYPE,
  type MessageRecord,
  type SystemNoticeRecord,
  type TextMessageRecord
} from '@/domain/Message'
import { MESSAGE_TYPE, type ChatMessage, type ChatSession } from '@/protocol'
import { stringToHex } from '@/utils'
import type {
  HistorySupplyEvent,
  InboundEvent,
  RuntimeErrorEvent,
  RuntimeServer,
  RuntimeSessionEvent,
  RuntimeSnapshot
} from '@/runtime/Contract'
import { PagePort } from '@/runtime/PagePort'

const DOMAIN = 'https://example.com'
const USER = { id: 'local-user', name: 'Local', avatar: '' }
const REMOTE = { id: 'remote-user', name: 'Remote', avatar: '' }
const OTHER = { id: 'other-user', name: 'Other', avatar: '' }
const SITE = { origin: DOMAIN, title: 'Example' }
let databaseId = 0

const textRecord = (id: string, user = REMOTE, timestamp = 1000): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.TEXT,
    id,
    hlc: { timestamp, counter: 0 },
    userId: user.id,
    body: id,
    mentions: []
  },
  user,
  receivedAt: timestamp
})

const noticeRecord = (id: string, timestamp: number): SystemNoticeRecord => ({
  type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
  id,
  notice: { id, hlc: { timestamp, counter: 0 }, type: NOTICE_TYPE.INFO, body: id },
  user: REMOTE,
  receivedAt: timestamp
})

const domainSnapshot = (remote = false): RuntimeSnapshot => ({
  hostId: 'host-1',
  hostPhase: 'ready',
  peerId: 'local-peer',
  domains: [
    {
      domain: DOMAIN,
      phase: 'active',
      pageIds: ['page-1'],
      chatRoomJoined: true,
      localSession: { sessionId: 'local-session', user: USER, joinedAt: 1 },
      sessions: remote ? [{ sourcePeerId: 'remote-peer', sessionId: 'remote-session', user: REMOTE, joinedAt: 2 }] : []
    }
  ],
  world: { joined: true, peerId: 'local-peer', presences: [] }
})

class ControlledDatabase implements Database<MessageDatabaseSchema> {
  beforeWrite: (() => void | Promise<void>) | null = null

  constructor(private readonly inner: Database<MessageDatabaseSchema>) {}

  read<
    const Stores extends readonly [keyof MessageDatabaseSchema & string, ...(keyof MessageDatabaseSchema & string)[]],
    Result
  >(
    stores: Stores,
    operation: (transaction: ReadTransaction<MessageDatabaseSchema, Stores[number]>) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result> {
    return this.inner.read(stores, operation, signal)
  }

  async write<
    const Stores extends readonly [keyof MessageDatabaseSchema & string, ...(keyof MessageDatabaseSchema & string)[]],
    Result
  >(
    stores: Stores,
    operation: (transaction: WriteTransaction<MessageDatabaseSchema, Stores[number]>) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result> {
    await this.beforeWrite?.()
    return this.inner.write(stores, operation, signal)
  }

  watch<
    const Stores extends readonly [keyof MessageDatabaseSchema & string, ...(keyof MessageDatabaseSchema & string)[]]
  >(stores: Stores, listener: () => void) {
    return this.inner.watch(stores, listener)
  }

  close() {
    return this.inner.close()
  }
}

interface ServerFixture {
  server: RuntimeServer
  emitInbound: (event: InboundEvent) => Promise<void>
  emitSession: (event: RuntimeSessionEvent) => Promise<void>
  emitError: (message: string) => Promise<void>
  emitErrorEvent: (event: RuntimeErrorEvent) => Promise<void>
  emitHistory: (event: HistorySupplyEvent) => void
  resolvedHistory: { supplyId: string; ids: string[]; done: boolean }[]
  sent: ChatMessage[]
  leaveCount: () => number
  reconnectCount: () => number
}

const serverFixture = (): ServerFixture => {
  let inbound: ((event: InboundEvent) => void | Promise<void>) | undefined
  let session: ((event: RuntimeSessionEvent) => void | Promise<void>) | undefined
  let runtimeError: ((event: RuntimeErrorEvent) => void | Promise<void>) | undefined
  let history: ((event: HistorySupplyEvent) => void) | undefined
  let leaves = 0
  let reconnects = 0
  let errorSequence = 0
  const resolvedHistory: ServerFixture['resolvedHistory'] = []
  const sent: ChatMessage[] = []
  const server: RuntimeServer = {
    attachPage: async () => domainSnapshot(),
    detachPage: async () => {},
    getSnapshot: async () => domainSnapshot(),
    joinChatRoom: async () => {
      const snapshot = domainSnapshot()
      await session?.({
        type: 'snapshot',
        domain: DOMAIN,
        snapshot: {
          localSession: { sessionId: 'local-session', user: USER, joinedAt: 1 },
          sessions: []
        },
        provenance: 'join'
      })
      return snapshot
    },
    leaveChatRoom: async () => {
      leaves += 1
    },
    allocateTextMessage: async ({ body, mentions }) => {
      const record = textRecord('allocated-text', USER)
      return { ...record, message: { ...record.message, body, mentions } }
    },
    allocateReactionMessage: async ({ targetId, reaction, active }) => ({
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      id: 'allocated-reaction',
      message: {
        type: MESSAGE_TYPE.REACTION,
        id: 'allocated-reaction',
        hlc: { timestamp: 1000, counter: 2 },
        targetId,
        userId: USER.id,
        reaction,
        active
      },
      user: USER,
      receivedAt: 1000
    }),
    sendChatMessage: vi.fn(async ({ event }) => {
      sent.push(event)
    }),
    ackInbound: vi.fn(async () => {}),
    replayInbound: async () => [],
    reconnectDomain: async () => {
      reconnects += 1
    },
    onInbound: async (_payload, listener) => {
      inbound = listener
    },
    onSessionEvent: async (_payload, listener) => {
      session = listener
    },
    onWorldPresence: async () => {},
    onError: async (_payload, listener) => {
      runtimeError = listener
    },
    provideHistory: async (_payload, listener) => {
      history = listener
    },
    resolveHistorySupply: async ({ supplyId, result }) => {
      resolvedHistory.push({ supplyId, ids: result.records.map((record) => record.message.id), done: result.done })
    },
    rejectHistorySupply: async () => {},
    onHistoryFeedback: async () => {}
  }
  return {
    server,
    emitInbound: async (event) => {
      await inbound?.(event)
    },
    emitSession: async (event) => {
      await session?.(event)
    },
    emitError: async (message) => {
      errorSequence += 1
      await runtimeError?.({
        eventId: `test-error-${errorSequence}`,
        message,
        subsystem: 'connection',
        operation: 'lifecycle'
      })
    },
    emitErrorEvent: async (event) => {
      await runtimeError?.(event)
    },
    emitHistory: (event) => history?.(event),
    resolvedHistory,
    sent,
    leaveCount: () => leaves,
    reconnectCount: () => reconnects
  }
}

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const setup = async (
  records: readonly MessageRecord[] = [],
  database: Database<MessageDatabaseSchema> = createMemoryMessageDatabase(`chat-room-${databaseId++}`)
) => {
  const server = serverFixture()
  const messageStore = createMessageStore(database)
  for (const record of records) await messageStore.insert(record)
  let snapshot = domainSnapshot()
  const room = new ChatRoom({
    server: server.server,
    messageStore,
    pageDomain: DOMAIN,
    pageId: 'page-1',
    getSnapshot: () => snapshot,
    whenReady: (listener) => {
      listener()
      return () => {}
    }
  })
  return {
    room,
    messageStore,
    setSnapshot: (next: RuntimeSnapshot) => {
      snapshot = next
    },
    ...server
  }
}

const setupHistoryCancellation = async () => {
  const fixture = serverFixture()
  const pagePort = new PagePort()
  const server: RuntimeServer = {
    ...fixture.server,
    provideHistory: async ({ pageId, domain }, listener) => {
      pagePort.provideHistory(pageId, domain, listener)
    },
    resolveHistorySupply: vi.fn(async ({ pageId, supplyId, result }) => {
      pagePort.resolveHistorySupply(pageId, supplyId, result)
    }),
    rejectHistorySupply: vi.fn(async ({ pageId, supplyId, reason }) => {
      pagePort.rejectHistorySupply(pageId, supplyId, reason)
    })
  }
  const database = createMemoryMessageDatabase(`history-cancel-${databaseId++}`)
  const messageStore = createMessageStore(database)
  const queryStarted = Promise.withResolvers<AbortSignal>()
  const releaseQuery = Promise.withResolvers<readonly MessageRecord[]>()
  vi.spyOn(messageStore, 'query').mockImplementation(async (query) => {
    if (!query?.signal) throw new Error('History query must be abortable')
    queryStarted.resolve(query.signal)
    return releaseQuery.promise
  })
  const room = new ChatRoom({
    server,
    messageStore,
    pageDomain: DOMAIN,
    pageId: 'page-1',
    getSnapshot: () => domainSnapshot(),
    whenReady: (listener) => {
      listener()
      return () => {}
    }
  })
  await settle()
  return { database, pagePort, queryStarted, releaseQuery, room, server }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Runtime-backed ChatRoom application port', () => {
  it('reconstructs a transport-safe Runtime error message for domain listeners', async () => {
    const { room, emitError } = await setup()
    const errors: Error[] = []
    room.onError((error) => errors.push(error))
    await settle()

    await emitError('Runtime transport disconnected')

    expect(errors).toEqual([new Error('Runtime transport disconnected')])
  })

  it('deduplicates transport repeats of one failure event while fresh failures stay visible', async () => {
    const { room, emitErrorEvent } = await setup()
    const errors: Error[] = []
    room.onError((error) => errors.push(error))
    await settle()

    await emitErrorEvent({
      eventId: 'event-a',
      message: 'Runtime transport disconnected',
      subsystem: 'connection',
      operation: 'lifecycle'
    })
    await emitErrorEvent({
      eventId: 'event-a',
      message: 'Runtime transport disconnected',
      subsystem: 'connection',
      operation: 'lifecycle'
    })
    await emitErrorEvent({
      eventId: 'event-b',
      message: 'Runtime transport disconnected',
      subsystem: 'connection',
      operation: 'lifecycle'
    })

    expect(errors).toEqual([new Error('Runtime transport disconnected'), new Error('Runtime transport disconnected')])
  })

  it('publishes initialization as one session snapshot without a synthetic join fact', async () => {
    const { room } = await setup()
    const snapshots: Array<readonly ChatSession[]> = []
    const joins: ChatSession[] = []
    room.onSessions((sessions) => snapshots.push(sessions))
    room.onJoinRoom((session) => joins.push(session))

    await settle()
    await room.joinRoom({ user: USER, site: SITE })

    expect(snapshots).toEqual([[{ sessionId: 'local-session', user: USER }]])
    expect(joins).toEqual([])
  })

  it('persists one canonical self-join notice across repeated and parallel page joins', async () => {
    const database = createMemoryMessageDatabase(`self-join-${databaseId++}`)
    const first = await setup([], database)
    const second = await setup([], database)
    await settle()

    await Promise.all([
      first.room.joinRoom({ user: USER, site: SITE }),
      second.room.joinRoom({ user: USER, site: SITE })
    ])
    await first.room.leaveRoom()
    await first.room.joinRoom({ user: USER, site: SITE })

    const records = await first.messageStore.query()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
      notice: {
        type: NOTICE_TYPE.JOIN,
        body: '"Local" joined the chat',
        hlc: { timestamp: 1, counter: 0 }
      },
      user: USER,
      receivedAt: 1
    })
    expect(records[0].id).toBe(records[0].type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE ? records[0].notice.id : '')
  })

  it('preserves an existing Chat winner while parallel joins converge on one fallback self notice', async () => {
    const database = createMemoryMessageDatabase(`self-join-existing-winner-${databaseId++}`)
    const stableNoticeId = `notice:${stringToHex(`self:join:${USER.id}`)}`
    const collision = textRecord(stableNoticeId)
    const seedStore = createMessageStore(database)
    await seedStore.insert(collision)
    const first = await setup([], database)
    const second = await setup([], database)
    await settle()

    await Promise.all([
      first.room.joinRoom({ user: USER, site: SITE }),
      second.room.joinRoom({ user: USER, site: SITE })
    ])
    await first.room.leaveRoom()
    await first.room.joinRoom({ user: USER, site: SITE })
    const reloaded = await setup([], database)
    await settle()
    await reloaded.room.joinRoom({ user: USER, site: SITE })

    const records = await first.messageStore.query()
    const notices = records.filter((record) => record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE)
    expect(records.find((record) => record.id === stableNoticeId)).toEqual(collision)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.id).not.toBe(stableNoticeId)
    expect(notices[0]).toMatchObject({
      notice: { type: NOTICE_TYPE.JOIN, body: '"Local" joined the chat' },
      user: USER
    })
  })

  it('preserves a Chat winner inserted immediately before the self-notice write', async () => {
    const databaseName = `self-join-racing-winner-${databaseId++}`
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(databaseName))
    const fixture = await setup([], controlled)
    const competingStore = createMessageStore(createMemoryMessageDatabase(databaseName))
    const stableNoticeId = `notice:${stringToHex(`self:join:${USER.id}`)}`
    const collision = textRecord(stableNoticeId)
    let raced = false
    controlled.beforeWrite = async () => {
      if (raced) return
      raced = true
      await competingStore.insert(collision)
    }
    await settle()

    await fixture.room.joinRoom({ user: USER, site: SITE })

    const records = await fixture.messageStore.query()
    const notices = records.filter((record) => record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE)
    expect(raced).toBe(true)
    expect(records.find((record) => record.id === stableNoticeId)).toEqual(collision)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.id).not.toBe(stableNoticeId)
    expect(notices[0]).toMatchObject({
      notice: { type: NOTICE_TYPE.JOIN, body: '"Local" joined the chat' },
      user: USER
    })
  })

  it('publishes the new snapshot before each accepted live join and leave fact', async () => {
    const { room, emitSession } = await setup()
    const order: string[] = []
    room.onSessions((sessions) => order.push(`sessions:${sessions.map((item) => item.sessionId).join(',')}`))
    room.onJoinRoom((session) => order.push(`join:${session.sessionId}`))
    room.onLeaveRoom((session) => order.push(`leave:${session.sessionId}`))
    await settle()
    await room.joinRoom({ user: USER, site: SITE })
    order.length = 0

    const remote = { sourcePeerId: 'remote-peer', sessionId: 'remote-session', user: REMOTE, joinedAt: 2 }
    await emitSession({
      type: 'join',
      domain: DOMAIN,
      snapshot: { localSession: { sessionId: 'local-session', user: USER, joinedAt: 1 }, sessions: [remote] },
      session: remote,
      provenance: 'live'
    })
    await emitSession({
      type: 'leave',
      domain: DOMAIN,
      snapshot: { localSession: { sessionId: 'local-session', user: USER, joinedAt: 1 }, sessions: [] },
      session: remote,
      occurredAt: 3,
      provenance: 'live'
    })

    expect(order).toEqual([
      'sessions:local-session,remote-session',
      'join:remote-session',
      'sessions:local-session',
      'leave:remote-session'
    ])
  })

  it('emits membership facts only for the first and final live session of each user', async () => {
    const { room, emitSession } = await setup()
    const joins: ChatSession[] = []
    const leaves: ChatSession[] = []
    room.onJoinRoom((session) => joins.push(session))
    room.onLeaveRoom((session) => leaves.push(session))
    await settle()

    const first = { sourcePeerId: 'remote-peer-1', sessionId: 'remote-session-1', user: REMOTE, joinedAt: 2 }
    const second = { sourcePeerId: 'remote-peer-2', sessionId: 'remote-session-2', user: REMOTE, joinedAt: 3 }
    const localSession = { sessionId: 'local-session', user: USER, joinedAt: 1 }
    await emitSession({
      type: 'join',
      domain: DOMAIN,
      snapshot: { localSession, sessions: [first] },
      session: first,
      provenance: 'live'
    })
    await emitSession({
      type: 'join',
      domain: DOMAIN,
      snapshot: { localSession, sessions: [first, second] },
      session: second,
      provenance: 'live'
    })
    await emitSession({
      type: 'leave',
      domain: DOMAIN,
      snapshot: { localSession, sessions: [second] },
      session: first,
      occurredAt: 4,
      provenance: 'live'
    })
    await emitSession({
      type: 'leave',
      domain: DOMAIN,
      snapshot: { localSession, sessions: [] },
      session: second,
      occurredAt: 5,
      provenance: 'live'
    })

    expect(joins).toEqual([{ sessionId: first.sessionId, user: REMOTE }])
    expect(leaves).toEqual([{ sessionId: second.sessionId, user: REMOTE }])
  })

  it('does not fabricate a leave and rejoin for a same-user incarnation replacement', async () => {
    const { room, emitSession } = await setup()
    const order: string[] = []
    room.onSessions((sessions) => order.push(`sessions:${sessions.map((item) => item.sessionId).join(',')}`))
    room.onJoinRoom((session) => order.push(`join:${session.sessionId}`))
    room.onLeaveRoom((session) => order.push(`leave:${session.sessionId}`))
    await settle()

    const previous = { sourcePeerId: 'remote-peer', sessionId: 'remote-session-1', user: REMOTE, joinedAt: 2 }
    const replacement = { ...previous, sessionId: 'remote-session-2', joinedAt: 3 }
    await emitSession({
      type: 'replace',
      domain: DOMAIN,
      snapshot: {
        localSession: { sessionId: 'local-session', user: USER, joinedAt: 1 },
        sessions: [replacement]
      },
      previous,
      session: replacement,
      occurredAt: 3,
      provenance: 'live'
    })

    expect(order).toEqual(['sessions:local-session,remote-session-2'])
  })

  it('derives both sides of a changed-user replacement from the resulting snapshot', async () => {
    const { room, emitSession } = await setup()
    const order: string[] = []
    room.onSessions((sessions) => order.push(`sessions:${sessions.map((item) => item.sessionId).join(',')}`))
    room.onJoinRoom((session) => order.push(`join:${session.user.id}`))
    room.onLeaveRoom((session) => order.push(`leave:${session.user.id}`))
    await settle()

    const previous = { sourcePeerId: 'remote-peer', sessionId: 'remote-session-1', user: REMOTE, joinedAt: 2 }
    const replacement = { ...previous, sessionId: 'remote-session-2', user: OTHER, joinedAt: 3 }
    await emitSession({
      type: 'replace',
      domain: DOMAIN,
      snapshot: {
        localSession: { sessionId: 'local-session', user: USER, joinedAt: 1 },
        sessions: [replacement]
      },
      previous,
      session: replacement,
      occurredAt: 3,
      provenance: 'live'
    })

    expect(order).toEqual(['sessions:local-session,remote-session-2', 'leave:remote-user', 'join:other-user'])
  })

  it('emits only a first-inserted remote live message after persistence', async () => {
    const { room, emitInbound, messageStore } = await setup()
    const messages: ChatMessage[] = []
    room.onMessage((message) => messages.push(message))
    await settle()
    const record = textRecord('remote-live')

    await emitInbound({ sequence: 1, domain: DOMAIN, record, source: 'live' })
    await emitInbound({ sequence: 2, domain: DOMAIN, record, source: 'live' })
    await emitInbound({ sequence: 3, domain: DOMAIN, record: textRecord('history'), source: 'history' })

    expect(messages).toEqual([record.message])
    await expect(messageStore.query()).resolves.toEqual([textRecord('history'), record])
  })

  it('isolates an invalid inbound record before persistence and recovers on the next event', async () => {
    const { room, emitInbound, messageStore, server } = await setup()
    const messages: ChatMessage[] = []
    const errors: Error[] = []
    room.onMessage((message) => messages.push(message))
    room.onError((error) => errors.push(error))
    vi.mocked(server.ackInbound).mockRejectedValueOnce(new Error('invalid ACK failed'))
    await settle()

    await emitInbound({
      sequence: 1,
      domain: DOMAIN,
      record: { legacy: true, schema: 'unsupported-v1' } as unknown as TextMessageRecord,
      source: 'live'
    })

    expect(messages).toEqual([])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatchObject({ name: 'InvalidMessageRecordError' })
    expect(errors[1]).toEqual(new Error('invalid ACK failed'))
    await expect(messageStore.query()).resolves.toEqual([])
    expect(server.ackInbound).toHaveBeenCalledWith({ domain: DOMAIN, sequence: 1, inserted: false })

    await vi.advanceTimersByTimeAsync(1000)
    expect(server.ackInbound).toHaveBeenCalledTimes(2)
    expect(errors).toHaveLength(2)

    const valid = textRecord('valid-after-invalid')
    await emitInbound({ sequence: 2, domain: DOMAIN, record: valid, source: 'live' })

    expect(messages).toEqual([valid.message])
    expect(errors).toHaveLength(2)
    await expect(messageStore.query()).resolves.toEqual([valid])
    expect(server.ackInbound).toHaveBeenCalledTimes(3)
  })

  it('emits one live projection when two pages race to persist the same inbound fact', async () => {
    const database = createMemoryMessageDatabase(`inbound-pages-${databaseId++}`)
    const first = await setup([], database)
    const second = await setup([], database)
    const firstMessages: ChatMessage[] = []
    const secondMessages: ChatMessage[] = []
    first.room.onMessage((message) => firstMessages.push(message))
    second.room.onMessage((message) => secondMessages.push(message))
    await settle()
    const record = textRecord('shared-live')

    await Promise.all([
      first.emitInbound({ sequence: 1, domain: DOMAIN, record, source: 'live' }),
      second.emitInbound({ sequence: 1, domain: DOMAIN, record, source: 'live' })
    ])

    expect([...firstMessages, ...secondMessages]).toEqual([record.message])
    await expect(first.messageStore.query()).resolves.toEqual([record])
  })

  it('emits an inserted live message once even when its Runtime ACK needs retry', async () => {
    const { room, emitInbound, server } = await setup()
    const messages: ChatMessage[] = []
    room.onMessage((message) => messages.push(message))
    vi.mocked(server.ackInbound).mockRejectedValueOnce(new Error('ack failed'))
    await settle()
    const record = textRecord('ack-retry')

    await emitInbound({ sequence: 4, domain: DOMAIN, record, source: 'live' })
    expect(messages).toEqual([record.message])

    await vi.advanceTimersByTimeAsync(1000)
    await settle()
    expect(server.ackInbound).toHaveBeenCalledTimes(2)
    expect(messages).toEqual([record.message])
  })

  it('persists but does not project a winning live insert from a stale host callback', async () => {
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(`host-swap-${databaseId++}`))
    let release!: () => void
    controlled.beforeWrite = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    const fixture = await setup([], controlled)
    const messages: ChatMessage[] = []
    fixture.room.onMessage((message) => messages.push(message))
    await settle()
    const record = textRecord('host-swap')

    const inbound = fixture.emitInbound({ sequence: 5, domain: DOMAIN, record, source: 'live' })
    await settle()
    fixture.setSnapshot({ ...domainSnapshot(), hostId: 'host-2' })
    release()
    await inbound

    expect(messages).toEqual([])
    await expect(fixture.messageStore.query()).resolves.toEqual([record])
    expect(fixture.server.ackInbound).not.toHaveBeenCalled()
  })

  it('completes transport before inserting each local command', async () => {
    const order: string[] = []
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(`send-first-${databaseId++}`))
    controlled.beforeWrite = () => {
      order.push('insert')
    }
    const fixture = await setup([], controlled)
    vi.mocked(fixture.server.sendChatMessage).mockImplementation(async ({ event }) => {
      order.push(`send:${event.id}`)
      fixture.sent.push(event)
    })
    await settle()
    await fixture.room.joinRoom({ user: USER, site: SITE })
    order.length = 0

    const text = await fixture.room.sendMessage({ type: 'text', body: 'hello', mentions: [] })
    const reaction = await fixture.room.sendMessage({
      type: 'reaction',
      targetId: 'target',
      reaction: 'like',
      active: true
    })

    expect(text).toMatchObject({ type: MESSAGE_TYPE.TEXT, id: 'allocated-text', body: 'hello' })
    expect(reaction).toMatchObject({ type: MESSAGE_TYPE.REACTION, id: 'allocated-reaction', targetId: 'target' })
    expect(order).toEqual(['send:allocated-text', 'insert', 'send:allocated-reaction', 'insert'])
    expect(
      (await fixture.messageStore.query())
        .filter((record) => record.type === MESSAGE_RECORD_TYPE.CHAT_MESSAGE)
        .map((record) => record.id)
    ).toEqual(['allocated-reaction', 'allocated-text'])
  })

  it('returns this call allocated message instead of a same-id canonical winner', async () => {
    const existing = textRecord('allocated-text', REMOTE)
    const fixture = await setup([existing])
    await settle()

    const message = await fixture.room.sendMessage({ type: 'text', body: 'new body', mentions: [] })

    expect(message).toMatchObject({
      type: MESSAGE_TYPE.TEXT,
      id: 'allocated-text',
      userId: USER.id,
      body: 'new body'
    })
    await expect(fixture.messageStore.query()).resolves.toEqual([existing])
    expect(fixture.sent).toEqual([message])
  })

  it('does not insert or return a message when transport rejects', async () => {
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(`send-reject-${databaseId++}`))
    const beforeWrite = vi.fn()
    controlled.beforeWrite = beforeWrite
    const fixture = await setup([], controlled)
    vi.mocked(fixture.server.sendChatMessage).mockRejectedValue(new Error('transport rejected'))
    await settle()

    await expect(fixture.room.sendMessage({ type: 'text', body: 'hello', mentions: [] })).rejects.toThrow(
      'transport rejected'
    )
    expect(beforeWrite).not.toHaveBeenCalled()
    await expect(fixture.messageStore.query()).resolves.toEqual([])
  })

  it('accepts remote-visible local loss when insertion fails after transport', async () => {
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(`local-loss-${databaseId++}`))
    controlled.beforeWrite = () => {
      throw new Error('local persistence failed')
    }
    const fixture = await setup([], controlled)
    await settle()

    await expect(fixture.room.sendMessage({ type: 'text', body: 'hello', mentions: [] })).rejects.toThrow(
      'local persistence failed'
    )
    expect(fixture.sent.map((message) => message.id)).toEqual(['allocated-text'])
    await vi.runAllTimersAsync()
    expect(fixture.server.sendChatMessage).toHaveBeenCalledOnce()
  })

  it('queries only Chat records and projects history criteria outside the store', async () => {
    const recent = textRecord('recent', REMOTE, 20)
    const older = textRecord('older', REMOTE, 10)
    const fixture = await setup([older, noticeRecord('notice', 30), recent])
    const query = vi.spyOn(fixture.messageStore, 'query')
    await settle()

    fixture.emitHistory({
      type: 'request',
      request: { supplyId: 'supply-1', domain: DOMAIN, syncId: 'sync-1', cutoff: 10, mode: 'provider' as const }
    })
    await vi.waitFor(() =>
      expect(fixture.resolvedHistory).toEqual([{ supplyId: 'supply-1', ids: ['recent', 'older'], done: true }])
    )
    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith({
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      signal: expect.any(AbortSignal)
    })
  })

  it('terminally rejects a cancelled slow history query exactly once', async () => {
    const fixture = await setupHistoryCancellation()
    const request = {
      supplyId: 'supply-cancel',
      domain: DOMAIN,
      syncId: 'sync-cancel',
      cutoff: 0,
      mode: 'provider' as const
    }
    let suppliedResult: Error | 'pending' = 'pending'
    const supplied = fixture.pagePort.supplyHistory('page-1', request).then(
      () => {
        suppliedResult = new Error('History supply unexpectedly resolved')
      },
      (error: Error) => {
        suppliedResult = error
      }
    )
    const signal = await fixture.queryStarted.promise
    let cancellationSettled = false
    const cancelled = fixture.pagePort.cancelHistorySupply(request.supplyId).then(() => {
      cancellationSettled = true
    })

    try {
      await settle()

      // The AbortSignal fires immediately, but the physical query is still held: Runtime
      // cancellation must remain pending until the query/projection chain exits.
      expect(signal.aborted).toBe(true)
      expect(fixture.server.rejectHistorySupply).not.toHaveBeenCalled()
      expect(cancellationSettled).toBe(false)
      expect(suppliedResult).toBe('pending')
      expect(fixture.pagePort.pendingHistoryCountForTest()).toBe(1)

      fixture.releaseQuery.resolve([])
      await settle()
      await settle()
      // After physical exit the cancelled supply settles exactly once.
      expect(fixture.server.rejectHistorySupply).toHaveBeenCalledOnce()
      expect(fixture.server.rejectHistorySupply).toHaveBeenCalledWith({
        pageId: 'page-1',
        supplyId: request.supplyId,
        reason: 'History supply cancelled'
      })
      expect(cancellationSettled).toBe(true)
      expect(suppliedResult).toEqual(new Error('History supplier timed out'))
      expect(fixture.pagePort.pendingHistoryCountForTest()).toBe(0)
      expect(fixture.server.resolveHistorySupply).not.toHaveBeenCalled()
    } finally {
      fixture.releaseQuery.resolve([])
      fixture.room.dispose()
      fixture.pagePort.dispose()
      await Promise.all([supplied, cancelled])
      await fixture.database.close()
    }
  })

  it('settles provider replacement while fencing the old query from a new supply', async () => {
    const fixture = await setupHistoryCancellation()
    const oldRequest = {
      supplyId: 'supply-old',
      domain: DOMAIN,
      syncId: 'sync-old',
      cutoff: 0,
      mode: 'provider' as const
    }
    let oldSupplyResult: Error | 'pending' | null = 'pending'
    const oldSupply = fixture.pagePort.supplyHistory('page-1', oldRequest).then(
      (result) => {
        oldSupplyResult = result === null ? null : new Error('Old history supply unexpectedly returned records')
      },
      (error: Error) => {
        oldSupplyResult = error
      }
    )
    const oldSignal = await fixture.queryStarted.promise
    const replacementEvents: HistorySupplyEvent[] = []

    try {
      await fixture.server.provideHistory({ pageId: 'page-1', domain: DOMAIN }, (event) => {
        replacementEvents.push(event)
      })
      await settle()

      // The AbortSignal fires immediately, but the old query is still physically running: no
      // Runtime settlement and no release/promotion may happen before it exits.
      expect(oldSignal.aborted).toBe(true)
      expect(fixture.server.rejectHistorySupply).not.toHaveBeenCalled()
      expect(oldSupplyResult).toBe('pending')

      const newRequest = {
        supplyId: 'supply-new',
        domain: DOMAIN,
        syncId: 'sync-new',
        cutoff: 0,
        mode: 'provider' as const
      }
      const newSupply = fixture.pagePort.supplyHistory('page-1', newRequest).catch((error: Error) => error)
      expect(replacementEvents).toEqual([{ type: 'request', request: newRequest }])
      fixture.releaseQuery.resolve([])
      await settle()
      await settle()

      // After physical exit the old supply settles exactly once (replacement mode resolves null),
      // while the new supply (owned by the replacement provider registration) stays pending.
      expect(fixture.server.rejectHistorySupply).toHaveBeenCalledOnce()
      expect(fixture.server.rejectHistorySupply).toHaveBeenCalledWith({
        pageId: 'page-1',
        supplyId: oldRequest.supplyId,
        reason: 'History supply cancelled'
      })
      expect(oldSupplyResult).toBeNull()
      expect(fixture.pagePort.pendingHistoryCountForTest()).toBe(1)
      expect(fixture.server.resolveHistorySupply).not.toHaveBeenCalled()

      fixture.pagePort.removePage('page-1')
      await expect(newSupply).resolves.toEqual(new Error('History supplier page detached'))
    } finally {
      fixture.releaseQuery.resolve([])
      fixture.room.dispose()
      fixture.pagePort.dispose()
      await oldSupply
      await fixture.database.close()
    }
  })

  it('reconnects the current room without publishing a synthetic leave snapshot', async () => {
    const { room, leaveCount, reconnectCount } = await setup()
    const snapshots: Array<readonly ChatSession[]> = []
    const leaves: ChatSession[] = []
    room.onSessions((sessions) => snapshots.push(sessions))
    room.onLeaveRoom((session) => leaves.push(session))
    await settle()
    await room.joinRoom({ user: USER, site: SITE })

    await room.leaveRoom()

    expect(reconnectCount()).toBe(1)
    expect(leaveCount()).toBe(0)
    expect(snapshots.at(-1)).toEqual([{ sessionId: 'local-session', user: USER }])
    expect(leaves).toEqual([])
  })

  it('translates a cancelled Runtime reconnect into an AbortError', async () => {
    const { room, server } = await setup()
    vi.spyOn(server, 'reconnectDomain').mockResolvedValueOnce(null)
    await settle()

    await expect(room.leaveRoom()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('cancels pending replay on page disposal without blocking a replacement page', async () => {
    const fixture = serverFixture()
    const replayStarted = Promise.withResolvers<void>()
    const releaseReplay = Promise.withResolvers<void>()
    let replayCalls = 0
    let joinCalls = 0
    const server: RuntimeServer = {
      ...fixture.server,
      joinChatRoom: async (payload) => {
        joinCalls += 1
        return fixture.server.joinChatRoom(payload)
      },
      replayInbound: async () => {
        replayCalls += 1
        if (replayCalls === 1) {
          replayStarted.resolve()
          await releaseReplay.promise
        }
        return []
      }
    }
    const database = createMemoryMessageDatabase(`disposed-replay-${databaseId++}`)
    const messageStore = createMessageStore(database)
    const createRoom = () =>
      new ChatRoom({
        server,
        messageStore,
        pageDomain: DOMAIN,
        pageId: 'page-1',
        getSnapshot: () => domainSnapshot(),
        whenReady: (listener) => {
          listener()
          return () => {}
        }
      })
    const firstRoom = createRoom()
    let firstResult: Error | 'pending' | null = 'pending'
    const firstJoin = firstRoom.joinRoom({ user: USER, site: SITE }).then(
      () => {
        firstResult = null
      },
      (error: Error) => {
        firstResult = error
      }
    )
    await replayStarted.promise

    try {
      firstRoom.dispose()
      await settle()
      expect(firstResult).toMatchObject({ name: 'AbortError' })
      expect(joinCalls).toBe(0)

      const replacement = createRoom()
      await replacement.joinRoom({ user: USER, site: SITE })
      expect(replayCalls).toBe(2)
      expect(joinCalls).toBe(1)
      replacement.dispose()
    } finally {
      releaseReplay.resolve()
      await firstJoin
      firstRoom.dispose()
      await database.close()
    }
  })

  it('reports a superseded attempt token cancelled before aborting it (real Runtime adapter)', async () => {
    const heldJoin = new Promise<RuntimeSnapshot>(() => {})
    const database = createMemoryMessageDatabase(`supersede-${databaseId++}`)
    const messageStore = createMessageStore(database)
    const server: RuntimeServer = {
      ...serverFixture().server,
      joinChatRoom: async () => heldJoin
    }
    const lifecycle = createConnectionLifecycle()
    const room = new ChatRoom({
      server,
      messageStore,
      pageDomain: DOMAIN,
      pageId: 'page-1',
      getSnapshot: () => domainSnapshot(),
      whenReady: (listener) => {
        listener()
        return () => {}
      }
    })
    room.bindConnectionResultReporter(lifecycle.report)
    room.bindStandaloneInvocation(lifecycle.value.mint, lifecycle.value.bindTask)

    // First join holds its provider call; a second join supersedes it by beginConnectionAttempt, which
    // must report the predecessor token cancelled BEFORE aborting it (first-terminal-wins).
    const first = room.joinRoom({ user: USER, site: SITE })
    first.catch(() => {})
    await settle()
    const second = room.joinRoom({ user: USER, site: SITE })
    second.catch(() => {})
    await settle()

    expect(lifecycle.value.getTaskResult(first)).toBe('cancelled')
    room.dispose()
    await database.close()
  })
})
