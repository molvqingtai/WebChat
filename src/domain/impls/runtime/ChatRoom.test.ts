import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database, ReadTransaction, WriteTransaction } from '@/domain/externs/Database'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createConnectionLifecycle } from '@/domain/impls/ConnectionLifecycle'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { createMessageStore, InvalidMessageRecordError, type MessageDatabaseSchema } from '@/domain/MessageStore'
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
  RuntimeSession,
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

const remoteSession = (overrides: Partial<RuntimeSession> = {}): RuntimeSession => ({
  sourcePeerId: 'remote-peer',
  sessionId: 'remote-session',
  user: REMOTE,
  joinedAt: 2,
  ...overrides
})

const domainSnapshot = (sessions: RuntimeSession[] = []): RuntimeSnapshot => ({
  hostId: 'host-1',
  hostPhase: 'ready',
  peerId: 'local-peer',
  domains: [
    {
      domain: DOMAIN,
      phase: 'active',
      tabIds: [1],
      chatRoomJoined: true,
      localSession: { sessionId: 'local-session', user: USER, joinedAt: 1, fresh: false },
      sessions,
      inbound: [],
      historyFeedback: []
    }
  ],
  world: { joined: true, peerId: 'local-peer', presences: [] },
  failures: []
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

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const domainSnapshotWithFresh = (): RuntimeSnapshot => {
  const base = domainSnapshot()
  const domain = base.domains[0]!
  return {
    ...base,
    domains: [{ ...domain, localSession: { ...domain.localSession!, fresh: true } }]
  }
}

const setup = async (
  records: readonly MessageRecord[] = [],
  database: Database<MessageDatabaseSchema> = createMemoryMessageDatabase(`chat-room-${databaseId++}`),
  options: { fresh?: boolean } = {}
) => {
  let leaves = 0
  let reconnects = 0
  const resolvedHistory: { supplyId: string; ids: string[]; done: boolean }[] = []
  const sent: ChatMessage[] = []
  let history: ((event: HistorySupplyEvent) => void) | undefined
  let current: RuntimeSnapshot = domainSnapshot()
  if (options.fresh) {
    const domain = current.domains[0]!
    current = {
      ...current,
      domains: [{ ...domain, localSession: { ...domain.localSession!, fresh: true } }]
    }
  }
  const server: RuntimeServer = {
    attachPage: async () => current,
    getSnapshot: async () => current,
    joinChatRoom: async () => current,
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
      return event
    }),
    ackInbound: vi.fn(async ({ sequence }) => {
      const domain = current.domains.find((item) => item.domain === DOMAIN)
      if (domain) domain.inbound = domain.inbound.filter((event) => event.sequence !== sequence)
    }),
    reconnectDomain: async () => {
      reconnects += 1
    },
    provideHistory: async (_payload, listener) => {
      history = listener
    },
    resolveHistorySupply: async ({ supplyId, result }) => {
      resolvedHistory.push({ supplyId, ids: result.records.map((record) => record.message.id), done: result.done })
    },
    rejectHistorySupply: async () => {}
  }
  const messageStore = createMessageStore(database)
  for (const record of records) await messageStore.insert(record)
  const room = new ChatRoom({ server, messageStore, pageDomain: DOMAIN })

  /** One drain cycle through the real applier path. */
  const apply = async () => {
    room.applyChat(current)
    await room.applyPersistence(current)
  }
  const emitInbound = async (event: InboundEvent) => {
    const domain = current.domains.find((item) => item.domain === DOMAIN)
    if (!domain) throw new Error('domain missing')
    domain.inbound = [...domain.inbound, event]
    await room.applyPersistence(current)
  }
  const setInbound = async (events: InboundEvent[]) => {
    const domain = current.domains.find((item) => item.domain === DOMAIN)
    if (!domain) throw new Error('domain missing')
    domain.inbound = events
    await room.applyPersistence(current)
  }
  const emitFailure = async (event: RuntimeErrorEvent) => {
    current = { ...current, failures: [...current.failures, event] }
    room.applyChat(current)
    await Promise.resolve()
  }

  return {
    room,
    messageStore,
    server,
    sent,
    resolvedHistory,
    apply,
    emitInbound,
    setInbound,
    emitFailure,
    emitHistory: (event: HistorySupplyEvent) => history?.(event),
    leaveCount: () => leaves,
    reconnectCount: () => reconnects
  }
}

