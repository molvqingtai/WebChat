import { describe, expect, it, vi } from 'vitest'
import { MESSAGE_TYPE, NativeWireCodec } from '@/protocol'
import { getChatRoomId } from '@/runtime/Server'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import type { WireCodec } from '@/protocol'
import { InvalidMessageRecordError } from '@/domain/MessageStore'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { createMessageStore } from '@/domain/MessageStore'
import { createMemoryPresenceStore } from '@/runtime/PresenceStore'
import { getWorldRoomId } from '@/domain/runtime/World'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { DocumentClient } from '@/runtime/DocumentClient'
import { RemoteRoomTransport } from '@/runtime/RemoteRoomTransport'
import {
  createServer,
  disposeServer,
  notifyServerTabs,
  readServerSnapshot,
  type RuntimeAdmission
} from '@/runtime/Server'
import { createTransportService } from '@/runtime/TransportHost'
import type { HistorySupplyEvent, RuntimeServer } from '@/runtime/Contract'

const DOMAIN = 'https://example.com'

const createTransport = () => {
  const joined = new Set<string>()
  const joinCalls: string[] = []
  const leaveControls = new Map<
    string,
    { promise: Promise<void>; resolve: () => void; reject: (reason?: unknown) => void }
  >()
  const leaveTerminals = new Map<string, Promise<void>>()
  const leaveFailures = new Map<string, unknown>()
  const messageListeners = new Set<(roomId: string, sourcePeerId: string, payload: string) => void>()
  const sent: Array<{ roomId: string; payload: string }> = []
  const peersByRoom = new Map<string, Set<string>>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  const errorListeners = new Set<(error: Error, roomId: string) => void>()

  const leaveOwner = (roomId: string): Promise<void> => {
    const pending = leaveTerminals.get(roomId)
    if (pending) return pending
    if (!joined.delete(roomId)) return Promise.resolve()
    const controlled = leaveControls.get(roomId)
    const terminal = (controlled?.promise ?? Promise.resolve()).then(
      () => {
        if (leaveTerminals.get(roomId) === terminal) leaveTerminals.delete(roomId)
      },
      (error: unknown) => {
        leaveFailures.set(roomId, error)
        if (leaveTerminals.get(roomId) === terminal) leaveTerminals.delete(roomId)
        throw error
      }
    )
    leaveTerminals.set(roomId, terminal)
    return terminal
  }

  const transport: RoomTransport = {
    peerIdOf: (roomId) => {
      if (!joined.has(roomId)) return ''
      return roomId.startsWith('WEB_CHAT_WORLD') ? 'local-peer' : `local-peer:${roomId}`
    },
    join: async (roomId) => {
      const pending = leaveTerminals.get(roomId)
      if (pending) await pending
      const failure = leaveFailures.get(roomId)
      if (failure) throw failure
      joined.add(roomId)
      joinCalls.push(roomId)
      const members = [...(peersByRoom.get(roomId) ?? [])]
      queueMicrotask(() => {
        if (joined.has(roomId))
          members.forEach((peerId) => joinListeners.forEach((listener) => listener(roomId, peerId)))
      })
    },
    leave: (roomId) => {
      void leaveOwner(roomId).catch(() => {})
    },
    // A direct provider removes local routing first but retains a physical leave terminal. The
    // replacement path must await every exact terminal before any successor can be prepared.
    retireRoomsForPreparation: async (roomIds) => {
      await Promise.all([...new Set(roomIds)].map((roomId) => leaveOwner(roomId)))
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
    joinCalls,
    deferLeave: (roomId: string) => {
      let resolve!: () => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve
        reject = onReject
      })
      leaveControls.set(roomId, { promise, resolve, reject })
    },
    resolveLeave: (roomId: string) => leaveControls.get(roomId)?.resolve(),
    rejectLeave: (roomId: string, reason: unknown) => leaveControls.get(roomId)?.reject(reason),
    sent,
    plantPeer: (roomId: string, peerId: string) => {
      const peers = peersByRoom.get(roomId) ?? new Set<string>()
      peers.add(peerId)
      peersByRoom.set(roomId, peers)
    },
    peerJoin: (roomId: string, peerId: string) => joinListeners.forEach((listener) => listener(roomId, peerId)),
    peerLeave: (roomId: string, peerId: string) => {
      peersByRoom.get(roomId)?.delete(peerId)
      leaveListeners.forEach((listener) => listener(roomId, peerId))
    },
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

/** Explicit, real-shaped current-document apply context for direct persistence-stage calls. */
const createApplyContext = () => {
  const controller = new AbortController()
  const document = {
    signal: controller.signal,
    assertActive: () => {
      if (controller.signal.aborted) throw new DOMException('Runtime client detached', 'AbortError')
    }
  }
  return { signal: controller.signal, assertCurrent: () => {}, document }
}

describe('Offscreen physical retirement through the Runtime replacement path', () => {
  it('waits for both real provider terminals and returns the first error only after both settle', async () => {
    const fake = createTransport()
    const service = createTransportService(fake.transport)
    const transport = new RemoteRoomTransport(service)
    await transport.rebind()
    const server = createServer({ transport, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    let reconnect: Promise<void> | undefined

    try {
      await server.attachPage({ domain: DOMAIN, caller })
      await server.joinChatRoom({
        domain: DOMAIN,
        user: { id: 'local-user', name: 'Local', avatar: '' } as never,
        site: { origin: DOMAIN, title: 'Example' } as never,
        caller
      })
      fake.deferLeave(roomId)
      fake.deferLeave(worldRoomId)
      const joinsBeforeReconnect = fake.joinCalls.length
      const failure = new Error('Chat provider retirement rejected')
      let reconnectSettled = false
      let reconnectError: unknown
      reconnect = server.reconnectDomain({ domain: DOMAIN, caller }).then(
        () => {
          reconnectSettled = true
        },
        (error: unknown) => {
          reconnectSettled = true
          reconnectError = error
        }
      )

      await flush()
      expect(reconnectSettled).toBe(false)
      expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: true })
      expect(readServerSnapshot(server).world.joined).toBe(true)
      expect(fake.joinCalls).toHaveLength(joinsBeforeReconnect)

      fake.rejectLeave(roomId, failure)
      await flush()
      expect(reconnectSettled).toBe(false)
      expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: true })
      expect(readServerSnapshot(server).world.joined).toBe(true)
      expect(fake.joinCalls).toHaveLength(joinsBeforeReconnect)

      fake.resolveLeave(worldRoomId)
      await reconnect
      expect(reconnectError).toBe(failure)
      expect(fake.joinCalls).toHaveLength(joinsBeforeReconnect)
    } finally {
      fake.resolveLeave(roomId)
      fake.resolveLeave(worldRoomId)
      await reconnect
      disposeServer(server)
    }
  })
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
      // B2's production-returned terminal Promises, captured per exact supplyId at the facade's
      // downstream boundary; a settled flag is flipped only by the production Promise itself.
      const b2ProductionTerminals = new Map<string, Promise<void>>()
      const b2ProductionTerminalSettledIds = new Set<string>()
      const coordinator = {
        registerPage: async (payload: { domain: string }) => current.attachPage({ ...payload, caller })
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
        resolveHistorySupply: (payload: { supplyId: string; result: { records: never[]; done: boolean } }) => {
          resolveHistorySupply(payload)
          const terminal = (async () => {
            if (b2TerminalHeld && b2SupplyIds.has(payload.supplyId)) await b2Terminal.promise
            if (armTerminalHold && !b1TerminalHeldConsumed && b1SupplyIds.has(payload.supplyId)) {
              b1TerminalHeldConsumed = true
              await b1Terminal.promise
            }
            return current.resolveHistorySupply({ ...payload, caller })
          })()
          if (b2SupplyIds.has(payload.supplyId)) {
            b2ProductionTerminals.set(payload.supplyId, terminal)
            void terminal.then(
              () => {
                b2ProductionTerminalSettledIds.add(payload.supplyId)
              },
              () => {}
            )
          }
          return terminal
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
      // B2-only completion receipt on the REAL current method, installed before any B2 History
      // flow: a receipt exists only when the exact current resolveHistorySupply was genuinely
      // invoked AND its returned Promise has come back. The outer facade's call log, pre-gate
      // records, or B1's calls can never produce it.
      const originalB2ResolveHistorySupply = current.resolveHistorySupply
      let frozenB2SupplyId: string | null = null
      let b2CompletionSettled = false
      const b2Receipts: Array<{ supplyId: string; result: unknown; returnValue: unknown }> = []
      const b2Completion = Promise.withResolvers<{ supplyId: string; result: unknown; returnValue: unknown }>()
      current.resolveHistorySupply = async (payload) => {
        const returnValue = await originalB2ResolveHistorySupply(payload)
        if (payload.supplyId === frozenB2SupplyId) {
          const receipt = { supplyId: payload.supplyId, result: payload.result, returnValue }
          b2Receipts.push(receipt)
          b2CompletionSettled = true
          b2Completion.resolve(receipt)
        }
        return returnValue
      }
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
      // Freeze the single B2 supply identity BEFORE any terminal settlement: it is the exact
      // same slot as B1's held supply, its production terminal is already pending at the B2 gate,
      // and no completion receipt exists yet.
      frozenB2SupplyId = [...b2SupplyIds].find((supplyId) => b1SupplyIds.has(supplyId)) ?? null
      expect(frozenB2SupplyId).not.toBeNull()
      await vi.waitFor(() => expect(b2ProductionTerminals.has(frozenB2SupplyId!)).toBe(true))
      expect(b2ProductionTerminalSettledIds.has(frozenB2SupplyId!)).toBe(false)
      expect(b2CompletionSettled).toBe(false)
      expect(b2Receipts).toHaveLength(0)

      // The held B1 terminal now settles late (its transport rejects): the stale chain must not
      // publish any error, add any post-cut facade call for B1 identity, or disturb B2's entry.
      b1Terminal.reject(new Error('B1 terminal transport lost') as never)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(errors).toEqual([])
      // Post-cut window: the stale chain's continuation is fully silent — no reject call at all,
      // and B2's terminal stays pending on the same slot.
      expect(rejectHistorySupply).not.toHaveBeenCalled()

      // B2 then settles independently through its own REAL current terminal with its true
      // result. Awaiting the captured production terminal Promise is the only wait; every receipt
      // assertion below is synchronous and must already hold — skipping the real current call
      // leaves settled=false/count=0 and fails right here (no waitFor, no timeout).
      b2TerminalHeld = false
      b2Terminal.resolve()
      await b2ProductionTerminals.get(frozenB2SupplyId!)!
      expect(b2ProductionTerminalSettledIds.has(frozenB2SupplyId!)).toBe(true)
      expect(b2CompletionSettled).toBe(true)
      expect(b2Receipts).toHaveLength(1)
      const receipt = await b2Completion.promise
      expect(receipt.supplyId).toBe(frozenB2SupplyId)
      expect(receipt.result).toEqual({ records: [], done: true })
      expect(receipt.returnValue).toBeUndefined()
      await Promise.resolve()
      expect(b2Receipts).toHaveLength(1)

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
    await room.applyPersistence(projection, createApplyContext())

    handler!({
      type: 'request',
      request: { supplyId: 'supply-current', domain: DOMAIN, syncId: 'sync-current', cutoff: 0, mode: 'provider' }
    })
    await vi.waitFor(() => expect(errors).toEqual([original]))
    room.dispose()
  })

  it('an Error-shaped value with a throwing message getter is normalized via the controlled path', async () => {
    class FallibleError extends Error {
      constructor() {
        super()
        // An own throwing getter shadows the safe Error.prototype property path.
        Object.defineProperty(this, 'message', {
          get() {
            throw new Error('fallible message getter')
          }
        })
      }
      override toString(): string {
        throw new Error('fallible toString')
      }
    }
    const reasons: string[] = []
    let handler: ((event: HistorySupplyEvent) => void) | null = null
    const firstTerminal = Promise.withResolvers<void>()
    let firstTerminalHeld = true
    const successorStarted = Promise.withResolvers<AbortSignal>()
    const successorRelease = Promise.withResolvers<readonly never[]>()
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
        if (firstTerminalHeld) await firstTerminal.promise
      }
    }
    const messageStore = createMessageStore(createMemoryMessageDatabase('fallible-error-shape'))
    // Abort-count witness for the first controller's exact signal: with a complete retirement
    // the later same-id cancel surface has no stale controller to abort.
    let firstSignalAbortCount = 0
    let queryCall = 0
    vi.spyOn(messageStore, 'query').mockImplementation(async (query) => {
      queryCall += 1
      // The first attempt's query rejects with the fallible value; the successor's own query is
      // held with its exact signal.
      if (queryCall === 1) {
        query?.signal?.addEventListener('abort', () => {
          firstSignalAbortCount += 1
        })
        throw new FallibleError()
      }
      successorStarted.resolve(query?.signal ?? new AbortController().signal)
      return successorRelease.promise as never
    })
    const room = new ChatRoom({ server, messageStore, pageDomain: DOMAIN })
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
    await room.applyPersistence(projection, createApplyContext())

    handler!({
      type: 'request',
      request: {
        supplyId: 'supply-fallible-error',
        domain: DOMAIN,
        syncId: 'sync-fallible-error',
        cutoff: 0,
        mode: 'provider'
      }
    })

    // reasonOf enters the controlled Error branch, the throwing getter is contained, and the
    // fixed fallback message reaches the terminal while its RPC is still held.
    await vi.waitFor(() => expect(reasons).toEqual(['History supply failed']))
    expect(reasons[0]).toBe('History supply failed')

    // Baseline before any later lifecycle surface: the first controller has not been aborted.
    expect(firstSignalAbortCount).toBe(0)

    // Release the first terminal and let the first chain's exact-entry finally retire its own
    // controller before any same-id lifecycle surface.
    firstTerminalHeld = false
    firstTerminal.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Empty-slot proof through the ordinary cancel surface: after a complete retirement, a
    // same-id cancel finds no stale controller and aborts nothing. A skipped first-entry
    // retirement leaves the old controller behind and this cancel aborts it.
    handler!({ type: 'cancel', supplyId: 'supply-fallible-error' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(firstSignalAbortCount).toBe(0)

    // The successor takes the SAME supply slot while the first chain's exact-entry finally is
    // still pending (its terminal RPC held): only the guard keeps the successor's controller.
    handler!({
      type: 'request',
      request: {
        supplyId: 'supply-fallible-error',
        domain: DOMAIN,
        syncId: 'sync-fallible-error',
        cutoff: 0,
        mode: 'provider'
      }
    })
    const successorSignal = await successorStarted.promise
    await new Promise((resolve) => setTimeout(resolve, 10))
    handler!({ type: 'cancel', supplyId: 'supply-fallible-error' })
    await vi.waitFor(() => expect(successorSignal.aborted).toBe(true))
    // The cancelled physical query exits: the successor settles through its ordinary cancelled
    // terminal with the cancellation reason.
    successorRelease.reject(new DOMException('History supply cancelled', 'AbortError') as never)
    await vi.waitFor(() => expect(reasons).toEqual(['History supply failed', 'History supply cancelled']))
    room.dispose()
  })

  it("a non-Error value keeps its identity as cause through the owner's final error sink", async () => {
    const errors: Error[] = []
    const strangeValue = { kind: 'strange-terminal' }
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
      resolveHistorySupply: async () => {},
      rejectHistorySupply: async () => {
        // The terminal RPC itself rejects with a non-Error value.
        return Promise.reject(strangeValue)
      }
    }
    const messageStore = createMessageStore(createMemoryMessageDatabase('cause-preservation'))
    // The physical query fails normally, so the terminal reject RPC is genuinely invoked.
    vi.spyOn(messageStore, 'query').mockRejectedValue(new Error('query failed'))
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
    await room.applyPersistence(projection, createApplyContext())

    handler!({
      type: 'request',
      request: { supplyId: 'supply-cause', domain: DOMAIN, syncId: 'sync-cause', cutoff: 0, mode: 'provider' }
    })

    // The final sink publishes one safe Error preserving the original value as its cause.
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toBeInstanceOf(Error)
    expect(errors[0]?.cause).toBe(strangeValue)

    // The owner retired normally: a new supply request on the same slot is accepted again.
    handler!({
      type: 'request',
      request: {
        supplyId: 'supply-after-retire',
        domain: DOMAIN,
        syncId: 'sync-after-retire',
        cutoff: 0,
        mode: 'provider'
      }
    })
    await vi.waitFor(() => expect(errors).toHaveLength(1))
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
      registerPage: async (payload: { domain: string }) => server.attachPage({ ...payload, caller })
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
    const invalidInsertSpy = vi.spyOn(messageStore, 'insert')
    invalidInsertSpy.mockRejectedValueOnce(new InvalidMessageRecordError('not a record'))
    fake.receive(roomId, 'peer-a', invalid.message)
    await vi.waitFor(() => expect(ackInbound).toHaveBeenCalledTimes(1))
    await flush()
    invalidInsertSpy.mockRestore()

    // Durable history belongs to the Page store, not the Runtime delivery buffer. Replacement
    // must retain this exact persisted record without re-inserting or rewriting it.
    const durable = textRecord('durable-before-replacement', 0)
    await messageStore.insert(durable)
    await flush()
    const replacementInsertSpy = vi.spyOn(messageStore, 'insert')

    // A real same-host reconnect abandons the Delivery buffer (sequence restarts) with no
    // intermediate empty pull; the surviving invalid pair is keyed to the old record identity.
    // This is a direct physical owner: both exact provider leaves must settle before either
    // successor is joined, rather than a test shim deleting the local room set immediately.
    const worldRoomId = getWorldRoomId()
    fake.deferLeave(roomId)
    fake.deferLeave(worldRoomId)
    const joinsBeforeReconnect = fake.joinCalls.length
    let reconnectSettled = false
    const reconnecting = facade.reconnectDomain({ domain: DOMAIN }).then(() => {
      reconnectSettled = true
    })
    await flush()
    expect(reconnectSettled).toBe(false)
    expect(fake.joinCalls).toHaveLength(joinsBeforeReconnect)
    fake.resolveLeave(roomId)
    await flush()
    expect(reconnectSettled).toBe(false)
    expect(fake.joinCalls).toHaveLength(joinsBeforeReconnect)
    fake.resolveLeave(worldRoomId)
    await reconnecting
    expect(fake.joinCalls).toHaveLength(joinsBeforeReconnect + 2)

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
    expect(chats).toHaveLength(2)
    expect(chats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: durable.id, message: durable.message, user: durable.user }),
        expect.objectContaining({ id: valid.id, message: valid.message, user: valid.user })
      ])
    )
    expect(replacementInsertSpy.mock.calls.map(([record]) => record.id)).toEqual([valid.id])

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
      registerPage: async (payload: { domain: string }) => current.attachPage({ ...payload, caller })
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

