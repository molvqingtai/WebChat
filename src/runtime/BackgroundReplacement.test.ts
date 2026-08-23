import { describe, expect, it, vi } from 'vitest'
import { MESSAGE_TYPE } from '@/protocol'
import { getChatRoomId } from '@/runtime/Server'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import type { WireCodec } from '@/protocol'
import { InvalidMessageRecordError } from '@/domain/MessageStore'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { createMessageStore } from '@/domain/MessageStore'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { DocumentClient } from '@/runtime/DocumentClient'
import {
  createServer,
  disposeServer,
  notifyServerTabs,
  readServerSnapshot,
  type RuntimeAdmission
} from '@/runtime/Server'
import type { HistorySupplyEvent, RuntimeServer } from '@/runtime/Contract'

const DOMAIN = 'https://example.com'

const createTransport = () => {
  const joined = new Set<string>()
  const messageListeners = new Set<(roomId: string, sourcePeerId: string, payload: string) => void>()
  const sent: Array<{ roomId: string; payload: string }> = []
  const peersByRoom = new Map<string, Set<string>>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  const errorListeners = new Set<(error: Error, roomId: string) => void>()
  const transport: RoomTransport = {
    peerIdOf: (roomId) => (roomId.startsWith('WEB_CHAT_WORLD') ? 'local-peer' : `local-peer:${roomId}`),
    join: async (roomId) => {
      joined.add(roomId)
      const members = [...(peersByRoom.get(roomId) ?? [])]
      queueMicrotask(() => {
        if (joined.has(roomId))
          members.forEach((peerId) => joinListeners.forEach((listener) => listener(roomId, peerId)))
      })
    },
    leave: (roomId) => {
      joined.delete(roomId)
    },
    send: async (roomId, payload) => {
      sent.push({ roomId, payload })
    },
    onMessage: (listener) => {
      messageListeners.add(listener)
      return () => messageListeners.delete(listener)
    },
    onPeerJoin: (listener) => {
      joinListeners.add(listener)
      return () => joinListeners.delete(listener)
    },
    onPeerLeave: (listener) => {
      leaveListeners.add(listener)
      return () => leaveListeners.delete(listener)
    },
    onRoomClose: (listener) => {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    onError: (listener) => {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    dispose: () => {
      joined.clear()
    }
  }
  return {
    transport,
    joined,
    sent,
    plantPeer: (roomId: string, peerId: string) => {
      const peers = peersByRoom.get(roomId) ?? new Set<string>()
      peers.add(peerId)
      peersByRoom.set(roomId, peers)
    },
    peerJoin: (roomId: string, peerId: string) => joinListeners.forEach((listener) => listener(roomId, peerId)),
    receive: (roomId: string, sourcePeerId: string, message: unknown) =>
      messageListeners.forEach((listener) => listener(roomId, sourcePeerId, JSON.stringify(message)))
  }
}

const caller = { tab: { id: 1, url: `${DOMAIN}/` } }

const flush = async (turns = 10) => {
  for (let index = 0; index < turns; index += 1) await Promise.resolve()
}

const jsonCodec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload as string)
}

/**
 * One real DocumentClient survives a logical Background replacement through the same proxies:
 * the fake tab listener is the only notification path, exactly like the browser message bus.
 */
const textRecord = (id: string, timestamp = 1): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.TEXT,
    id,
    hlc: { timestamp, counter: 0 },
    userId: 'user-a',
    body: id,
    mentions: []
  },
  user: { id: 'user-a', name: 'A', avatar: '' },
  receivedAt: timestamp
})