const setupHistoryCancellation = async () => {
  const fixture = await setup()
  const pagePort = new PagePort()
  const tabId = 1
  const server: RuntimeServer = {
    ...fixture.server,
    provideHistory: async ({ domain }, listener) => {
      pagePort.provideHistory(tabId, domain, listener)
    },
    resolveHistorySupply: vi.fn(async ({ supplyId, result }) => {
      pagePort.resolveHistorySupply(tabId, supplyId, result)
    }),
    rejectHistorySupply: vi.fn(async ({ supplyId, reason }) => {
      pagePort.rejectHistorySupply(tabId, supplyId, reason)
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
  const room = new ChatRoom({ server, messageStore, pageDomain: DOMAIN })
  room.applyChat(domainSnapshot())
  await room.applyPersistence(domainSnapshot())
  await settle()
  return { database, pagePort, queryStarted, releaseQuery, room, server, tabId }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Runtime-backed ChatRoom application port', () => {
  it('reconstructs a transport-safe Runtime error message for domain listeners', async () => {
    const { room, emitFailure } = await setup()
    const errors: Error[] = []
    room.onError((error) => errors.push(error))

    await emitFailure({
      eventId: 'event-1',
      message: 'Runtime transport disconnected',
      subsystem: 'connection',
      operation: 'lifecycle'
    })

    expect(errors).toEqual([new Error('Runtime transport disconnected')])
  })

  it('deduplicates repeated current failure facts while fresh failures stay visible', async () => {
    const { room, emitFailure } = await setup()
    const errors: Error[] = []
    room.onError((error) => errors.push(error))

    const event = {
      eventId: 'event-a',
      message: 'Runtime transport disconnected',
      subsystem: 'connection' as const,
      operation: 'lifecycle' as const
    }
    await emitFailure(event)
    await emitFailure(event)
    await emitFailure({ ...event, eventId: 'event-b' })

    expect(errors).toEqual([new Error('Runtime transport disconnected'), new Error('Runtime transport disconnected')])
  })

  it('isolates a throwing error listener so projection work continues', async () => {
    const fixture = await setup()
    const deliveryFailure = new Error('ChatRoom error listener failed')
    const listener = vi.fn(() => {
      throw deliveryFailure
    })
    fixture.room.onError(listener)
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    await fixture.emitFailure({
      eventId: 'event-1',
      message: 'Runtime callback registration failed',
      subsystem: 'connection',
      operation: 'lifecycle'
    })

    expect(listener).toHaveBeenCalledOnce()
    expect(diagnostic).toHaveBeenCalledWith(deliveryFailure)
    await expect(fixture.room.joinRoom({ user: USER, site: SITE })).resolves.toBeUndefined()
    diagnostic.mockRestore()
    fixture.room.dispose()
  })

  it('publishes initialization as one session snapshot without a synthetic join fact', async () => {
    const { room, apply } = await setup()
    const snapshots: Array<readonly ChatSession[]> = []
    const joins: ChatSession[] = []
    room.onSessions((sessions) => snapshots.push(sessions))
    room.onJoinRoom((session) => joins.push(session))

    await apply()
    await room.joinRoom({ user: USER, site: SITE })

    expect(snapshots).toEqual([[{ sessionId: 'local-session', user: USER }]])
    expect(joins).toEqual([])
  })

  it('persists one canonical self-join notice across repeated and parallel page joins', async () => {
    const database = createMemoryMessageDatabase(`self-join-${databaseId++}`)
    const first = await setup([], database, { fresh: true })
    const second = await setup([], database, { fresh: true })

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
    const stableNoticeId = `notice:${stringToHex(`self:join:${USER.id}:1`)}`
    const collision = textRecord(stableNoticeId)
    const seedStore = createMessageStore(database)
    await seedStore.insert(collision)
    const first = await setup([], database, { fresh: true })
    const second = await setup([], database, { fresh: true })

    await Promise.all([
      first.room.joinRoom({ user: USER, site: SITE }),
      second.room.joinRoom({ user: USER, site: SITE })
    ])
    await first.room.leaveRoom()
    await first.room.joinRoom({ user: USER, site: SITE })
    const reloaded = await setup([], database, { fresh: true })
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
    const fixture = await setup([], controlled, { fresh: true })
    const competingStore = createMessageStore(createMemoryMessageDatabase(databaseName))
    const stableNoticeId = `notice:${stringToHex(`self:join:${USER.id}:1`)}`
    const collision = textRecord(stableNoticeId)
    let raced = false
    controlled.beforeWrite = async () => {
      if (raced) return
      raced = true
      await competingStore.insert(collision)
    }

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

  it('does not let a near-match corrupt raw row suppress the canonical self-join notice', async () => {
    const databaseName = `self-join-near-match-${databaseId++}`
    const database = createMemoryMessageDatabase(databaseName)
    // The raw occupant at the actual first self-join slot matches every field a subset
    // classifier would check (type, JOIN, user id, hlc.timestamp) plus an unknown key: the
    // fallback must not interpret it — the typed occupant is absent after the load parse, so
    // the canonical notice is persisted at the next slot.
    const stableNoticeId = `notice:${stringToHex(`self:join:${USER.id}:1`)}`
    await database.write(['records'], (transaction) =>
      transaction.insert('records', stableNoticeId, {
        type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
        id: stableNoticeId,
        notice: { id: stableNoticeId, hlc: { timestamp: 1, counter: 0 }, type: NOTICE_TYPE.JOIN, body: 'near-match' },
        user: USER,
        receivedAt: 1,
        unknownExtraKey: true
      })
    )
    const fixture = await setup([], database, { fresh: true })
    await fixture.room.joinRoom({ user: USER, site: SITE })
    await settle()
    const records = await fixture.messageStore.query()
    const notices = records.filter((record) => record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.id).not.toBe(stableNoticeId)
    expect(notices[0]).toMatchObject({
      notice: { type: NOTICE_TYPE.JOIN, body: '"Local" joined the chat' },
      user: USER
    })
  })

  it('persists the fresh self-join notice from the projection even when the join response is lost', async () => {
    const database = createMemoryMessageDatabase(`self-join-projection-${databaseId++}`)
    const fixture = await setup([], database, { fresh: true })

    // No joinRoom action at all: the pulled current projection owns the one idempotent notice.
    await fixture.apply()
    await fixture.apply()

    const records = await fixture.messageStore.query()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
      notice: { type: NOTICE_TYPE.JOIN, body: '"Local" joined the chat' },
      user: USER
    })
  })

  it('a rejected self-join write stays unapplied so a later hint writes it exactly once', async () => {
    const database = createMemoryMessageDatabase(`self-join-retry-${databaseId++}`)
    const fixture = await setup([], database, { fresh: true })
    const failure = new Error('transient insert failure')
    vi.spyOn(fixture.messageStore, 'insert').mockRejectedValueOnce(failure)

    await expect(fixture.room.applyPersistence(domainSnapshotWithFresh())).rejects.toBe(failure)

    // A later explicit hint pulls the same `fresh` projection: the write is retried and succeeds.
    await fixture.room.applyPersistence(domainSnapshotWithFresh())
    await fixture.room.applyPersistence(domainSnapshotWithFresh())

    const records = await fixture.messageStore.query()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
      notice: { type: NOTICE_TYPE.JOIN, body: '"Local" joined the chat' }
    })
  })

  it('a valid same-host successor of an invalid sequence persists after the negative ACK terminal', async () => {
    const fixture = await setup()

    // An invalid record is classified, diagnosed, and ACKed false once (its ordinary terminal).
    const invalid = textRecord('invalid')
    vi.spyOn(fixture.messageStore, 'insert').mockRejectedValueOnce(new InvalidMessageRecordError('not a record'))
    await fixture.emitInbound({ sequence: 1, domain: DOMAIN, record: invalid, source: 'live' })
    expect(fixture.server.ackInbound).toHaveBeenCalledWith({ domain: DOMAIN, sequence: 1, inserted: false })

    // Same host, no empty projection in between: a valid successor reusing sequence 1 must
    // persist normally and ACK true (never discarded by the retired retry knowledge).
    const valid = textRecord('valid-successor')
    await fixture.emitInbound({ sequence: 1, domain: DOMAIN, record: valid, source: 'live' })

    await expect(fixture.messageStore.query()).resolves.toEqual([valid])
    expect(fixture.server.ackInbound).toHaveBeenLastCalledWith({ domain: DOMAIN, sequence: 1, inserted: true })
  })

  it('a failed negative ACK retains only the exact invalid record pair, never a reusable sequence', async () => {
    const fixture = await setup()

    // The invalid record's negative ACK rejects transiently: only the exact (sequence, recordId)
    // pair is retained for the same event's retry.
    const invalid = textRecord('invalid-b1')
    vi.spyOn(fixture.messageStore, 'insert').mockRejectedValueOnce(new InvalidMessageRecordError('not a record'))
    vi.mocked(fixture.server.ackInbound).mockRejectedValueOnce(new Error('ack transport lost'))
    await expect(fixture.emitInbound({ sequence: 1, domain: DOMAIN, record: invalid, source: 'live' })).rejects.toThrow(
      'ack transport lost'
    )

    // Same host reset with no empty projection in between (the buffer is abandoned): a valid
    // successor reusing sequence 1 with a different record identity must persist normally while
    // the failed pair still survives.
    const valid = textRecord('valid-b2')
    await fixture.setInbound([{ sequence: 1, domain: DOMAIN, record: valid, source: 'live' }])
    await expect(fixture.messageStore.query()).resolves.toEqual([valid])
    expect(fixture.server.ackInbound).toHaveBeenLastCalledWith({ domain: DOMAIN, sequence: 1, inserted: true })
  })

  it('the surviving exact pair retries only its negative ACK, never a re-insert', async () => {
    const fixture = await setup()
    const invalid = textRecord('invalid')
    vi.spyOn(fixture.messageStore, 'insert').mockRejectedValueOnce(new InvalidMessageRecordError('not a record'))
    vi.mocked(fixture.server.ackInbound).mockRejectedValueOnce(new Error('ack transport lost'))
    await expect(fixture.emitInbound({ sequence: 1, domain: DOMAIN, record: invalid, source: 'live' })).rejects.toThrow(
      'ack transport lost'
    )

    // The same (sequence, recordId) event still in the projection retries only the negative ACK.
    const insertCallsBefore = vi.mocked(fixture.messageStore.insert).mock.calls.length
    await fixture.apply()
    expect(fixture.server.ackInbound).toHaveBeenLastCalledWith({ domain: DOMAIN, sequence: 1, inserted: false })
    expect(vi.mocked(fixture.messageStore.insert).mock.calls.length).toBe(insertCallsBefore)
    await expect(fixture.messageStore.query()).resolves.toEqual([])
  })

  it('a host replacement dismisses every old History feedback owner and retires old supply work', async () => {
    const fixture = await setup()
    const events: { ownerId: string; type: string }[] = []
    fixture.room.onHistoryFeedback((event) => events.push({ ownerId: event.ownerId, type: event.type }))
    const withFeedback = domainSnapshot()
    withFeedback.domains[0]!.historyFeedback = [{ ownerId: 'b1-owner-1' }, { ownerId: 'b1-owner-2' }]
    fixture.room.applyChat(withFeedback)
    expect(events.map((event) => event.type)).toEqual(['loading', 'loading'])

    // The replacement projection has no owners: both old owners get exactly one dismiss.
    const replacement = domainSnapshot()
    replacement.hostId = 'host-2'
    fixture.room.applyChat(replacement)

    expect(events).toEqual([
      { ownerId: 'b1-owner-1', type: 'loading' },
      { ownerId: 'b1-owner-2', type: 'loading' },
      { ownerId: 'b1-owner-1', type: 'dismiss' },
      { ownerId: 'b1-owner-2', type: 'dismiss' }
    ])
  })

  it('a Runtime replacement resets only host-local applier state and re-provides History', async () => {
    const fixture = await setup([], createMemoryMessageDatabase(`host-replacement-${databaseId++}`))
    const provideHistory = vi.spyOn(fixture.server, 'provideHistory')
    await fixture.apply()
    expect(provideHistory).toHaveBeenCalledTimes(1)
    fixture.room.applyChat(domainSnapshot([remoteSession({ joinedAt: 2 })]))

    // The replacement host resets the session baseline, the History provider registration, and
    // the local dedup windows; durable business facts stay.
    const replacement = {
      ...domainSnapshot(),
      hostId: 'host-2',
      failures: [
        {
          eventId: 'new-host-failure',
          message: 'new host failure',
          subsystem: 'connection' as const,
          operation: 'lifecycle' as const
        }
      ]
    }
    fixture.room.applyChat(replacement)
    const joins: string[] = []
    fixture.room.onJoinRoom((session) => joins.push(session.sessionId))
    fixture.room.applyChat(replacement)
    await fixture.room.applyPersistence(replacement)

    expect(provideHistory).toHaveBeenCalledTimes(2)
    // The replacement host's first committed projection is a fresh baseline: no join events.
    expect(joins).toEqual([])
  })

  it('an invalid sequence from a replaced Runtime never discards the new Runtime valid record', async () => {
    const fixture = await setup([], createMemoryMessageDatabase(`cross-host-seq-${databaseId++}`))

    // B1: a record that cannot become durable is ACKed false once (ordinary terminal).
    const invalid = textRecord('invalid-b1')
    vi.spyOn(fixture.messageStore, 'insert').mockRejectedValueOnce(new InvalidMessageRecordError('not a record'))
    await fixture.emitInbound({ sequence: 1, domain: DOMAIN, record: invalid, source: 'live' })
    expect(fixture.server.ackInbound).toHaveBeenCalledWith({ domain: DOMAIN, sequence: 1, inserted: false })

    // B2 (replacement host): the same sequence 1 is a valid record and must persist + ACK true.
    const replacement = domainSnapshot()
    replacement.hostId = 'host-2'
    const valid = textRecord('valid-b2')
    replacement.domains[0]!.inbound = [{ sequence: 1, domain: DOMAIN, record: valid, source: 'live' }]
    fixture.room.applyChat(replacement)
    await fixture.room.applyPersistence(replacement)

    await expect(fixture.messageStore.query()).resolves.toEqual([valid])
    expect(fixture.server.ackInbound).toHaveBeenLastCalledWith({ domain: DOMAIN, sequence: 1, inserted: true })
  })

  it('publishes the new snapshot before each accepted live join and leave fact', async () => {
    const { room, apply } = await setup()
    const order: string[] = []
    room.onSessions((sessions) => order.push(`sessions:${sessions.map((item) => item.sessionId).join(',')}`))
    room.onJoinRoom((session) => order.push(`join:${session.sessionId}`))
    room.onLeaveRoom((session) => order.push(`leave:${session.sessionId}`))
    await apply()
    order.length = 0

    const remote = remoteSession()
    room.applyChat(domainSnapshot([remote]))
    room.applyChat(domainSnapshot([]))

    expect(order).toEqual([
      'sessions:local-session,remote-session',
      'join:remote-session',
      'sessions:local-session',
      'leave:remote-session'
    ])
  })

  it('emits membership facts only for the first and final live session of each user', async () => {
    const { room, apply } = await setup()
    const joins: ChatSession[] = []
    const leaves: ChatSession[] = []
    room.onJoinRoom((session) => joins.push(session))
    room.onLeaveRoom((session) => leaves.push(session))
    await apply()

    const first = remoteSession({ sourcePeerId: 'remote-peer-1', sessionId: 'remote-session-1', joinedAt: 2 })
    const second = remoteSession({ sourcePeerId: 'remote-peer-2', sessionId: 'remote-session-2', joinedAt: 3 })
    room.applyChat(domainSnapshot([first]))
    room.applyChat(domainSnapshot([first, second]))
    room.applyChat(domainSnapshot([second]))
    room.applyChat(domainSnapshot([]))

    expect(joins).toEqual([{ sessionId: first.sessionId, user: REMOTE }])
    expect(leaves).toEqual([{ sessionId: second.sessionId, user: REMOTE }])
  })

  it('does not fabricate a leave and rejoin for a same-user incarnation replacement', async () => {
    const { room, apply } = await setup()
    const order: string[] = []
    room.onSessions((sessions) => order.push(`sessions:${sessions.map((item) => item.sessionId).join(',')}`))
    room.onJoinRoom((session) => order.push(`join:${session.sessionId}`))
    room.onLeaveRoom((session) => order.push(`leave:${session.sessionId}`))
    await apply()

    const previous = remoteSession({ sessionId: 'remote-session-1', joinedAt: 2 })
    const replacement = { ...previous, sessionId: 'remote-session-2', joinedAt: 3 }
    room.applyChat(domainSnapshot([previous]))
    order.length = 0
    room.applyChat(domainSnapshot([replacement]))

    expect(order).toEqual(['sessions:local-session,remote-session-2'])
  })

  it('derives both sides of a changed-user replacement from the resulting snapshot', async () => {
    const { room, apply } = await setup()
    const order: string[] = []
    room.onSessions((sessions) => order.push(`sessions:${sessions.map((item) => item.sessionId).join(',')}`))
    room.onJoinRoom((session) => order.push(`join:${session.user.id}`))
    room.onLeaveRoom((session) => order.push(`leave:${session.user.id}`))
    await apply()

    const previous = remoteSession({ sessionId: 'remote-session-1', joinedAt: 2 })
    const replacement = { ...previous, sessionId: 'remote-session-2', user: OTHER, joinedAt: 3 }
    room.applyChat(domainSnapshot([previous]))
    order.length = 0
    room.applyChat(domainSnapshot([replacement]))

    expect(order).toEqual(['sessions:local-session,remote-session-2', 'leave:remote-user', 'join:other-user'])
  })

  it('does not emit a live join for a remote generation not later than the local one', async () => {
    const { room, apply } = await setup()
    const joins: ChatSession[] = []
    room.onJoinRoom((session) => joins.push(session))
    await apply()

    // An older/equal generation converges silently as current state (no notice).
    room.applyChat(domainSnapshot([remoteSession({ joinedAt: 1 })]))
    expect(joins).toEqual([])
  })

  it('emits only a first-inserted remote live message after persistence', async () => {
    const { room, emitInbound, messageStore } = await setup()
    const messages: ChatMessage[] = []
    room.onMessage((message) => messages.push(message))
    const record = textRecord('remote-live')

    await emitInbound({ sequence: 1, domain: DOMAIN, record, source: 'live' })
    await emitInbound({ sequence: 2, domain: DOMAIN, record, source: 'live' })
    await emitInbound({ sequence: 3, domain: DOMAIN, record: textRecord('history'), source: 'history' })

    expect(messages).toEqual([record.message])
    await expect(messageStore.query()).resolves.toEqual([textRecord('history'), record])
  })

  it('persists a runtime-accepted record through an ACK failure and recovers on the next projection', async () => {
    const { room, emitInbound, messageStore, server } = await setup()
    const messages: ChatMessage[] = []
    room.onMessage((message) => messages.push(message))
    vi.mocked(server.ackInbound).mockRejectedValueOnce(new Error('invalid ACK failed'))

    // The Runtime hands the adapter an already schema-accepted typed record: persistence write
    // trusts it (the receiving boundary is authoritative), so the record is inserted; the ACK
    // transport failure rejects the apply, and the next projection retries the same fact.
    const accepted = textRecord('accepted-inbound')
    await expect(emitInbound({ sequence: 1, domain: DOMAIN, record: accepted, source: 'live' })).rejects.toThrow(
      'invalid ACK failed'
    )

    expect(messages).toEqual([accepted.message])
    await expect(messageStore.query()).resolves.toEqual([accepted])
    expect(server.ackInbound).toHaveBeenCalledWith({ domain: DOMAIN, sequence: 1, inserted: true })

    const valid = textRecord('valid-after-retry')
    await emitInbound({ sequence: 2, domain: DOMAIN, record: valid, source: 'live' })

    expect(messages).toEqual([accepted.message, valid.message])
    await expect(messageStore.query()).resolves.toEqual([accepted, valid])
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
    const record = textRecord('shared-live')

    await Promise.all([
      first.emitInbound({ sequence: 1, domain: DOMAIN, record, source: 'live' }),
      second.emitInbound({ sequence: 1, domain: DOMAIN, record, source: 'live' })
    ])

    expect([...firstMessages, ...secondMessages]).toEqual([record.message])
    await expect(first.messageStore.query()).resolves.toEqual([record])
  })

  it('emits an inserted live message once even when its Runtime ACK rejects the first apply', async () => {
    const { room, emitInbound, apply, server } = await setup()
    const messages: ChatMessage[] = []
    room.onMessage((message) => messages.push(message))
    vi.mocked(server.ackInbound).mockRejectedValueOnce(new Error('ack failed'))
    const record = textRecord('ack-retry')

    await expect(emitInbound({ sequence: 4, domain: DOMAIN, record, source: 'live' })).rejects.toThrow('ack failed')
    expect(messages).toEqual([record.message])

    // The next projection of the same retained fact re-persists idempotently and ACKs once more.
    await apply()
    expect(server.ackInbound).toHaveBeenCalledTimes(2)
    expect(messages).toEqual([record.message])
  })

  it('returns an accepted text before its independent insertion settles', async () => {
    const order: string[] = []
    const insertion = Promise.withResolvers<void>()
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(`send-first-${databaseId++}`))
    const fixture = await setup([], controlled)
    vi.mocked(fixture.server.sendChatMessage).mockImplementation(async ({ event }) => {
      order.push(`send:${event.id}`)
      fixture.sent.push(event)
      return event
    })
    await fixture.room.joinRoom({ user: USER, site: SITE })
    order.length = 0
    controlled.beforeWrite = async () => {
      order.push('insert')
      await insertion.promise
    }

    const textTask = fixture.room.sendMessage({ type: 'text', body: 'hello', mentions: [] })
    await vi.waitFor(() => expect(order).toEqual(['send:allocated-text', 'insert']))
    const text = await textTask

    expect(text).toMatchObject({ type: MESSAGE_TYPE.TEXT, id: 'allocated-text', body: 'hello' })
    expect(order).toEqual(['send:allocated-text', 'insert'])
    insertion.resolve()
    await vi.waitFor(async () => expect(await fixture.messageStore.query()).toHaveLength(1))
    expect(
      (await fixture.messageStore.query())
        .filter((record) => record.type === MESSAGE_RECORD_TYPE.CHAT_MESSAGE)
        .map((record) => record.id)
    ).toEqual(['allocated-text'])
  })

  it('keeps reaction transport and insertion in the awaited settlement', async () => {
    const insertion = Promise.withResolvers<void>()
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(`reaction-settlement-${databaseId++}`))
    controlled.beforeWrite = () => insertion.promise
    const fixture = await setup([], controlled)

    let settled = false
    const reactionTask = fixture.room
      .sendMessage({ type: 'reaction', targetId: 'target', reaction: 'like', active: true })
      .then((message) => {
        settled = true
        return message
      })
    await vi.waitFor(() => expect(fixture.server.sendChatMessage).toHaveBeenCalledOnce())
    await settle()
    expect(settled).toBe(false)

    insertion.resolve()
    await expect(reactionTask).resolves.toMatchObject({
      type: MESSAGE_TYPE.REACTION,
      id: 'allocated-reaction',
      targetId: 'target'
    })
  })

  it('returns this call allocated message instead of a same-id canonical winner', async () => {
    const existing = textRecord('allocated-text', REMOTE)
    const fixture = await setup([existing])

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

  it('does not insert or return a message when protocol acceptance rejects', async () => {
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(`send-reject-${databaseId++}`))
    const beforeWrite = vi.fn()
    controlled.beforeWrite = beforeWrite
    const fixture = await setup([], controlled)
    vi.mocked(fixture.server.sendChatMessage).mockRejectedValue(new Error('transport rejected'))

    await expect(fixture.room.sendMessage({ type: 'text', body: 'hello', mentions: [] })).rejects.toThrow(
      'transport rejected'
    )
    expect(beforeWrite).not.toHaveBeenCalled()
    await expect(fixture.messageStore.query()).resolves.toEqual([])
  })

  it('returns the accepted text and routes the original insertion failure without cancelling transport', async () => {
    const controlled = new ControlledDatabase(createMemoryMessageDatabase(`local-loss-${databaseId++}`))
    const persistenceError = new Error('local persistence failed')
    controlled.beforeWrite = () => {
      throw persistenceError
    }
    const fixture = await setup([], controlled)
    const errors: Error[] = []
    fixture.room.onError((error) => errors.push(error))

    await expect(fixture.room.sendMessage({ type: 'text', body: 'hello', mentions: [] })).resolves.toMatchObject({
      id: 'allocated-text',
      body: 'hello'
    })
    await vi.waitFor(() => expect(errors).toEqual([persistenceError]))
    expect(fixture.sent.map((message) => message.id)).toEqual(['allocated-text'])
    expect(fixture.server.sendChatMessage).toHaveBeenCalledOnce()
  })

  it('queries only Chat records and projects history criteria outside the store', async () => {
    const recent = textRecord('recent', REMOTE, 20)
    const older = textRecord('older', REMOTE, 10)
    const fixture = await setup([older, noticeRecord('notice', 30), recent])
    const query = vi.spyOn(fixture.messageStore, 'query')
    await fixture.apply()

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
    const supplied = fixture.pagePort.supplyHistory(`tab:${fixture.tabId}`, request).then(
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
    const oldSupply = fixture.pagePort.supplyHistory(`tab:${fixture.tabId}`, oldRequest).then(
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
      await fixture.server.provideHistory({ domain: DOMAIN }, (event) => {
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
      const newSupply = fixture.pagePort
        .supplyHistory(`tab:${fixture.tabId}`, newRequest)
        .catch((error: Error) => error)
      expect(replacementEvents).toEqual([{ type: 'request', request: newRequest }])
      fixture.releaseQuery.resolve([])
      await settle()
      await settle()

      // After physical exit the old supply settles exactly once (replacement mode resolves null),
      // while the new supply (owned by the replacement provider registration) stays pending.
      expect(fixture.server.rejectHistorySupply).toHaveBeenCalledOnce()
      expect(fixture.server.rejectHistorySupply).toHaveBeenCalledWith({
        supplyId: oldRequest.supplyId,
        reason: 'History supply cancelled'
      })
      expect(oldSupplyResult).toBeNull()
      expect(fixture.pagePort.pendingHistoryCountForTest()).toBe(1)
      expect(fixture.server.resolveHistorySupply).not.toHaveBeenCalled()

      fixture.pagePort.removePage(fixture.tabId)
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
    const { room, leaveCount, reconnectCount, apply } = await setup()
    const snapshots: Array<readonly ChatSession[]> = []
    const leaves: ChatSession[] = []
    room.onSessions((sessions) => snapshots.push(sessions))
    room.onLeaveRoom((session) => leaves.push(session))
    await apply()
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

    await expect(room.leaveRoom()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports a superseded attempt token cancelled before aborting it (real Runtime adapter)', async () => {
    const heldJoin = new Promise<RuntimeSnapshot>(() => {})
    const database = createMemoryMessageDatabase(`supersede-${databaseId++}`)
    const messageStore = createMessageStore(database)
    const server: RuntimeServer = {
      ...(await setup()).server,
      joinChatRoom: async () => heldJoin
    }
    const lifecycle = createConnectionLifecycle()
    const room = new ChatRoom({ server, messageStore, pageDomain: DOMAIN })
    room.bindConnectionResultReporter(lifecycle.report)
    room.bindStandaloneInvocation(lifecycle.value.mint, lifecycle.value.bindTask)

    // First join holds its provider call; a second join supersedes it by beginConnectionAttempt, which
    // must report the predecessor token cancelled BEFORE aborting it (first-terminal-wins).
    const first = room.joinRoom({ user: USER, site: SITE })
    await settle()
    const second = room.joinRoom({ user: USER, site: SITE })
    await settle()

    // Both task rejections keep their exact expected identity instead of a silent sink: the first
    // rejects on supersession and the second on disposal-time page detachment.
    const firstRejection = expect(first).rejects.toThrow('Page connection attempt superseded')
    const secondRejection = expect(second).rejects.toThrow('Runtime page detached')
    await settle()

    expect(lifecycle.value.getTaskResult(first)).toBe('cancelled')
    room.dispose()
    await firstRejection
    await secondRejection
    await database.close()
  })
})