describe('World recovery across a logical Background replacement', () => {
  it('hydrates the committed ROOM owner before a logical replacement opens reads', async () => {
    const fake = createTransport()
    const service = createTransportService(fake.transport)
    const presenceStore = createMemoryPresenceStore()
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    const first = createServer({ transport: firstTransport, codec: NativeWireCodec, presenceStore })
    await first.attachPage({ domain: DOMAIN, caller })
    await first.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    await flush()

    const replacementTransport = new RemoteRoomTransport(service)
    await replacementTransport.rebind()
    expect(replacementTransport.roomRecovery().rooms).toHaveLength(1)
    const replacement = createServer({ transport: replacementTransport, codec: NativeWireCodec, presenceStore })
    expect((await replacement.attachPage({ domain: DOMAIN, caller })).domains).toEqual([
      expect.objectContaining({ domain: DOMAIN, chatRoomJoined: true })
    ])
    disposeServer(first)
    disposeServer(replacement)
  })

  it('keeps current World presence when the Offscreen mesh survives without a new peer join', async () => {
    let onMessage: Parameters<RoomTransport['onMessage']>[0] = () => {}
    let onPeerJoin: Parameters<RoomTransport['onPeerJoin']>[0] = () => {}
    let onPeerLeave: Parameters<RoomTransport['onPeerLeave']>[0] = () => {}
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `local:${roomId}`,
      join: async () => {},
      leave: () => {},
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => physical.leave(roomId))
      },
      send: async () => {},
      onMessage: (callback) => {
        onMessage = callback
        return () => {}
      },
      onPeerJoin: (callback) => {
        onPeerJoin = callback
        return () => {}
      },
      onPeerLeave: (callback) => {
        onPeerLeave = callback
        return () => {}
      },
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: () => {}
    }
    const service = createTransportService(physical)
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    let current = createServer({ transport: firstTransport, codec: NativeWireCodec })
    const coordinator = {
      registerPage: (payload: { domain: string }) => current.attachPage({ ...payload, caller })
    }
    const server = {
      getSnapshot: (payload?: { domain?: string }) => current.getSnapshot({ ...payload, caller })
    } as RuntimeServer
    const applied: string[][] = []
    const client = new DocumentClient({ coordinator, server, domain: DOMAIN })
    client.registerApplier('world', (projection) => {
      applied.push(projection.world.presences.map(({ sourcePeerId }) => sourcePeerId))
    })

    await client.init()
    await current.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    const worldRoomId = getWorldRoomId()
    onPeerJoin(worldRoomId, 'remote-peer')
    onMessage(
      worldRoomId,
      'remote-peer',
      await NativeWireCodec.encode({
        sessionId: 'remote-session',
        user: { id: 'remote-user', name: 'Remote', avatar: '' },
        sites: [{ origin: 'https://remote.example', title: 'Remote' }]
      })
    )
    await vi.waitFor(async () => expect((await current.getSnapshot({ caller })).world.presences).toHaveLength(1))
    const beforeReplacement = applied.length
    client.invalidate()
    await vi.waitFor(() => {
      expect(applied).toHaveLength(beforeReplacement + 1)
      expect(applied.at(-1)).toEqual(['remote-peer'])
    })

    const replacementTransport = new RemoteRoomTransport(service)
    await replacementTransport.rebind()
    const replacement = createServer({ transport: replacementTransport, codec: NativeWireCodec })
    current = replacement
    const beforeReplacementApply = applied.length
    client.invalidate()

    await vi.waitFor(() => {
      expect(applied).toHaveLength(beforeReplacementApply + 1)
      expect(applied.at(-1)).toEqual(['remote-peer'])
      expect(applied.at(-1)).not.toEqual([])
    })

    // A second natural replacement still starts from the same surviving mesh state; no new
    // peer event is injected between either replacement.
    const secondReplacementTransport = new RemoteRoomTransport(service)
    await secondReplacementTransport.rebind()
    const secondReplacement = createServer({ transport: secondReplacementTransport, codec: NativeWireCodec })
    current = secondReplacement
    const beforeSecondReplacementApply = applied.length
    client.invalidate()
    await vi.waitFor(async () => {
      expect(applied).toHaveLength(beforeSecondReplacementApply + 1)
      expect(applied.at(-1)).toEqual(['remote-peer'])
      expect((await current.getSnapshot({ caller })).domains[0]?.sessions).toEqual([])
    })

    // A real physical departure clears the cache and remains an empty projection after another
    // replacement; the fix restores only current Offscreen state and never masks a valid empty room.
    onPeerLeave(worldRoomId, 'remote-peer')
    await vi.waitFor(async () => expect((await current.getSnapshot({ caller })).world.presences).toEqual([]))
    const beforeEmptyApply = applied.length
    client.invalidate()
    await vi.waitFor(() => {
      expect(applied).toHaveLength(beforeEmptyApply + 1)
      expect(applied.at(-1)).toEqual([])
    })
    const emptyReplacementTransport = new RemoteRoomTransport(service)
    await emptyReplacementTransport.rebind()
    const emptyReplacement = createServer({ transport: emptyReplacementTransport, codec: NativeWireCodec })
    current = emptyReplacement
    const beforeEmptyReplacementApply = applied.length
    client.invalidate()
    await vi.waitFor(() => {
      expect(applied).toHaveLength(beforeEmptyReplacementApply + 1)
      expect(applied.at(-1)).toEqual([])
    })
    disposeServer(replacement)
    disposeServer(secondReplacement)
    disposeServer(emptyReplacement)
  })

  it('does not checkpoint a schema-valid World frame the Domain owner rejects', async () => {
    const fake = createTransport()
    const service = createTransportService(fake.transport)
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    const first = createServer({ transport: firstTransport, codec: jsonCodec })
    await first.attachPage({ domain: DOMAIN, caller })
    await first.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    const roomId = getWorldRoomId()
    fake.peerJoin(roomId, 'remote-peer')
    fake.receive(roomId, 'remote-peer', {
      sessionId: 'remote-session',
      user: { id: 'accepted-user', name: 'Accepted', avatar: '' },
      sites: [{ origin: 'https://accepted.example', title: 'Accepted' }]
    })
    await vi.waitFor(async () => {
      expect((await first.getSnapshot({ caller })).world.presences).toEqual([
        expect.objectContaining({
          presence: expect.objectContaining({ user: expect.objectContaining({ id: 'accepted-user' }) })
        })
      ])
    })

    // Native decode/schema accepts this frame, but the World owner rejects the same session id
    // changing user identity. A checkpoint may only retain the already committed owner fact.
    fake.receive(roomId, 'remote-peer', {
      sessionId: 'remote-session',
      user: { id: 'forbidden-user', name: 'Forbidden', avatar: '' },
      sites: [{ origin: 'https://forbidden.example', title: 'Forbidden' }]
    })
    await flush()
    expect((await first.getSnapshot({ caller })).world.presences).toEqual([
      expect.objectContaining({
        presence: expect.objectContaining({ user: expect.objectContaining({ id: 'accepted-user' }) })
      })
    ])

    const replacementTransport = new RemoteRoomTransport(service)
    await replacementTransport.rebind()
    const replacement = createServer({ transport: replacementTransport, codec: jsonCodec })
    const snapshot = await replacement.attachPage({ domain: DOMAIN, caller })
    expect(snapshot.world.presences).toEqual([
      expect.objectContaining({
        presence: expect.objectContaining({ user: expect.objectContaining({ id: 'accepted-user' }) })
      })
    ])
    expect(snapshot.world.presences).not.toEqual([
      expect.objectContaining({
        presence: expect.objectContaining({ user: expect.objectContaining({ id: 'forbidden-user' }) })
      })
    ])
    disposeServer(first)
    disposeServer(replacement)
  })

  it('drops an old decode after the same World peer id leaves and rejoins before replacement', async () => {
    const fake = createTransport()
    const delayed = Promise.withResolvers<unknown>()
    let delayOld = true
    const codec: WireCodec = {
      encode: async (value) => JSON.stringify(value),
      decode: (payload) => {
        const value = JSON.parse(payload as string)
        if (delayOld) {
          delayOld = false
          return delayed.promise
        }
        return Promise.resolve(value)
      }
    }
    const service = createTransportService(fake.transport)
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    const first = createServer({ transport: firstTransport, codec })
    await first.attachPage({ domain: DOMAIN, caller })
    await first.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    const roomId = getWorldRoomId()
    fake.peerJoin(roomId, 'remote-peer')
    fake.receive(roomId, 'remote-peer', {
      sessionId: 'old-session',
      user: { id: 'old-user', name: 'Old', avatar: '' },
      sites: [{ origin: 'https://old.example', title: 'Old' }]
    })
    await Promise.resolve()
    fake.peerLeave(roomId, 'remote-peer')
    fake.peerJoin(roomId, 'remote-peer')
    delayed.resolve({
      sessionId: 'old-session',
      user: { id: 'old-user', name: 'Old', avatar: '' },
      sites: [{ origin: 'https://old.example', title: 'Old' }]
    })
    await flush()
    expect((await first.getSnapshot({ caller })).world.presences).toEqual([])

    const replacementTransport = new RemoteRoomTransport(service)
    await replacementTransport.rebind()
    const replacement = createServer({ transport: replacementTransport, codec })
    const snapshot = await replacement.attachPage({ domain: DOMAIN, caller })
    expect(snapshot.world.presences).toEqual([])
    disposeServer(first)
    disposeServer(replacement)
  })

  it('evicts the owner-committed World checkpoint after local leave before a replacement', async () => {
    const fake = createTransport()
    const service = createTransportService(fake.transport)
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    const first = createServer({ transport: firstTransport, codec: jsonCodec })
    await first.attachPage({ domain: DOMAIN, caller })
    await first.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    const roomId = getWorldRoomId()
    fake.peerJoin(roomId, 'remote-peer')
    fake.receive(roomId, 'remote-peer', {
      sessionId: 'remote-session',
      user: { id: 'remote-user', name: 'Remote', avatar: '' },
      sites: [{ origin: 'https://remote.example', title: 'Remote' }]
    })
    await vi.waitFor(async () => expect((await first.getSnapshot({ caller })).world.presences).toHaveLength(1))

    await first.leaveChatRoom({ domain: DOMAIN, caller })
    await vi.waitFor(async () => expect((await first.getSnapshot({ caller })).world.presences).toEqual([]))

    const replacementTransport = new RemoteRoomTransport(service)
    await replacementTransport.rebind()
    const replacement = createServer({ transport: replacementTransport, codec: jsonCodec })
    const snapshot = await replacement.attachPage({ domain: DOMAIN, caller })
    expect(snapshot.world.presences).toEqual([])
    disposeServer(first)
    disposeServer(replacement)
  })

  it('holds normal replacement publication through a slow pre-cut frame and drains the cut-time frame in order', async () => {
    let onMessage: Parameters<RoomTransport['onMessage']>[0] = () => {}
    let onPeerJoin: Parameters<RoomTransport['onPeerJoin']>[0] = () => {}
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `local:${roomId}`,
      join: async () => {},
      leave: () => {},
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => physical.leave(roomId))
      },
      send: async () => {},
      onMessage: (callback) => {
        onMessage = callback
        return () => {}
      },
      onPeerJoin: (callback) => {
        onPeerJoin = callback
        return () => {}
      },
      onPeerLeave: () => () => {},
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: () => {}
    }
    const service = createTransportService(physical)
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    const first = createServer({ transport: firstTransport, codec: NativeWireCodec })
    await first.attachPage({ domain: DOMAIN, caller })
    await first.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    const roomId = getWorldRoomId()
    onPeerJoin(roomId, 'remote-peer')
    const base = await NativeWireCodec.encode({
      sessionId: 'base-presence',
      user: { id: 'remote', name: 'Base', avatar: '' },
      sites: [{ origin: 'https://base.example', title: 'Base' }]
    })
    onMessage(roomId, 'remote-peer', base)
    await vi.waitFor(async () => expect((await first.getSnapshot({ caller })).world.presences).toHaveLength(1))

    const a = await NativeWireCodec.encode({
      sessionId: 'presence-a',
      user: { id: 'remote', name: 'A', avatar: '' },
      sites: [{ origin: 'https://a.example', title: 'A' }]
    })
    const b = await NativeWireCodec.encode({
      sessionId: 'presence-b',
      user: { id: 'remote', name: 'B', avatar: '' },
      sites: [{ origin: 'https://b.example', title: 'B' }]
    })
    const pendingA = Promise.withResolvers<unknown>()
    const pendingB = Promise.withResolvers<unknown>()
    const originalDecode = NativeWireCodec.decode
    const slowDecode = vi
      .spyOn(NativeWireCodec, 'decode')
      // Host classifies A before the old Runtime decodes it.
      .mockImplementationOnce(() => pendingA.promise)
      .mockImplementationOnce((payload) => originalDecode!(payload))
      // A reached the old owner checkpoint; B alone follows through the new cut buffer.
      .mockImplementationOnce(() => pendingB.promise)
    onMessage(roomId, 'remote-peer', a)

    const replacementTransport = new RemoteRoomTransport(service)
    const rebinding = replacementTransport.rebind()
    let rebound = false
    void rebinding.then(() => {
      rebound = true
    })
    await Promise.resolve()
    expect(rebound).toBe(false)
    onMessage(roomId, 'remote-peer', b)
    expect(rebound).toBe(false)

    pendingA.resolve(await originalDecode!(a))
    await rebinding
    const replacement = createServer({ transport: replacementTransport, codec: NativeWireCodec })
    let attached = false
    const attaching = replacement.attachPage({ domain: DOMAIN, caller }).then((snapshot) => {
      attached = true
      return snapshot
    })
    // A reached the previous World owner, so its committed checkpoint seeds the replacement;
    // only B crosses the new cut buffer and decodes in the fresh owner.
    await vi.waitFor(() => expect(slowDecode).toHaveBeenCalledTimes(3))
    expect(attached).toBe(false)
    pendingB.resolve(await originalDecode!(b))
    const firstSnapshot = await attaching
    slowDecode.mockRestore()
    expect(firstSnapshot.world.presences).toEqual([
      expect.objectContaining({
        sourcePeerId: 'remote-peer',
        presence: expect.objectContaining({ sessionId: 'presence-b' })
      })
    ])
    disposeServer(first)
    disposeServer(replacement)
  })
})