describe('DocumentClient across a logical Background replacement', () => {
  it.each(['resolve', 'reject'] as const)(
    'retires a physically pending B1 History supply on replacement without touching B2 (late %s)',
    async (branch) => {
      const hints: unknown[] = []
      const listeners = new Set<(message: unknown) => void>()
      const admission: RuntimeAdmission = {
        tabs: {
          get: async (tabId: number) => ({ id: tabId, url: `${DOMAIN}/` }),
          query: async () => [{ id: 1, url: `${DOMAIN}/` }],
          sendMessage: async (_tabId: number, message: unknown) => {
            hints.push(message)
            listeners.forEach((listener) => listener(message))
          }
        },
        ensureTransport: async () => {}
      }
      const fake = createTransport()
      let current = createServer({ transport: fake.transport, admission, codec: jsonCodec })
      const provideHistory = vi.fn()
      const resolveHistorySupply = vi.fn()
      const rejectHistorySupply = vi.fn()
      const b1SupplyIds = new Set<string>()
      const b2SupplyIds = new Set<string>()
      const b1Terminal = Promise.withResolvers<never>()
      // The terminal hold arms only after the held query, so the join-time supply settlement and
      // the requester attempt admission are never blocked by the gate.
      let armTerminalHold = false
      let b1TerminalHeldConsumed = false
      // B2's terminal gets its own independent gate, held (first call only) until released after
      // B1's late settlement proves it cannot be touched.
      const b2Terminal = Promise.withResolvers<void>()
      let b2TerminalHeld = false
      const coordinator = {
        registerPage: async (payload: { domain: string }) => ({
          snapshot: await current.attachPage({ ...payload, caller })
        })
      }
      const facade = {
        getSnapshot: (payload?: { domain?: string }) => current.getSnapshot({ ...payload, caller }),
        joinChatRoom: (payload: { domain: string; user: never; site: never }) =>
          current.joinChatRoom({ ...payload, caller }),
        provideHistory: (payload: { domain: string }, callback: Parameters<RuntimeServer['provideHistory']>[1]) => {
          const registration = provideHistory.mock.calls.length + 1
          provideHistory(payload)
          const observingCallback: Parameters<RuntimeServer['provideHistory']>[1] = (event) => {
            if (event.type === 'request' && registration === 1) b1SupplyIds.add(event.request.supplyId)
            if (event.type === 'request' && registration !== 1) b2SupplyIds.add(event.request.supplyId)
            callback(event)
          }
          return current.provideHistory({ ...payload, caller }, observingCallback)
        },
        ackInbound: (payload: { domain: string; sequence: number; inserted: boolean }) =>
          current.ackInbound({ ...payload, caller }),
        resolveHistorySupply: async (payload: { supplyId: string; result: { records: never[]; done: boolean } }) => {
          resolveHistorySupply(payload)
          if (b2TerminalHeld && b2SupplyIds.has(payload.supplyId)) await b2Terminal.promise
          if (armTerminalHold && !b1TerminalHeldConsumed && b1SupplyIds.has(payload.supplyId)) {
            b1TerminalHeldConsumed = true
            await b1Terminal.promise
          }
          return current.resolveHistorySupply({ ...payload, caller })
        },
        rejectHistorySupply: async (payload: { supplyId: string; reason: string }) => {
          rejectHistorySupply(payload)
          if (armTerminalHold && !b1TerminalHeldConsumed && b1SupplyIds.has(payload.supplyId)) {
            b1TerminalHeldConsumed = true
            await b1Terminal.promise
          }
          return current.rejectHistorySupply({ ...payload, caller })
        }
      } as unknown as RuntimeServer

      const client = new DocumentClient({ coordinator, server: facade, domain: DOMAIN })
      listeners.add((message) => {
        if ((message as { type?: string }).type === 'runtime:state-changed') client.invalidate()
      })
      const messageStore = createMessageStore(createMemoryMessageDatabase(`history-retirement-${branch}`))
      const chat = new ChatRoom({ server: facade, messageStore, pageDomain: DOMAIN })
      const feedback: Array<{ ownerId: string; type: string }> = []
      chat.onHistoryFeedback((event) => feedback.push({ ownerId: event.ownerId, type: event.type }))
      const errors: Error[] = []
      chat.onError((error) => errors.push(error))
      client.registerApplier('chat', (projection) => chat.applyChat(projection))
      client.registerApplier('persistence', (projection, context) => chat.applyPersistence(projection, context))

      await client.init()
      fake.plantPeer(getChatRoomId(DOMAIN), 'peer-a')
      // Join the room so the History domain admits a real peer requester pull.
      await facade.joinChatRoom({
        domain: DOMAIN,
        user: { id: 'local-user', name: 'Local', avatar: '' } as never,
        site: { origin: DOMAIN, title: 'Example' } as never
      })
      expect(provideHistory).toHaveBeenCalledTimes(1)

      // A real peer binds and issues a genuine History inventory pull; the ChatRoom's physical
      // MessageStore query starts and is held with its exact signal.
      const queryStarted = Promise.withResolvers<AbortSignal>()
      const releaseQuery = Promise.withResolvers<readonly never[]>()
      let supplyCount = 0
      vi.spyOn(messageStore, 'query').mockImplementation(async (query) => {
        supplyCount += 1
        if (supplyCount === 1) {
          queryStarted.resolve(query?.signal ?? new AbortController().signal)
          return releaseQuery.promise as never
        }
        return [] as never
      })
      fake.plantPeer(getChatRoomId(DOMAIN), 'peer-a')
      fake.receive(getChatRoomId(DOMAIN), 'peer-a', {
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-a',
        presenceId: 'presence-a',
        joinedAt: Date.now() + 1,
        user: { id: 'user-a', name: 'A', avatar: '' }
      })
      fake.peerJoin(getChatRoomId(DOMAIN), 'peer-a')
      fake.receive(getChatRoomId(DOMAIN), 'peer-a', {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: 'sync-1',
        page: 0,
        messageIds: [],
        done: true
      })
      // A genuine requester pull now loads one record so the attempt owns a live loading feedback
      // owner (done=false keeps the attempt active through the replacement).
      const requesterPull = await vi.waitFor(
        () => {
          const pull = fake.sent.find(
            (frame) => (JSON.parse(frame.payload) as { type?: string }).type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
          )
          expect(pull).toBeDefined()
          return JSON.parse(pull!.payload) as { syncId: string }
        },
        { timeout: 5000 }
      )
      fake.receive(getChatRoomId(DOMAIN), 'peer-a', {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
        syncId: requesterPull.syncId,
        page: 0,
        users: [{ id: 'user-a', name: 'A', avatar: '' }],
        messages: [
          {
            type: MESSAGE_TYPE.TEXT,
            id: 'history-record-1',
            hlc: { timestamp: Date.now(), counter: 0 },
            userId: 'user-a',
            body: 'history-record-1',
            mentions: []
          }
        ],
        done: false
      })
      await vi.waitFor(() => expect(feedback.some((event) => event.type === 'loading')).toBe(true), {
        timeout: 5000
      })
      expect(feedback.filter((event) => event.type === 'loading')).toHaveLength(1)
      const loadingOwner = feedback.find((event) => event.type === 'loading')!.ownerId

      const querySignal = await queryStarted.promise

      // The B1 physical query settles, but its terminal RPC is held: the chain now parks at a
      // real pending terminal (exactly one pre-cut B1 facade call).
      armTerminalHold = true
      if (branch === 'resolve') releaseQuery.resolve([])
      else releaseQuery.reject(new Error('B1 query failed before replacement'))
      const held = branch === 'resolve' ? resolveHistorySupply : rejectHistorySupply
      await vi.waitFor(() => {
        expect(held.mock.calls.filter((call) => b1SupplyIds.has(call[0]!.supplyId))).toHaveLength(1)
      })

      // Logical Background replacement arrives with B1's terminal RPC still pending: the reset
      // owner aborts the old controller before the document re-registers and re-provides.
      const b1 = current
      current = createServer({ transport: fake.transport, admission, codec: jsonCodec })
      // Terminal assertions scope to after the replacement; the held B1 call happened pre-cut.
      resolveHistorySupply.mockClear()
      rejectHistorySupply.mockClear()
      notifyServerTabs(current)
      await vi.waitFor(async () => {
        expect((await readServerSnapshot(current)).domains[0]?.tabIds).toEqual([1])
      })
      expect(querySignal.aborted).toBe(true)
      await vi.waitFor(() => expect(provideHistory).toHaveBeenCalledTimes(2))

      // B2 converges through the ordinary rejoin flow: the peer re-commits, the fresh Runtime
      // restarts its token sequence, and its own supply request lands on the SAME supply slot.
      await facade.joinChatRoom({
        domain: DOMAIN,
        user: { id: 'local-user', name: 'Local', avatar: '' } as never,
        site: { origin: DOMAIN, title: 'Example' } as never
      })
      fake.receive(getChatRoomId(DOMAIN), 'peer-a', {
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-a',
        presenceId: 'presence-a',
        joinedAt: Date.now() + 1,
        user: { id: 'user-a', name: 'A', avatar: '' }
      })
      fake.peerJoin(getChatRoomId(DOMAIN), 'peer-a')
      fake.receive(getChatRoomId(DOMAIN), 'peer-a', {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: 'sync-1',
        page: 0,
        messageIds: [],
        done: true
      })
      b2TerminalHeld = true
      await vi.waitFor(() => expect(b2SupplyIds.size).toBeGreaterThan(0))
      expect([...b2SupplyIds].some((supplyId) => b1SupplyIds.has(supplyId))).toBe(true)
      // B2's terminal RPC is pending on the same supply slot before B1's late settlement.
      await vi.waitFor(() => {
        expect(
          resolveHistorySupply.mock.calls.filter((call) => b2SupplyIds.has(call[0]!.supplyId)).length
        ).toBeGreaterThan(0)
      })

      // The held B1 terminal now settles late (its transport rejects): the stale chain must not
      // publish any error, add any post-cut facade call for B1 identity, or disturb B2's entry.
      b1Terminal.reject(new Error('B1 terminal transport lost') as never)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(errors).toEqual([])
      // Post-cut window: the stale chain's continuation is fully silent — no reject call at all,
      // and B2's terminal stays pending on the same slot.
      expect(rejectHistorySupply).not.toHaveBeenCalled()

      // B2 then settles independently through its own current terminal with its true result.
      b2TerminalHeld = false
      b2Terminal.resolve()
      await vi.waitFor(() => {
        expect(
          resolveHistorySupply.mock.calls.filter((call) => b2SupplyIds.has(call[0]!.supplyId)).length
        ).toBeGreaterThan(0)
      })

      // The genuine attempt's loading owner is dismissed exactly once across the replacement.
      expect(feedback.filter((event) => event.ownerId === loadingOwner && event.type === 'dismiss')).toHaveLength(1)
      expect((await readServerSnapshot(current)).failures).toEqual([])
      expect((await readServerSnapshot(current)).hostPhase).toBe('ready')

      disposeServer(b1)
      disposeServer(current)
    }
  )

  it("a current exact owner's escaping terminal Error is published, never self-suppressed", async () => {
    const errors: Error[] = []
    const original = new Error('terminal facade exploded')
    let handler: ((event: HistorySupplyEvent) => void) | null = null
    const server: RuntimeServer = {
      attachPage: async () => {
        throw new Error('not used')
      },
      getSnapshot: async () => {
        throw new Error('not used')
      },
      joinChatRoom: async () => {
        throw new Error('not used')
      },
      leaveChatRoom: async () => {},
      allocateTextMessage: async () => {
        throw new Error('not used')
      },
      allocateReactionMessage: async () => {
        throw new Error('not used')
      },
      sendChatMessage: async ({ event }) => event,
      ackInbound: async () => {},
      reconnectDomain: async () => {},
      provideHistory: async (_payload, callback) => {
        handler = callback
      },
      resolveHistorySupply: () => {
        // A synchronous facade throw escapes the normal Promise-rejection path entirely.
        throw original
      },
      rejectHistorySupply: () => {
        throw original
      }
    }
    const messageStore = createMessageStore(createMemoryMessageDatabase('current-owner-sink'))
    const room = new ChatRoom({ server, messageStore, pageDomain: DOMAIN })
    room.onError((error) => errors.push(error))
    const projection = {
      hostId: 'host-1',
      hostPhase: 'ready' as const,
      peerId: 'local-peer',
      domains: [
        {
          domain: DOMAIN,
          phase: 'active' as const,
          tabIds: [1],
          chatRoomJoined: true,
          sessions: [],
          inbound: [],
          historyFeedback: []
        }
      ],
      world: { joined: true, peerId: 'local-peer', presences: [] },
      failures: []
    }
    await room.applyPersistence(projection)

    handler!({
      type: 'request',
      request: { supplyId: 'supply-current', domain: DOMAIN, syncId: 'sync-current', cutoff: 0, mode: 'provider' }
    })
    await vi.waitFor(() => expect(errors).toEqual([original]))
    room.dispose()
  })

  it('a fallible rejection value is normalized safely before entry retirement, keeping cause', async () => {
    const errors: Error[] = []
    // A rejection value whose property access throws on every read (message and stringification).
    const fallible = new Proxy(
      {},
      {
        get() {
          throw new Error('fallible property read')
        }
      }
    )
    let handler: ((event: HistorySupplyEvent) => void) | null = null
    const reasons: string[] = []
    const server: RuntimeServer = {
      attachPage: async () => {
        throw new Error('not used')
      },
      getSnapshot: async () => {
        throw new Error('not used')
      },
      joinChatRoom: async () => {
        throw new Error('not used')
      },
      leaveChatRoom: async () => {},
      allocateTextMessage: async () => {
        throw new Error('not used')
      },
      allocateReactionMessage: async () => {
        throw new Error('not used')
      },
      sendChatMessage: async ({ event }) => event,
      ackInbound: async () => {},
      reconnectDomain: async () => {},
      provideHistory: async (_payload, callback) => {
        handler = callback
      },
      resolveHistorySupply: async () => {},
      rejectHistorySupply: async ({ reason }) => {
        reasons.push(reason)
      }
    }
    const messageStore = createMessageStore(createMemoryMessageDatabase('fallible-normalization'))
    // The physical query itself rejects with the fallible value.
    vi.spyOn(messageStore, 'query').mockRejectedValue(fallible)
    const room = new ChatRoom({ server, messageStore, pageDomain: DOMAIN })
    room.onError((error) => errors.push(error))
    const projection = {
      hostId: 'host-1',
      hostPhase: 'ready' as const,
      peerId: 'local-peer',
      domains: [
        {
          domain: DOMAIN,
          phase: 'active' as const,
          tabIds: [1],
          chatRoomJoined: true,
          sessions: [],
          inbound: [],
          historyFeedback: []
        }
      ],
      world: { joined: true, peerId: 'local-peer', presences: [] },
      failures: []
    }
    await room.applyPersistence(projection)

    handler!({
      type: 'request',
      request: { supplyId: 'supply-fallible', domain: DOMAIN, syncId: 'sync-fallible', cutoff: 0, mode: 'provider' }
    })

    // The safe normalization publishes the fixed fallback through the ordinary reject terminal —
    // no fallible read escapes, and the current owner retires its entry normally.
    await vi.waitFor(() => expect(reasons).toEqual(['History supply failed']))
    expect(errors).toEqual([])
    room.dispose()
  })

  it('a valid same-sequence successor persists through the real Server/Delivery reconnect chain', async () => {
    const listeners = new Set<(message: unknown) => void>()
    const admission: RuntimeAdmission = {
      tabs: {
        get: async (tabId: number) => ({ id: tabId, url: `${DOMAIN}/` }),
        query: async () => [{ id: 1, url: `${DOMAIN}/` }],
        sendMessage: async (_tabId: number, message: unknown) => {
          listeners.forEach((listener) => listener(message))
        }
      },
      ensureTransport: async () => {}
    }
    const fake = createTransport()
    const server = createServer({ transport: fake.transport, admission, codec: jsonCodec })
    const ackInbound = vi.fn()
    let rejectNextAck = true
    const coordinator = {
      registerPage: async (payload: { domain: string }) => ({
        snapshot: await server.attachPage({ ...payload, caller })
      })
    }
    const facade = {
      getSnapshot: (payload?: { domain?: string }) => server.getSnapshot({ ...payload, caller }),
      joinChatRoom: (payload: { domain: string; user: never; site: never }) =>
        server.joinChatRoom({ ...payload, caller }),
      reconnectDomain: (payload: { domain: string }) => server.reconnectDomain({ ...payload, caller }),
      provideHistory: (payload: { domain: string }, callback: Parameters<RuntimeServer['provideHistory']>[1]) =>
        server.provideHistory({ ...payload, caller }, callback),
      ackInbound: async (payload: { domain: string; sequence: number; inserted: boolean }) => {
        ackInbound(payload)
        if (rejectNextAck) {
          rejectNextAck = false
          throw new Error('ACK transport lost')
        }
        return server.ackInbound({ ...payload, caller })
      },
      resolveHistorySupply: (payload: { supplyId: string; result: { records: never[]; done: boolean } }) =>
        server.resolveHistorySupply({ ...payload, caller }),
      rejectHistorySupply: (payload: { supplyId: string; reason: string }) =>
        server.rejectHistorySupply({ ...payload, caller })
    } as unknown as RuntimeServer

    const client = new DocumentClient({ coordinator, server: facade, domain: DOMAIN })
    listeners.add((message) => {
      if ((message as { type?: string }).type === 'runtime:state-changed') client.invalidate()
    })
    const messageStore = createMessageStore(createMemoryMessageDatabase('delivery-retry-chain'))
    const chat = new ChatRoom({ server: facade, messageStore, pageDomain: DOMAIN })
    client.registerApplier('chat', (projection) => chat.applyChat(projection))
    client.registerApplier('persistence', (projection, context) => chat.applyPersistence(projection, context))

    await client.init()
    const roomId = getChatRoomId(DOMAIN)
    await facade.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' } as never,
      site: { origin: DOMAIN, title: 'Example' } as never
    })
    fake.peerJoin(roomId, 'peer-a')
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-a',
      presenceId: 'presence-a',
      joinedAt: Date.now() + 1,
      user: { id: 'user-a', name: 'A', avatar: '' }
    })

    // The remote session must be committed before its text is admitted.
    await vi.waitFor(async () => {
      const current = await facade.getSnapshot({ domain: DOMAIN })
      expect(current.domains[0]?.sessions.some((session) => session.user.id === 'user-a')).toBe(true)
    })

    // B1: an invalid record enters the real Delivery buffer as sequence 1; durable validation
    // fails and its negative ACK is lost in transit.
    const invalid = textRecord('invalid-record')
    const insertSpy = vi.spyOn(messageStore, 'insert')
    insertSpy.mockRejectedValueOnce(new InvalidMessageRecordError('not a record'))
    fake.receive(roomId, 'peer-a', invalid.message)
    await vi.waitFor(() => expect(ackInbound).toHaveBeenCalledTimes(1))
    await flush()

    // A real same-host reconnect abandons the Delivery buffer (sequence restarts) with no
    // intermediate empty pull; the surviving invalid pair is keyed to the old record identity.
    await facade.reconnectDomain({ domain: DOMAIN })

    // The peer rebinds on the replacement connection before its text is admitted again.
    fake.peerJoin(roomId, 'peer-a')
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-a-2',
      presenceId: 'presence-a',
      joinedAt: Date.now() + 2,
      user: { id: 'user-a', name: 'A', avatar: '' }
    })
    await vi.waitFor(async () => {
      const current = await facade.getSnapshot({ domain: DOMAIN })
      expect(current.domains[0]?.sessions.some((session) => session.user.id === 'user-a')).toBe(true)
    })

    // The replacement accepts a valid sequence 1 with a different record identity through the
    // real wire: it must persist normally and ACK true.
    const valid = textRecord('valid-successor', 2)
    fake.receive(roomId, 'peer-a', valid.message)
    await vi.waitFor(() => expect(ackInbound).toHaveBeenCalledTimes(2))
    expect(ackInbound).toHaveBeenLastCalledWith({ domain: DOMAIN, sequence: 1, inserted: true })
    const chats = await messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
    expect(chats).toHaveLength(1)
    expect(chats[0]).toMatchObject({ id: valid.id, message: valid.message, user: valid.user })

    disposeServer(server)
  })

  it('re-registers through the real register-and-read surface and rebuilds lease and History provider', async () => {
    const hints: unknown[] = []
    const listeners = new Set<(message: unknown) => void>()
    const admission: RuntimeAdmission = {
      tabs: {
        get: async (tabId: number) => ({ id: tabId, url: `${DOMAIN}/` }),
        query: async () => [{ id: 1, url: `${DOMAIN}/` }],
        sendMessage: async (_tabId: number, message: unknown) => {
          hints.push(message)
          listeners.forEach((listener) => listener(message))
        }
      },
      ensureTransport: async () => {}
    }

    const fake = createTransport()
    let current = createServer({ transport: fake.transport, admission, codec: jsonCodec })
    const provideHistory = vi.fn()
    const rejectHistorySupply = vi.fn()
    const coordinator = {
      registerPage: async (payload: { domain: string }) => ({
        snapshot: await current.attachPage({ ...payload, caller })
      })
    }
    const facade = {
      getSnapshot: (payload?: { domain?: string }) => current.getSnapshot({ ...payload, caller }),
      provideHistory: (payload: { domain: string }, callback: Parameters<RuntimeServer['provideHistory']>[1]) => {
        provideHistory(payload)
        return current.provideHistory({ ...payload, caller }, callback)
      },
      ackInbound: (payload: { domain: string; sequence: number; inserted: boolean }) =>
        current.ackInbound({ ...payload, caller }),
      resolveHistorySupply: (payload: { supplyId: string; result: { records: never[]; done: boolean } }) =>
        current.resolveHistorySupply({ ...payload, caller }),
      rejectHistorySupply: (payload: { supplyId: string; reason: string }) => {
        rejectHistorySupply(payload)
        return current.rejectHistorySupply({ ...payload, caller })
      }
    } as unknown as RuntimeServer

    const client = new DocumentClient({ coordinator, server: facade, domain: DOMAIN })
    listeners.add((message) => {
      if ((message as { type?: string }).type === 'runtime:state-changed') client.invalidate()
    })
    const messageStore = createMessageStore(createMemoryMessageDatabase('background-replacement'))
    const chat = new ChatRoom({ server: facade, messageStore, pageDomain: DOMAIN })
    client.registerApplier('chat', (projection) => chat.applyChat(projection))
    client.registerApplier('persistence', (projection, context) => chat.applyPersistence(projection, context))

    await client.init()
    const firstHostId = (await readServerSnapshot(current)).hostId
    expect((await readServerSnapshot(current)).domains[0]?.tabIds).toEqual([1])
    expect(provideHistory).toHaveBeenCalledTimes(1)

    // The logical Background is replaced (service-worker restart): the new Runtime has no lease
    // and no History provider. Its best-effort hint reaches the surviving document's listener.
    disposeServer(current)
    current = createServer({ transport: fake.transport, admission, codec: jsonCodec })
    expect((await readServerSnapshot(current)).domains).toEqual([])
    notifyServerTabs(current)

    // The same document drain reads the host change, re-registers through the existing
    // register-and-read surface, and the persistence stage re-provides History — no Page
    // identity, generation, ACK, replay, or delivery ownership is involved.
    await vi.waitFor(async () => {
      expect((await readServerSnapshot(current)).domains[0]?.tabIds).toEqual([1])
    })
    expect((await readServerSnapshot(current)).hostId).not.toBe(firstHostId)
    await vi.waitFor(() => expect(provideHistory).toHaveBeenCalledTimes(2))
    expect(hints.some((message) => (message as { type?: string }).type === 'runtime:state-changed')).toBe(true)

    disposeServer(current)
  })
})