describe('ROOM recovery across a logical Background replacement', () => {
  it('recovers only the current source incarnation after a same-id leave and rejoin', async () => {
    const fake = createTransport()
    const service = createTransportService(fake.transport)
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    const first = createServer({ transport: firstTransport, codec: jsonCodec })
    await first.attachPage({ domain: DOMAIN, caller })
    await first.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    const roomId = getChatRoomId(DOMAIN)
    fake.peerJoin(roomId, 'remote-peer')
    fake.receive(roomId, 'remote-peer', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'old-session',
      presenceId: 'old-presence',
      user: { id: 'old-user', name: 'Old', avatar: '' },
      joinedAt: 1
    })
    await vi.waitFor(async () =>
      expect((await first.getSnapshot({ caller })).domains.find((item) => item.domain === DOMAIN)?.sessions).toEqual([
        expect.objectContaining({ sessionId: 'old-session' })
      ])
    )
    fake.peerLeave(roomId, 'remote-peer')
    fake.peerJoin(roomId, 'remote-peer')
    fake.receive(roomId, 'remote-peer', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'current-session',
      presenceId: 'current-presence',
      user: { id: 'current-user', name: 'Current', avatar: '' },
      joinedAt: 2
    })
    await vi.waitFor(async () =>
      expect((await first.getSnapshot({ caller })).domains.find((item) => item.domain === DOMAIN)?.sessions).toEqual(
        expect.arrayContaining([expect.objectContaining({ sessionId: 'current-session' })])
      )
    )

    const replacementTransport = new RemoteRoomTransport(service)
    await replacementTransport.rebind()
    const replacement = createServer({ transport: replacementTransport, codec: jsonCodec })
    const snapshot = await replacement.attachPage({ domain: DOMAIN, caller })
    expect(snapshot.domains.find((item) => item.domain === DOMAIN)?.sessions).toEqual([
      expect.objectContaining({ sessionId: 'current-session', sourcePeerId: 'remote-peer' })
    ])
    disposeServer(first)
    disposeServer(replacement)
  })

  it('keeps a validated remote session and local joined state when the Offscreen mesh survives without a new event', async () => {
    let onMessage: Parameters<RoomTransport['onMessage']>[0] = () => {}
    let onPeerJoin: Parameters<RoomTransport['onPeerJoin']>[0] = () => {}
    let onPeerLeave: Parameters<RoomTransport['onPeerLeave']>[0] = () => {}
    const sent: string[] = []
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `local:${roomId}`,
      join: async () => {},
      leave: () => {},
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => physical.leave(roomId))
      },
      send: async (_roomId, payload) => {
        sent.push(payload)
      },
      onMessage: (callback) => {
        onMessage = callback
        return () => {}
      },
      onPeerJoin: (callback) => {
        onPeerJoin = callback
        return () => {}
      },
      onPeerLeave: (callback) => {
        onPeerLeave = callback
        return () => {}
      },
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: () => {}
    }
    const service = createTransportService(physical)
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    let current = createServer({ transport: firstTransport, codec: NativeWireCodec })
    const coordinator = {
      registerPage: (payload: { domain: string }) => current.attachPage({ ...payload, caller })
    }
    const server = {
      getSnapshot: (payload?: { domain?: string }) => current.getSnapshot({ ...payload, caller })
    } as RuntimeServer
    const applied: Array<{ joined: boolean; sessions: string[] }> = []
    const client = new DocumentClient({ coordinator, server, domain: DOMAIN })
    client.registerApplier('chat', (projection) => {
      const domain = projection.domains.find((item) => item.domain === DOMAIN)
      applied.push({
        joined: domain?.chatRoomJoined ?? false,
        sessions: domain?.sessions.map(({ sourcePeerId }) => sourcePeerId) ?? []
      })
    })

    await client.init()
    await current.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    const roomId = getChatRoomId(DOMAIN)
    onPeerJoin(roomId, 'remote-peer')
    onMessage(
      roomId,
      'remote-peer',
      await NativeWireCodec.encode({
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'remote-session',
        presenceId: 'remote-presence',
        user: { id: 'remote-user', name: 'Remote', avatar: '' },
        joinedAt: 1
      })
    )
    await vi.waitFor(async () => {
      const domain = (await current.getSnapshot({ caller })).domains.find((item) => item.domain === DOMAIN)
      expect(domain).toMatchObject({ chatRoomJoined: true })
      expect(domain?.sessions.map(({ sourcePeerId }) => sourcePeerId)).toEqual(['remote-peer'])
    })
    const beforeReplacement = applied.length
    client.invalidate()
    await vi.waitFor(() => {
      expect(applied).toHaveLength(beforeReplacement + 1)
      expect(applied.at(-1)).toEqual({ joined: true, sessions: ['remote-peer'] })
    })
    const sentBeforeReplacement = [...sent]

    const replacementTransport = new RemoteRoomTransport(service)
    await replacementTransport.rebind()
    const replacement = createServer({ transport: replacementTransport, codec: NativeWireCodec })
    current = replacement
    const beforeReplacementApply = applied.length
    client.invalidate()

    await vi.waitFor(() => {
      expect(applied).toHaveLength(beforeReplacementApply + 1)
      expect(applied.at(-1)).toEqual({ joined: true, sessions: ['remote-peer'] })
    })
    expect(sent).toEqual(sentBeforeReplacement)

    // A second replacement has no new peer or session event either, and recovery itself sends
    // no session/history frame or persistence-side effect.
    const secondReplacementTransport = new RemoteRoomTransport(service)
    await secondReplacementTransport.rebind()
    const secondReplacement = createServer({ transport: secondReplacementTransport, codec: NativeWireCodec })
    current = secondReplacement
    const beforeSecondReplacementApply = applied.length
    client.invalidate()
    await vi.waitFor(() => {
      expect(applied).toHaveLength(beforeSecondReplacementApply + 1)
      expect(applied.at(-1)).toEqual({ joined: true, sessions: ['remote-peer'] })
    })
    expect(sent).toEqual(sentBeforeReplacement)

    // Physical departure removes the Offscreen current-session fact. A later replacement must
    // retain the local Room join but never revive the departed peer.
    onPeerLeave(roomId, 'remote-peer')
    const emptyReplacementTransport = new RemoteRoomTransport(service)
    await emptyReplacementTransport.rebind()
    const emptyReplacement = createServer({ transport: emptyReplacementTransport, codec: NativeWireCodec })
    current = emptyReplacement
    const beforeEmptyReplacementApply = applied.length
    client.invalidate()
    await vi.waitFor(() => {
      expect(applied).toHaveLength(beforeEmptyReplacementApply + 1)
      expect(applied.at(-1)).toEqual({ joined: true, sessions: [] })
    })

    disposeServer(replacement)
    disposeServer(secondReplacement)
    disposeServer(emptyReplacement)
  })

  it('merges durable ended observers and the greatest joined timestamp before recovered ROOM ingress', async () => {
    let onMessage: Parameters<RoomTransport['onMessage']>[0] = () => {}
    let onPeerJoin: Parameters<RoomTransport['onPeerJoin']>[0] = () => {}
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `local:${roomId}`,
      join: async () => {},
      leave: () => {},
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => physical.leave(roomId))
      },
      send: async () => {},
      onMessage: (callback) => {
        onMessage = callback
        return () => {}
      },
      onPeerJoin: (callback) => {
        onPeerJoin = callback
        return () => {}
      },
      onPeerLeave: () => () => {},
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: () => {}
    }
    const presenceStore = createMemoryPresenceStore()
    const service = createTransportService(physical)
    const firstTransport = new RemoteRoomTransport(service)
    await firstTransport.rebind()
    const first = createServer({ transport: firstTransport, codec: NativeWireCodec, presenceStore })
    await first.attachPage({ domain: DOMAIN, caller })
    await first.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' },
      site: { origin: DOMAIN, title: 'Example' },
      caller
    })
    const roomId = getChatRoomId(DOMAIN)
    onPeerJoin(roomId, 'remote-peer')
    onMessage(
      roomId,
      'remote-peer',
      await NativeWireCodec.encode({
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'recovered-session',
        presenceId: 'recovered-presence',
        user: { id: 'remote-user', name: 'Recovered', avatar: '' },
        joinedAt: 10
      })
    )
    await vi.waitFor(async () => {
      const domain = (await first.getSnapshot({ caller })).domains.find((item) => item.domain === DOMAIN)
      expect(domain?.sessions.map(({ sourcePeerId }) => sourcePeerId)).toEqual(['remote-peer'])
    })

    await presenceStore.save({
      domain: DOMAIN,
      lastJoinedAt: 8_000_000_000_000_000,
      observers: [
        {
          presenceId: 'ended-presence',
          sessionId: 'ended-session',
          user: { id: 'ended-user', name: 'Ended', avatar: '' },
          joinedAt: 7_000_000_000_000_000,
          status: 'ended'
        }
      ]
    })

    const replacementTransport = new RemoteRoomTransport(service)
    await replacementTransport.rebind()
    expect(replacementTransport.roomRecovery().rooms).toHaveLength(1)
    const replacement = createServer({ transport: replacementTransport, codec: NativeWireCodec, presenceStore })
    const initial = await replacement.attachPage({ domain: DOMAIN, caller })
    expect(initial.domains.find((item) => item.domain === DOMAIN)).toMatchObject({
      chatRoomJoined: true,
      sessions: [expect.objectContaining({ sourcePeerId: 'remote-peer' })]
    })

    // The first ordinary SESSION after recovery causes the normal owner persistence write. It
    // must merge rather than replace the durable ended observer/history HLC seed.
    onMessage(
      roomId,
      'remote-peer',
      await NativeWireCodec.encode({
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'current-session',
        presenceId: 'current-presence',
        user: { id: 'current-user', name: 'Current', avatar: '' },
        joinedAt: 20
      })
    )
    await vi.waitFor(async () => {
      const record = await presenceStore.load(DOMAIN)
      expect(record?.lastJoinedAt).toBe(8_000_000_000_000_000)
      expect(record?.observers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            presenceId: 'ended-presence',
            status: 'ended',
            joinedAt: 7_000_000_000_000_000
          }),
          expect.objectContaining({ presenceId: 'current-presence', status: 'active', joinedAt: 20 })
        ])
      )
    })
    disposeServer(first)
    disposeServer(replacement)
  })
})
