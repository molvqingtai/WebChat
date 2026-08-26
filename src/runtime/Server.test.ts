import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshAction } from 'remesh'
import {
  createServer,
  disposeServer,
  getChatRoomId,
  getWorldRoomId,
  readServerSnapshot,
  removeServerTab
} from '@/runtime/Server'
import type { Clock } from '@/domain/runtime/externs/Clock'
import type { PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { UserInfo } from '@/domain/UserInfo'
import type { WireCodec } from '@/protocol'
import {
  MESSAGE_TYPE,
  type ChatMessage,
  type ChatRoomMessage,
  type ChatUser,
  type HistoryMessagesPull,
  type TextMessage,
  type WorldRoomMessage
} from '@/protocol'
import { MESSAGE_RECORD_TYPE, type ReactionMessageRecord, type TextMessageRecord } from '@/domain/Message'
import type { ReactionMessageAllocatedEventPayload, TextMessageAllocatedEventPayload } from '@/domain/runtime/Session'
import { createMessageStore } from '@/domain/MessageStore'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import type { HistorySupplyRequest, HistorySupplyResult, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { HISTORY_REQUEST_TIMEOUT_MS, RUNTIME_DOMAIN_GRACE_MS, PENDING_LEAVE_GRACE_MS } from '@/constants/config'
import { createBrowserPresenceStore } from '@/runtime/PresenceStore'
import { ROOM_RECOVERY_RETRY_INTERVAL_MS } from '@/domain/runtime/Connection'
import { DocumentClient } from '@/runtime/DocumentClient'

const NOW = 1_800_000_000_000
const PHYSICAL_ROOM_JOIN_TIMEOUT_MS = 10000
const DOMAIN = 'https://example.com'
const OTHER_DOMAIN = 'https://other.example'
const USER: ChatUser = { id: 'local-user', name: 'Local', avatar: '' }
const USER_INFO: UserInfo = {
  ...USER,
  createTime: NOW,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'all'
}
const REMOTE_USER: ChatUser = { id: 'remote-user', name: 'Remote', avatar: '' }
const SITE = { origin: DOMAIN, title: 'Example', icon: 'https://example.com/favicon.ico' }

type TestWireMessage = ChatRoomMessage | (WorldRoomMessage & { type?: never })
const isWorldPresence = (message: TestWireMessage): message is WorldRoomMessage & { type?: never } => 'sites' in message

type ObservedDualEpochGate = {
  epoch: string
  domain: string
  attemptId: string
  chatGeneration: number
  worldGeneration: number
}

/** Test-only dispatch observer: it records the real action and delegates it unchanged. */
const observeDualEpochGateDispatches = () => {
  const begins: ObservedDualEpochGate[] = []
  const aborts: ObservedDualEpochGate[] = []
  const originalStore = Remesh.store
  const storeSpy = vi.spyOn(Remesh, 'store').mockImplementation((...args) => {
    const store = originalStore(...args)
    const send = store.send
    store.send = (output: RemeshAction) => {
      if (!output || Array.isArray(output) || output.type !== 'RemeshCommandAction') return send(output)
      if (output.Command.commandName === 'Connection.BeginDualEpochReplacementCommand') {
        begins.push(output.arg as ObservedDualEpochGate)
      }
      if (output.Command.commandName === 'Connection.AbortDualEpochCommand') {
        aborts.push(output.arg as ObservedDualEpochGate)
      }
      return send(output)
    }
    return store
  })
  return { begins, aborts, restore: () => storeSpy.mockRestore() }
}

/** Attaches one current tab lease through trusted browser caller facts (no admission in isolated tests). */
const attachTab = (server: RuntimeServer, domain: string, tabId: number) =>
  server.attachPage({ domain, caller: { tab: { id: tabId, url: `${domain}/` } } })

/** Caller facts for an ordinary action from an already attached tab. */
const callerOf = (tabId: number, domain = DOMAIN) => ({ caller: { tab: { id: tabId, url: `${domain}/` } } })

const domainSnapshot = (snapshot: RuntimeSnapshot, domain = DOMAIN) =>
  snapshot.domains.find((item) => item.domain === domain)

/** Reads the current retained inbound message ids from the projection (replaces the removed onInbound push). */
const projectedInboundIds = async (server: RuntimeServer, domain = DOMAIN) =>
  ((await readServerSnapshot(server)).domains.find((item) => item.domain === domain)?.inbound ?? []).map(
    (event) => event.record.message.id
  )

/** ACKs every currently projected inbound event for the domain through the ordinary action. */
const ackAllProjectedInbound = async (server: RuntimeServer, domain = DOMAIN, inserted = true) => {
  const events = (await readServerSnapshot(server)).domains.find((item) => item.domain === domain)?.inbound ?? []
  for (const event of events) {
    await server.ackInbound({ domain, sequence: event.sequence, inserted })
  }
}

class FakeClock implements Clock {
  constructor(private current = NOW) {}

  now() {
    return this.current
  }

  async sleep(_ms: number) {
    await Promise.resolve()
    await Promise.resolve()
  }

  advance(ms: number) {
    this.current += ms
    vi.advanceTimersByTime(ms)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('RuntimeServer production admission and one-way notification', () => {
  const pageUrl = `${DOMAIN}/topic`

  const createAdmissionFixture = () => {
    const tabs = new Map<number, { id: number; url: string }>([[7, { id: 7, url: pageUrl }]])
    const ensureTransport = vi.fn(async () => {})
    const sentMessages: Array<{ tabId: number; message: unknown }> = []
    const fake = createFakeTransport()
    const admission = {
      tabs: {
        get: async (tabId: number) => {
          const tab = tabs.get(tabId)
          if (!tab) throw new Error('tab missing')
          return tab
        },
        query: async () => [...tabs.values()],
        sendMessage: async (tabId: number, message: unknown) => {
          sentMessages.push({ tabId, message })
          return undefined
        }
      },
      ensureTransport
    }
    const server = createServer({ transport: fake.transport, codec: jsonCodec, admission })
    const attach = () => server.attachPage({ domain: DOMAIN, caller: { tab: tabs.get(7) } })
    const call = () => ({ caller: { tab: tabs.get(7) } })
    const hints = () =>
      sentMessages.filter(({ message }) => (message as { type?: string }).type === 'runtime:state-changed')
    return { admission, attach, call, fake, hints, sentMessages, server, tabs }
  }

  it('rejects an action without current browser caller facts and returns the full projection on attach', async () => {
    const fixture = createAdmissionFixture()
    await expect(fixture.server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })).rejects.toThrow(
      'Current Page browser caller is required'
    )

    const snapshot = await fixture.attach()
    expect(snapshot.domains[0]).toMatchObject({ domain: DOMAIN, phase: 'active', tabIds: [7] })
    expect(snapshot.domains[0]?.inbound).toEqual([])
    expect(snapshot.failures).toEqual([])

    await fixture.server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...fixture.call() })
    expect(fixture.fake.joinCalls.filter((roomId) => roomId === getChatRoomId(DOMAIN))).toHaveLength(1)
    disposeServer(fixture.server)
  })

  it('rejects a caller whose tab navigation or domain no longer matches browser truth', async () => {
    const fixture = createAdmissionFixture()
    await fixture.attach()
    await expect(
      fixture.server.joinChatRoom({
        domain: DOMAIN,
        user: USER,
        site: SITE,
        caller: { tab: { id: 8, url: pageUrl } }
      })
    ).rejects.toThrow()
    await expect(
      fixture.server.joinChatRoom({
        domain: OTHER_DOMAIN,
        user: USER,
        site: { ...SITE, origin: OTHER_DOMAIN },
        ...fixture.call()
      })
    ).rejects.toThrow()
    disposeServer(fixture.server)
  })

  it('issues only content-free fire-and-forget hints after commits, and zero hints for stable reads', async () => {
    const fixture = createAdmissionFixture()
    await fixture.attach()
    // The attach commit itself notified; a stable read must never select tabs or notify.
    await vi.waitFor(() => expect(fixture.hints().length).toBeGreaterThan(0))
    const baseline = fixture.hints().length
    await fixture.server.getSnapshot(fixture.call())
    await fixture.server.getSnapshot(fixture.call())
    await settle()
    expect(fixture.hints()).toHaveLength(baseline)

    await fixture.server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...fixture.call() })
    await vi.waitFor(() => expect(fixture.hints().length).toBeGreaterThan(baseline))
    for (const { message } of fixture.hints()) {
      expect(message).toEqual({ type: 'runtime:state-changed' })
    }
    disposeServer(fixture.server)
  })

  it('rejects a caller-free remote snapshot request while the private in-process read stays available', async () => {
    const fixture = createAdmissionFixture()
    await fixture.attach()

    // The comctx-exported method requires a caller-bearing request at runtime and at the type level.
    await expect((fixture.server.getSnapshot as (payload?: unknown) => Promise<unknown>)()).rejects.toThrow(
      'Caller-bearing snapshot request is required'
    )

    // The private in-process read (never exported over comctx) still answers Background/tests.
    const internal = readServerSnapshot(fixture.server)
    expect(internal.domains[0]).toMatchObject({ domain: DOMAIN, phase: 'active', tabIds: [7] })
    // A legitimate Page read validates the caller and projects provider-scoped feedback.
    const page = await fixture.server.getSnapshot(fixture.call())
    expect(page.domains[0]?.tabIds).toEqual([7])
    disposeServer(fixture.server)
  })

  it('a stable duplicate attach performs no state commit and issues no new hint', async () => {
    const fixture = createAdmissionFixture()
    await fixture.attach()
    await vi.waitFor(() => expect(fixture.hints().length).toBeGreaterThan(0))
    const baseline = fixture.hints().length

    // A same-tab, same-domain registration retry changes no authoritative state: no query/send.
    await fixture.attach()
    await fixture.attach()
    await settle()
    expect(fixture.hints()).toHaveLength(baseline)
    const snapshot = await fixture.server.getSnapshot(fixture.call())
    expect(snapshot.domains[0]).toMatchObject({ phase: 'active', tabIds: [7] })
    disposeServer(fixture.server)
  })

  it('never branches on a notification rejection', async () => {
    const fixture = createAdmissionFixture()
    fixture.admission.tabs.sendMessage = async () => {
      throw new Error('no receiver')
    }
    await fixture.attach()
    await fixture.server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...fixture.call() })
    await settle()
    // The commit stands even though every notification attempt rejected.
    const snapshot = await fixture.server.getSnapshot(fixture.call())
    expect(domainSnapshot(snapshot)?.chatRoomJoined).toBe(true)
    disposeServer(fixture.server)
  })

  it('detaches on tab removal, retains the room through grace, and releases after the deadline', async () => {
    const fixture = createAdmissionFixture()
    await fixture.attach()
    await fixture.server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...fixture.call() })
    expect(fixture.fake.joined.has(getChatRoomId(DOMAIN))).toBe(true)

    await removeServerTab(fixture.server, 7)
    expect((await fixture.server.getSnapshot(fixture.call())).domains[0]).toMatchObject({
      phase: 'grace',
      tabIds: []
    })
    expect(fixture.fake.joined.has(getChatRoomId(DOMAIN))).toBe(true)

    await vi.advanceTimersByTimeAsync(RUNTIME_DOMAIN_GRACE_MS)
    expect((await fixture.server.getSnapshot(fixture.call())).domains).toEqual([])
    expect(fixture.fake.joined.has(getChatRoomId(DOMAIN))).toBe(false)
    disposeServer(fixture.server)
  })

  it('a successor tab attach inside grace resumes the same room without a redundant join', async () => {
    const fixture = createAdmissionFixture()
    await fixture.attach()
    await fixture.server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...fixture.call() })
    await removeServerTab(fixture.server, 7)
    fixture.tabs.set(9, { id: 9, url: pageUrl })
    await fixture.server.attachPage({ domain: DOMAIN, caller: { tab: fixture.tabs.get(9) } })
    await vi.advanceTimersByTimeAsync(RUNTIME_DOMAIN_GRACE_MS)
    const snapshot = await fixture.server.getSnapshot({ caller: { tab: fixture.tabs.get(9) } })
    expect(snapshot.domains[0]).toMatchObject({ phase: 'active', tabIds: [9], chatRoomJoined: true })
    expect(fixture.fake.joinCalls.filter((roomId) => roomId === getChatRoomId(DOMAIN))).toHaveLength(1)
    disposeServer(fixture.server)
  })
})
afterEach(() => {
  vi.useRealTimers()
})

const jsonCodec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload)
}

const createFakeTransport = ({ physicalReady = true }: { physicalReady?: boolean } = {}) => {
  const desired = new Set<string>()
  const joined = new Set<string>()
  const joinCalls: string[] = []
  const physicalJoinCalls: string[] = []
  const operationLog: string[] = []
  const sent: { roomId: string; payload: string; to?: string | string[]; rawTarget?: string | string[] }[] = []
  const sendAttempts: { roomId: string; payload: string; to?: string | string[]; rawTarget?: string | string[] }[] = []
  const sendAttemptWaiters: {
    roomId?: string
    resolve: (attempt: (typeof sendAttempts)[number]) => void
  }[] = []
  const pendingJoins = new Map<
    string,
    { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }
  >()
  const desiredWaiters: { count: number; resolve: () => void }[] = []
  const joinCallWaiters: { count: number; resolve: () => void }[] = []
  const peersByRoom = new Map<string, Set<string>>()
  const failedJoins = new Set<string>()
  const failedNextSends = new Set<string>()
  const failedLeaves = new Map<string, Error>()
  const messageListeners = new Set<(roomId: string, sourcePeerId: string, rawPayload: string) => void>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  const errorListeners = new Set<(error: Error, roomId: string) => void>()
  let sendError: Error | null = null
  let sendErrorRoomId: string | null = null
  const sendGates = new Map<string, { promise: Promise<void>; release: () => void }>()
  let historySendGate: Promise<void> | null = null
  let releaseHistorySendGate = () => {}
  let activeHistorySends = 0
  let maxActiveHistorySends = 0
  let disposeCount = 0
  let retireGate: Promise<void> | null = null
  let releaseRetireGate = () => {}
  let retireFailure: Error | null = null
  let ingressGate: Promise<void> | null = null
  let releaseIngressGate = () => {}
  let ingressFailure: Error | null = null
  const replacementFailures = new Map<string, Error>()

  const createPendingJoin = () => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    return { promise, resolve, reject }
  }
  const resolveDesiredWaiters = () => {
    desiredWaiters.forEach((waiter) => {
      if (desired.size >= waiter.count) waiter.resolve()
    })
    desiredWaiters.splice(0, desiredWaiters.length, ...desiredWaiters.filter((waiter) => desired.size < waiter.count))
  }
  const resolveJoinCallWaiters = () => {
    joinCallWaiters.forEach((waiter) => {
      if (joinCalls.length >= waiter.count) waiter.resolve()
    })
    joinCallWaiters.splice(
      0,
      joinCallWaiters.length,
      ...joinCallWaiters.filter((waiter) => joinCalls.length < waiter.count)
    )
  }

  const transport: RoomTransport & { takeReplacementFailure: (stage: string) => Error | undefined } = {
    peerIdOf: (roomId) => (roomId === getWorldRoomId() ? 'local-peer' : `local-peer:${roomId}`),
    join: (roomId) => {
      joinCalls.push(roomId)
      resolveJoinCallWaiters()
      desired.add(roomId)
      resolveDesiredWaiters()
      if (failedJoins.delete(roomId)) return Promise.reject(new Error(`Room "${roomId}" join failed`))
      if (joined.has(roomId)) return Promise.resolve()
      if (physicalReady) {
        joined.add(roomId)
        physicalJoinCalls.push(roomId)
        const members = [...(peersByRoom.get(roomId) ?? [])]
        queueMicrotask(() => {
          if (joined.has(roomId))
            members.forEach((peerId) => joinListeners.forEach((listener) => listener(roomId, peerId)))
        })
        return Promise.resolve()
      }
      const pending = pendingJoins.get(roomId) ?? createPendingJoin()
      pendingJoins.set(roomId, pending)
      return pending.promise
    },
    leave: (roomId, options) => {
      operationLog.push(`leave:${roomId}`)
      desired.delete(roomId)
      joined.delete(roomId)
      pendingJoins.get(roomId)?.reject(new Error(`Room "${roomId}" join cancelled`))
      pendingJoins.delete(roomId)
      const failure = failedLeaves.get(roomId)
      if (!failure) return
      failedLeaves.delete(roomId)
      if (options?.diagnosticOnly) console.error(failure)
      else errorListeners.forEach((listener) => listener(failure, roomId))
    },
    retireRoomsForPreparation: async (roomIds) => {
      operationLog.push(`retire:${roomIds.join(',')}`)
      await retireGate
      if (retireFailure) {
        const failure = retireFailure
        retireFailure = null
        throw failure
      }
      roomIds.forEach((roomId) => transport.leave(roomId))
    },
    activateIngress: async () => {
      await ingressGate
      if (ingressFailure) {
        const failure = ingressFailure
        ingressFailure = null
        throw failure
      }
    },
    takeReplacementFailure: (stage: string) => {
      const failure = replacementFailures.get(stage)
      if (failure) replacementFailures.delete(stage)
      return failure
    },
    send: async (roomId, payload, to) => {
      // A broadcast records its actual recipients: the room's current members at send time.
      // `rawTarget` keeps the caller's own target argument (undefined means a native broadcast).
      const recipients = to === undefined ? [...(peersByRoom.get(roomId) ?? [])] : to
      const attempt = { roomId, payload, to: recipients, rawTarget: to }
      sendAttempts.push(attempt)
      const matchingWaiters = sendAttemptWaiters.filter((waiter) => !waiter.roomId || waiter.roomId === roomId)
      sendAttemptWaiters.splice(
        0,
        sendAttemptWaiters.length,
        ...sendAttemptWaiters.filter((waiter) => !matchingWaiters.includes(waiter))
      )
      matchingWaiters.forEach((waiter) => waiter.resolve(attempt))
      if (!joined.has(roomId)) throw new Error(`Room "${roomId}" not joined`)
      if (sendError && (!sendErrorRoomId || sendErrorRoomId === roomId)) throw sendError
      if (failedNextSends.delete(roomId)) throw new Error(`Room "${roomId}" send failed`)
      sent.push(attempt)
      operationLog.push(`send:${roomId}`)
      const sendGate = sendGates.get(roomId)
      if (sendGate) await sendGate.promise
      const message = JSON.parse(payload) as TestWireMessage
      if (!('type' in message) || message.type !== MESSAGE_TYPE.HISTORY_MESSAGES_PUSH) return
      if (!historySendGate) return
      activeHistorySends += 1
      maxActiveHistorySends = Math.max(maxActiveHistorySends, activeHistorySends)
      try {
        await historySendGate
      } finally {
        activeHistorySends -= 1
      }
    },
    onMessage: (callback) => {
      messageListeners.add(callback)
      return () => messageListeners.delete(callback)
    },
    onPeerJoin: (callback) => {
      joinListeners.add(callback)
      return () => joinListeners.delete(callback)
    },
    onPeerLeave: (callback) => {
      leaveListeners.add(callback)
      return () => leaveListeners.delete(callback)
    },
    onRoomClose: (callback) => {
      closeListeners.add(callback)
      return () => closeListeners.delete(callback)
    },
    onError: (callback) => {
      errorListeners.add(callback)
      return () => errorListeners.delete(callback)
    },
    dispose: () => {
      disposeCount += 1
      releaseRetireGate()
      retireGate = null
      releaseRetireGate = () => {}
      releaseIngressGate()
      ingressGate = null
      releaseIngressGate = () => {}
      desired.clear()
      joined.clear()
      pendingJoins.forEach((pending, roomId) => pending.reject(new Error(`Room "${roomId}" join cancelled`)))
      pendingJoins.clear()
      sendGates.forEach(({ release }) => release())
      sendGates.clear()
      desiredWaiters.splice(0).forEach((waiter) => waiter.resolve())
      joinCallWaiters.splice(0).forEach((waiter) => waiter.resolve())
      sendAttemptWaiters.length = 0
      messageListeners.clear()
      joinListeners.clear()
      leaveListeners.clear()
      closeListeners.clear()
      errorListeners.clear()
    }
  }

  return {
    transport,
    desired,
    joined,
    joinCalls,
    physicalJoinCalls,
    operationLog,
    sent,
    sendAttempts,
    waitForSendAttempt: (roomId?: string) =>
      new Promise<(typeof sendAttempts)[number]>((resolve) => sendAttemptWaiters.push({ roomId, resolve })),
    waitForDesiredRooms: (count: number) =>
      desired.size >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => desiredWaiters.push({ count, resolve })),
    waitForJoinCalls: (count: number) =>
      joinCalls.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => joinCallWaiters.push({ count, resolve })),
    open: () => {
      physicalReady = true
      desired.forEach((roomId) => {
        if (!joined.has(roomId)) physicalJoinCalls.push(roomId)
        joined.add(roomId)
        pendingJoins.get(roomId)?.resolve()
        pendingJoins.delete(roomId)
        const members = [...(peersByRoom.get(roomId) ?? [])]
        queueMicrotask(() => {
          if (joined.has(roomId))
            members.forEach((peerId) => joinListeners.forEach((listener) => listener(roomId, peerId)))
        })
      })
    },
    makeNotReady: () => {
      physicalReady = false
    },
    holdRetires: () => {
      if (retireGate) throw new Error('Retire gate is already held')
      retireGate = new Promise<void>((resolve) => {
        releaseRetireGate = resolve
      })
      return () => {
        const release = releaseRetireGate
        retireGate = null
        releaseRetireGate = () => {}
        release()
      }
    },
    failNextRetire: (error: Error) => {
      retireFailure = error
    },
    holdIngressActivation: () => {
      if (ingressGate) throw new Error('Ingress activation gate is already held')
      ingressGate = new Promise<void>((resolve) => {
        releaseIngressGate = resolve
      })
      return () => {
        const release = releaseIngressGate
        ingressGate = null
        releaseIngressGate = () => {}
        release()
      }
    },
    failNextIngressActivation: (error: Error) => {
      ingressFailure = error
    },
    failReplacementAt: (stage: string, error: Error) => {
      replacementFailures.set(stage, error)
    },
    failNextJoin: (roomId: string) => {
      failedJoins.add(roomId)
    },
    failNextLeave: (roomId: string, error: Error) => {
      failedLeaves.set(roomId, error)
    },
    failSend: (error: Error | null, roomId?: string) => {
      sendError = error
      sendErrorRoomId = roomId ?? null
    },
    failNextSend: (roomId: string) => {
      failedNextSends.add(roomId)
    },
    hangSendsTo: (roomId: string) => {
      let release!: () => void
      const promise = new Promise<void>((resolve) => {
        release = resolve
      })
      sendGates.set(roomId, { promise, release })
    },
    releaseSends: () => {
      sendGates.forEach(({ release }) => release())
      sendGates.clear()
    },
    hangHistoryResponseSends: () => {
      historySendGate = new Promise<void>((resolve) => {
        releaseHistorySendGate = resolve
      })
    },
    releaseHistoryResponseSends: () => {
      releaseHistorySendGate()
      historySendGate = null
    },
    activeHistorySends: () => activeHistorySends,
    maxActiveHistorySends: () => maxActiveHistorySends,
    disposeCount: () => disposeCount,
    receive: (roomId: string, sourcePeerId: string, message: unknown) => {
      if (!joined.has(roomId)) return
      // A wire message implies physical room membership without a fresh join announcement.
      const peers = peersByRoom.get(roomId) ?? new Set<string>()
      peers.add(sourcePeerId)
      peersByRoom.set(roomId, peers)
      messageListeners.forEach((listener) => listener(roomId, sourcePeerId, JSON.stringify(message)))
    },
    /** Plants a pre-existing room member without a fresh join announcement. */
    plantPeer: (roomId: string, peerId: string) => {
      const peers = peersByRoom.get(roomId) ?? new Set<string>()
      peers.add(peerId)
      peersByRoom.set(roomId, peers)
    },
    forgetPeer: (roomId: string, peerId: string) => {
      peersByRoom.get(roomId)?.delete(peerId)
    },
    peerJoin: (roomId: string, peerId: string) => {
      if (!joined.has(roomId)) return
      const peers = peersByRoom.get(roomId) ?? new Set<string>()
      if (peers.has(peerId)) {
        peersByRoom.set(roomId, peers)
      } else {
        peers.add(peerId)
        peersByRoom.set(roomId, peers)
        joinListeners.forEach((listener) => listener(roomId, peerId))
      }
    },
    peerLeave: (roomId: string, peerId: string) => {
      peersByRoom.get(roomId)?.delete(peerId)
      leaveListeners.forEach((listener) => listener(roomId, peerId))
    },
    roomClose: (roomId: string) => {
      joined.delete(roomId)
      closeListeners.forEach((listener) => listener(roomId))
    },
    emitError: (error: Error, roomId: string) => {
      errorListeners.forEach((listener) => listener(error, roomId))
    },
    messages: (roomId: string) =>
      sent.filter((item) => item.roomId === roomId).map((item) => JSON.parse(item.payload) as TestWireMessage)
  }
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0)
}

/** Injects one current remote World peer so publication iterators have a distinct live target. */
const emitRemoteWorldPresence = (fake: ReturnType<typeof createFakeTransport>, sourcePeerId = 'remote-peer') => {
  fake.peerJoin(getWorldRoomId(), sourcePeerId)
  fake.receive(getWorldRoomId(), sourcePeerId, {
    sessionId: `remote-world-${sourcePeerId}`,
    user: REMOTE_USER,
    sites: [{ origin: 'https://remote.example', title: 'Remote' }]
  })
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

const sentToPeer = (fake: ReturnType<typeof createFakeTransport>, roomId: string, peerId: string) =>
  fake.sent
    .filter((message) => {
      const recipients = typeof message.to === 'string' ? [message.to] : message.to
      return message.roomId === roomId && recipients?.includes(peerId)
    })
    .map((message) => JSON.parse(message.payload) as TestWireMessage)

const session = (user = REMOTE_USER) => ({
  type: MESSAGE_TYPE.SESSION,
  sessionId: `session-${user.id}`,
  presenceId: `presence-${user.id}`,
  joinedAt: NOW + 1,
  user
})

const text = (id: string, userId = REMOTE_USER.id, timestamp = NOW): TextMessage => ({
  type: MESSAGE_TYPE.TEXT,
  id,
  hlc: { timestamp, counter: 0 },
  userId,
  body: 'hello',
  mentions: []
})

const textRecord = (id: string, timestamp = NOW): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: text(id, USER.id, timestamp),
  user: USER,
  receivedAt: timestamp
})

const setup = async (domain = DOMAIN, now = NOW, codec: WireCodec = jsonCodec) => {
  const clock = new FakeClock(now)
  const fake = createFakeTransport()
  const server = createServer({ transport: fake.transport, clock, codec })
  await attachTab(server, domain, 1)
  await server.joinChatRoom({ domain, user: USER, site: { ...SITE, origin: domain } })
  await settle()
  return { clock, fake, server, roomId: getChatRoomId(domain) }
}

const registerHistoryProvider = (
  server: RuntimeServer,
  payload: { domain: string; caller?: { tab: { id: number; url: string } } },
  supply: (request: HistorySupplyRequest, signal: AbortSignal) => Promise<HistorySupplyResult>
) => {
  const active = new Map<string, AbortController>()
  return server.provideHistory(payload, (event) => {
    if (event.type === 'cancel') {
      active.get(event.supplyId)?.abort(new DOMException('History supply cancelled', 'AbortError'))
      return
    }
    const controller = new AbortController()
    active.set(event.request.supplyId, controller)
    void Promise.resolve()
      .then(() => supply(event.request, controller.signal))
      .then((result) => {
        controller.signal.throwIfAborted()
        if (active.get(event.request.supplyId) !== controller) return
        return server.resolveHistorySupply({
          supplyId: event.request.supplyId,
          result,
          ...(payload.caller ? { caller: payload.caller } : {})
        })
      })
      .catch((error) => {
        if (active.get(event.request.supplyId) !== controller) return
        return server.rejectHistorySupply({
          supplyId: event.request.supplyId,
          reason: (error as Error).message,
          ...(payload.caller ? { caller: payload.caller } : {})
        })
      })
      .finally(() => {
        if (active.get(event.request.supplyId) === controller) active.delete(event.request.supplyId)
      })
  })
}

/**
 * Compile-time negative fixture at the typed Session allocation-event boundary (guarded by the
 * tsc gate): the payload types are exact, so a reaction payload cannot satisfy a text
 * allocation payload and a missing record is rejected. If the events ever regressed to the
 * generic optional record, the directives would go unused and tsc would fail.
 */
const sessionAllocationEventFixture = () => {
  const textPayload: TextMessageAllocatedEventPayload = {
    operationId: 'fixture',
    record: {} as TextMessageRecord
  }
  const reactionPayload: ReactionMessageAllocatedEventPayload = {
    operationId: 'fixture',
    record: {} as ReactionMessageRecord
  }
  // @ts-expect-error — a reaction allocation payload is not a text allocation payload
  const wrongVariant: TextMessageAllocatedEventPayload = { operationId: 'fixture', record: {} as ReactionMessageRecord }
  // @ts-expect-error — the typed allocation payload requires a record
  const missingRecord: TextMessageAllocatedEventPayload = { operationId: 'fixture' }
  void textPayload
  void reactionPayload
  void wrongVariant
  void missingRecord
}

void sessionAllocationEventFixture

describe('RuntimeServer lifecycle', () => {
  it('fails closed before a direct replacement cut when the mandatory retirement capability is malformed', async () => {
    const { fake, server } = await setup()
    const joinsBeforeReplacement = fake.joinCalls.length
    const malformed = fake.transport as unknown as { retireRoomsForPreparation?: unknown }
    malformed.retireRoomsForPreparation = undefined

    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toThrow(
      'retireRoomsForPreparation is not a function'
    )

    expect(fake.operationLog.filter((entry) => entry.startsWith('retire:'))).toEqual([])
    expect(fake.joinCalls).toHaveLength(joinsBeforeReplacement)
    disposeServer(server)
  })

  it('starts Session and History only for admitted peer edges on a direct join', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock: new FakeClock(), codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => ({
      records: [],
      done: true
    }))
    const roomId = getChatRoomId(DOMAIN)
    fake.plantPeer(roomId, 'peer-chat')
    fake.plantPeer(getWorldRoomId(), 'peer-world')

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await vi.waitFor(() =>
      expect(
        fake.sendAttempts.filter(({ roomId: sentRoomId, payload }) => {
          if (sentRoomId !== roomId) return false
          const message = JSON.parse(payload) as ChatRoomMessage
          return message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
        })
      ).toHaveLength(2)
    )

    const initialChatAttempts = fake.sendAttempts.filter(({ roomId: sentRoomId }) => sentRoomId === roomId)
    expect(
      initialChatAttempts.map(({ rawTarget, payload }) => ({ rawTarget, type: JSON.parse(payload).type }))
    ).toEqual([
      { rawTarget: ['peer-chat'], type: MESSAGE_TYPE.SESSION },
      { rawTarget: ['peer-chat'], type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL }
    ])
    expect(
      fake.sendAttempts.find(({ roomId: sentRoomId }) => sentRoomId === getWorldRoomId())?.rawTarget
    ).toBeUndefined()

    // A peer joining after commit creates only its new Session/History edge.
    fake.peerJoin(roomId, 'peer-late')
    await vi.waitFor(() =>
      expect(
        fake.sendAttempts.filter(({ roomId: sentRoomId, payload }) => {
          if (sentRoomId !== roomId) return false
          const message = JSON.parse(payload) as ChatRoomMessage
          return message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
        })
      ).toHaveLength(4)
    )
    const lateChatAttempts = fake.sendAttempts.filter(({ roomId: sentRoomId, payload }) => {
      if (sentRoomId !== roomId) return false
      const message = JSON.parse(payload) as ChatRoomMessage
      return message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
    })
    expect(lateChatAttempts.slice(2).every(({ rawTarget }) => Array.isArray(rawTarget))).toBe(true)
    expect(
      lateChatAttempts.filter(({ rawTarget }) => JSON.stringify(rawTarget) === JSON.stringify(['peer-chat']))
    ).toHaveLength(2)
    expect(
      lateChatAttempts.filter(({ rawTarget }) => JSON.stringify(rawTarget) === JSON.stringify(['peer-late']))
    ).toHaveLength(2)
    disposeServer(server)
  })

  it('resets the closed room History incarnation while retaining late requester pages', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        return new Promise<HistorySupplyResult>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelled.push(request.syncId)
              reject(signal.reason ?? new Error('History supply cancelled'))
            },
            { once: true }
          )
        })
      }
    )

    fake.peerJoin(roomId, 'history-peer')
    await vi.waitFor(() => {
      expect(
        sentToPeer(fake, roomId, 'history-peer').filter(
          (message) => message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
        )
      ).toHaveLength(1)
    })
    const oldRequesterPull = sentToPeer(fake, roomId, 'history-peer').find(
      (message): message is HistoryMessagesPull => message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
    )
    if (!oldRequesterPull) throw new Error('Initial requester Pull missing')

    fake.receive(roomId, 'history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-provider-pull',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-provider-pull']))

    fake.roomClose(roomId)
    await vi.waitFor(() => expect(cancelled).toEqual(['old-provider-pull']))
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(true))
    await vi.waitFor(() => {
      const edgeMessages = sentToPeer(fake, roomId, 'history-peer').filter(
        (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
      )
      expect(edgeMessages).toHaveLength(4)
    })

    const recoveredMessages = sentToPeer(fake, roomId, 'history-peer').filter(
      (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
    )
    expect(recoveredMessages.filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(2)
    expect(recoveredMessages.filter((message) => message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toHaveLength(2)
    expect(
      new Set(
        recoveredMessages
          .filter((message): message is HistoryMessagesPull => message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
          .map((message) => message.syncId)
      ).size
    ).toBe(2)

    fake.receive(roomId, 'history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: oldRequesterPull.syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('late-after-room-close')],
      done: true
    })
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toContain('late-after-room-close'))

    fake.receive(roomId, 'history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'fresh-provider-pull',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-provider-pull', 'fresh-provider-pull']))
    disposeServer(server)
  })

  it('blocks release-start peer edges while keeping a committed opposite domain active', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let holdClearSave = false
    const clearSaveStarted = deferred<void>()
    const releaseClearSave = deferred<void>()
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as { lastJoinedAt?: number; observers?: unknown[] }
        if (
          holdClearSave &&
          record &&
          typeof record === 'object' &&
          record.lastJoinedAt === 0 &&
          (record.observers ?? []).length === 0
        ) {
          clearSaveStarted.resolve()
          await releaseClearSave.promise
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const oppositeDomain = OTHER_DOMAIN
    const releaseRoomId = getChatRoomId(DOMAIN)
    const oppositeRoomId = getChatRoomId(oppositeDomain)
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.attachPage({ domain: oppositeDomain, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: oppositeDomain, user: USER, site: { ...SITE, origin: oppositeDomain } })
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => ({
      records: [],
      done: true
    }))
    await registerHistoryProvider(
      server,
      { domain: oppositeDomain, caller: { tab: { id: 2, url: '' } } },
      async () => ({
        records: [],
        done: true
      })
    )
    await settle()

    holdClearSave = true
    const leave = server.leaveChatRoom({ domain: DOMAIN })
    await clearSaveStarted.promise

    fake.peerJoin(releaseRoomId, 'release-peer')
    fake.peerJoin(oppositeRoomId, 'opposite-peer')
    fake.receive(releaseRoomId, 'release-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'release-pull',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()

    const releaseEdgeMessages = sentToPeer(fake, releaseRoomId, 'release-peer').filter(
      (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
    )
    expect(releaseEdgeMessages).toEqual([])
    const oppositeEdgeMessages = sentToPeer(fake, oppositeRoomId, 'opposite-peer').filter(
      (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
    )
    expect(oppositeEdgeMessages.filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(1)
    expect(oppositeEdgeMessages.filter((message) => message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toHaveLength(
      1
    )

    releaseClearSave.resolve()
    await leave
    disposeServer(server)
  })

  it('commits an empty room without Session or History peer sends', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock: new FakeClock(), codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })

    expect(fake.sendAttempts).toHaveLength(1)
    expect(fake.sendAttempts[0]?.roomId).toBe(getWorldRoomId())
    expect(fake.sendAttempts[0]?.rawTarget).toBeUndefined()
    disposeServer(server)
  })

  it('adds only pairwise work when two more peers are admitted', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock: new FakeClock(), codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => ({
      records: [],
      done: true
    }))
    const roomId = getChatRoomId(DOMAIN)
    fake.plantPeer(roomId, 'peer-b')
    fake.plantPeer(roomId, 'peer-c')

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await vi.waitFor(() =>
      expect(
        fake.sendAttempts.filter(({ roomId: sentRoomId, payload }) => {
          if (sentRoomId !== roomId) return false
          const message = JSON.parse(payload) as ChatRoomMessage
          return message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
        })
      ).toHaveLength(4)
    )

    const initial = fake.sendAttempts.filter(({ roomId: sentRoomId }) => sentRoomId === roomId)
    expect(initial.every(({ rawTarget }) => Array.isArray(rawTarget))).toBe(true)
    expect(initial.map(({ rawTarget }) => JSON.stringify(rawTarget)).toSorted()).toEqual([
      JSON.stringify(['peer-b']),
      JSON.stringify(['peer-b']),
      JSON.stringify(['peer-c']),
      JSON.stringify(['peer-c'])
    ])
    fake.peerJoin(roomId, 'peer-d')
    await vi.waitFor(() =>
      expect(
        fake.sendAttempts.filter(({ roomId: sentRoomId, payload }) => {
          if (sentRoomId !== roomId) return false
          const message = JSON.parse(payload) as ChatRoomMessage
          return message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
        })
      ).toHaveLength(6)
    )
    const all = fake.sendAttempts.filter(({ roomId: sentRoomId }) => sentRoomId === roomId)
    expect(all.filter(({ rawTarget }) => JSON.stringify(rawTarget) === JSON.stringify(['peer-b']))).toHaveLength(2)
    expect(all.filter(({ rawTarget }) => JSON.stringify(rawTarget) === JSON.stringify(['peer-c']))).toHaveLength(2)
    expect(all.filter(({ rawTarget }) => JSON.stringify(rawTarget) === JSON.stringify(['peer-d']))).toHaveLength(2)
    expect(all.some(({ rawTarget }) => rawTarget === undefined)).toBe(false)
    disposeServer(server)
  })

  it('republishes the World snapshot natively as soon as the room recovers', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock: new FakeClock(), codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    const baseline = fake.sendAttempts.length

    fake.roomClose(getWorldRoomId())
    await vi.waitFor(() => expect(fake.sendAttempts).toHaveLength(baseline + 1))
    expect(fake.sendAttempts.at(-1)?.to).toEqual([])
    disposeServer(server)
  })

  it('one clean refresh converges the stale member count from the ended-observation state', async () => {
    vi.useFakeTimers()
    try {
      const { clock, fake, server, roomId } = await setup()
      const remoteUsers = [
        { id: 'user-1', name: 'User 1', avatar: '' },
        { id: 'user-2', name: 'User 2', avatar: '' },
        { id: 'user-3', name: 'User 3', avatar: '' }
      ]
      const memberCount = async () => {
        const domain = (await readServerSnapshot(server)).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      const announce = (peerId: string, user: { id: string; name: string; avatar: string }, sessionId: string) => {
        fake.peerJoin(roomId, peerId)
        fake.receive(roomId, peerId, { ...session(user), sessionId })
      }
      remoteUsers.forEach((user, index) => announce(`peer-${index + 1}`, user, `session-${user.id}`))
      await settle()
      expect(await memberCount()).toBe(4)

      // Remote-1 leaves; its pending leave expires into an ended observer, so the room shows three.
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(3)

      // One AppButton-equivalent refresh STARTING FROM THE STALE THREE state must converge to four
      // after the remotes re-announce through the canonical join (fail-before: the ended observer
      // survives the released reconnect, so the count remains three).
      await server.reconnectDomain({ domain: DOMAIN })
      await settle()
      remoteUsers.forEach((user, index) => {
        const peerId = `peer-${index + 1}`
        fake.peerJoin(roomId, peerId)
        fake.receive(roomId, peerId, { ...session(user), sessionId: `session-${user.id}-fresh` })
      })
      await settle()
      expect(await memberCount()).toBe(4)

      // Complete release/reopen is the independent control that reaches four on released code.
      await removeServerTab(server, 1)
      clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
      await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await settle()
      remoteUsers.forEach((user, index) =>
        fake.receive(roomId, `peer-${index + 1}`, { ...session(user), sessionId: `session-${user.id}-reopen` })
      )
      await settle()
      expect(await memberCount()).toBe(4)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful same-presence rebind and rejects stale replays, mutations, departed sources, and newer conflicts', async () => {
    vi.useFakeTimers()
    try {
      const { fake, server, roomId } = await setup()
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const user2 = { id: 'user-2', name: 'User 2', avatar: '' }
      const memberCount = async () => {
        const domain = (await readServerSnapshot(server)).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      const announce = (peerId: string, user: { id: string; name: string; avatar: string }, sessionId: string) => {
        fake.peerJoin(roomId, peerId)
        fake.receive(roomId, peerId, { ...session(user), sessionId })
      }
      announce('peer-1', user1, 'session-user-1')
      announce('peer-2', user2, 'session-user-2')
      await settle()
      expect(await memberCount()).toBe(3)

      // Remote-1 leaves and its pending leave expires into an ended observer.
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(2)

      // The lawful rebind: the source re-joins (admitted), sends a NEW physical sessionId with
      // the exact accepted logical identity/time, and the ended observation is corrected.
      announce('peer-1', user1, 'session-user-1-rejoined')
      await settle()
      expect(await memberCount()).toBe(3)

      // Remote-2 leaves and its pending leave expires into an ended observer.
      fake.peerLeave(roomId, 'peer-2')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(2)

      // Even from a CURRENTLY ADMITTED source, an exact replay of the ended physical sessionId is
      // rejected (the source re-joins, but the physical generation is the ended one).
      announce('peer-2', user2, 'session-user-2')
      await settle()
      expect(await memberCount()).toBe(2)

      // An identity/time mutation of the ended presence is rejected from the same admitted source.
      fake.receive(roomId, 'peer-2', {
        ...session(user2),
        sessionId: 'session-user-2-mutated',
        user: { id: 'user-X', name: 'Impostor', avatar: '' }
      })
      await settle()
      expect(await memberCount()).toBe(2)

      // A SESSION from the source AFTER it leaves again (no fresh PeerJoin) cannot re-activate
      // the ended presence: the source is not a currently admitted physical member.
      fake.peerLeave(roomId, 'peer-2')
      fake.receive(roomId, 'peer-2', { ...session(user2), sessionId: 'session-user-2-departed' })
      await settle()
      expect(await memberCount()).toBe(2)

      // A NEWER logical generation for the same user becomes active (a different presence with a
      // strictly later joinedAt).
      fake.peerJoin(roomId, 'peer-2b')
      fake.receive(roomId, 'peer-2b', {
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-user-2-new',
        presenceId: 'presence-user-2-new',
        joinedAt: NOW + 2,
        user: user2
      })
      await settle()
      expect(await memberCount()).toBe(3)

      // The ended OLD generation may not resurrect once a newer active binding exists.
      fake.receive(roomId, 'peer-2b', { ...session(user2), sessionId: 'session-user-2-old-new' })
      await settle()
      expect(await memberCount()).toBe(3)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful rebind through automatic recovery', async () => {
    vi.useFakeTimers()
    try {
      const { fake, server, roomId } = await setup()
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const memberCount = async () => {
        const domain = (await readServerSnapshot(server)).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(1)
      // The room closes and the runtime automatically recovers (rejoins); the recovered member
      // re-joins (a fresh PeerJoin admits it again), announces its current SESSION, and the
      // ended observation is corrected through the shared classifier.
      fake.roomClose(roomId)
      await settle()
      expect(fake.joined.has(roomId)).toBe(true)
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-recovered' })
      await settle()
      expect(await memberCount()).toBe(2)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful rebind after a same-domain page attach', async () => {
    vi.useFakeTimers()
    try {
      const { fake, server, roomId } = await setup()
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const memberCount = async () => {
        const domain = (await readServerSnapshot(server)).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(1)
      // A second page attaches to the same domain; the connection ledger is untouched and the
      // lawful rebind is accepted through the shared classifier.
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })
      await settle()
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-attach' })
      await settle()
      expect(await memberCount()).toBe(2)
      expect((await readServerSnapshot(server)).domains[0].tabIds).toContain(2)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful rebind after page reattach', async () => {
    vi.useFakeTimers()
    try {
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const { clock, fake, server, roomId } = await setup()
      const memberCount = async () => {
        const domain = (await readServerSnapshot(server)).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(1)
      // The page detaches and attaches again immediately; the domain ledger (including the ended
      // observation) survives, and the lawful rebind is accepted.
      await removeServerTab(server, 1)
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await settle()
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-reattach' })
      await settle()
      expect(await memberCount()).toBe(2)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful rebind through a grace return', async () => {
    vi.useFakeTimers()
    try {
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const { clock, fake, server, roomId } = await setup()
      const memberCount = async () => {
        const domain = (await readServerSnapshot(server)).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(1)
      // The page returns near the end of the grace window; the ledger survives and the lawful
      // rebind is accepted.
      await removeServerTab(server, 1)
      clock.advance(RUNTIME_DOMAIN_GRACE_MS - 1)
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await settle()
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-grace-return' })
      await settle()
      expect(await memberCount()).toBe(2)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('host recovery reuses a persisted ended tombstone and still requires the lawful rebind', async () => {
    vi.useFakeTimers()
    try {
      const values: Record<string, unknown> = {}
      const presenceStore = createBrowserPresenceStore({
        get: async (key) => ({ [key]: values[key] }),
        set: async (items) => {
          Object.assign(values, items)
        }
      })
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const memberCount = async (server: Awaited<ReturnType<typeof setup>>['server']) => {
        const domain = (await readServerSnapshot(server)).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }

      // First host: the member's presence ends and its observer tombstone is persisted.
      const firstClock = new FakeClock()
      const firstFake = createFakeTransport()
      const first = createServer({ transport: firstFake.transport, clock: firstClock, codec: jsonCodec, presenceStore })
      const firstRoomId = getChatRoomId(DOMAIN)
      await first.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await first.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await settle()
      firstFake.peerJoin(firstRoomId, 'peer-1')
      firstFake.receive(firstRoomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      firstFake.peerLeave(firstRoomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount(first)).toBe(1)
      disposeServer(first)

      // Host replacement: a fresh Runtime hydrates the persisted record, including the ended
      // tombstone; the strict classifier still rejects the exact replay and accepts only the
      // lawful rebind (admitted source, new physical sessionId, exact logical identity).
      const secondClock = new FakeClock()
      const secondFake = createFakeTransport()
      const second = createServer({
        transport: secondFake.transport,
        clock: secondClock,
        codec: jsonCodec,
        presenceStore
      })
      const secondRoomId = getChatRoomId(DOMAIN)
      await second.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await second.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await settle()
      secondFake.peerJoin(secondRoomId, 'peer-1')
      secondFake.receive(secondRoomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      expect(await memberCount(second)).toBe(1)
      secondFake.receive(secondRoomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-host' })
      await settle()
      expect(await memberCount(second)).toBe(2)
      disposeServer(second)
    } finally {
      vi.useRealTimers()
    }
  })

  it('joins an in-flight dual replacement so a concurrent refresh cannot expose a partial owner', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    fake.makeNotReady()

    const refreshA = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    await vi.waitFor(() =>
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    )
    let refreshBSettled = false
    const refreshB = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) }).then(() => {
      refreshBSettled = true
    })
    let readSettled = false
    const read = server.getSnapshot(callerOf(1)).then((snapshot) => {
      readSettled = true
      return snapshot
    })

    await settle()
    expect(refreshBSettled).toBe(false)
    expect(readSettled).toBe(false)
    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)

    fake.open()
    await Promise.all([refreshA, refreshB])
    const snapshot = await read
    expect(snapshot.domains.find((item) => item.domain === DOMAIN)?.chatRoomJoined).toBe(true)
    expect(snapshot.world.joined).toBe(true)
    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    disposeServer(server)
  })

  it("does not let an older pending replacement block the newer World epoch's stable read", async () => {
    const fake = createFakeTransport()
    const roomId = getChatRoomId(DOMAIN)
    const blockedRetireStarted = deferred<void>()
    const releaseBlockedRetire = deferred<void>()
    let blockFirstDomainRetire = false
    const transport: RoomTransport = {
      ...fake.transport,
      retireRoomsForPreparation: async (roomIds) => {
        if (blockFirstDomainRetire && roomIds.includes(roomId)) {
          blockedRetireStarted.resolve()
          await releaseBlockedRetire.promise
        }
        await fake.transport.retireRoomsForPreparation(roomIds)
      }
    }
    const server = createServer({ transport, codec: jsonCodec })
    await attachTab(server, DOMAIN, 1)
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
    await attachTab(server, OTHER_DOMAIN, 2)
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { ...SITE, origin: OTHER_DOMAIN },
      ...callerOf(2, OTHER_DOMAIN)
    })

    blockFirstDomainRetire = true
    const olderRefresh = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    await blockedRetireStarted.promise
    let olderReadSettled = false
    let olderReadError: unknown
    const olderRead = server.getSnapshot(callerOf(1)).then(
      () => {
        olderReadSettled = true
      },
      (error: unknown) => {
        olderReadSettled = true
        olderReadError = error
      }
    )
    await settle()
    expect(olderReadSettled).toBe(false)

    try {
      // B owns the newer shared World epoch while A remains before its first physical retire.
      await expect(
        server.reconnectDomain({ domain: OTHER_DOMAIN, ...callerOf(2, OTHER_DOMAIN) })
      ).resolves.toBeUndefined()

      let newerReadSettled = false
      let newerReadError: unknown
      const newerRead = server.getSnapshot(callerOf(2, OTHER_DOMAIN)).then(
        (snapshot) => {
          newerReadSettled = true
          return snapshot
        },
        (error: unknown) => {
          newerReadSettled = true
          newerReadError = error
          return undefined
        }
      )
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
      const newerReadSettledBeforeOlderRelease = newerReadSettled
      const newerReadErrorBeforeOlderRelease = newerReadError

      blockFirstDomainRetire = false
      releaseBlockedRetire.resolve()
      await expect(olderRefresh).rejects.toMatchObject({ name: 'AbortError' })
      await olderRead
      expect(olderReadError).toMatchObject({ name: 'AbortError' })
      const snapshot = await newerRead

      expect(newerReadSettledBeforeOlderRelease).toBe(true)
      expect(newerReadErrorBeforeOlderRelease).toBeUndefined()
      expect(newerReadError).toBeUndefined()
      expect(snapshot).toBeDefined()
      expect(domainSnapshot(snapshot!, OTHER_DOMAIN)).toMatchObject({ chatRoomJoined: true })
      expect(snapshot!.world.joined).toBe(true)

      // Only A's next explicit click clears its own cancelled fence. B remains a current owner.
      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
      expect(domainSnapshot(await server.getSnapshot(callerOf(1)))).toMatchObject({ chatRoomJoined: true })
      expect(domainSnapshot(await server.getSnapshot(callerOf(2, OTHER_DOMAIN)), OTHER_DOMAIN)).toMatchObject({
        chatRoomJoined: true
      })
    } finally {
      blockFirstDomainRetire = false
      releaseBlockedRetire.resolve()
      await olderRefresh.catch(() => undefined)
      await olderRead
      disposeServer(server)
    }
  })

  it('keeps a late World terminal distinct from an unrelated ROOM success', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, codec: jsonCodec })
    await attachTab(server, DOMAIN, 1)
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
    await attachTab(server, OTHER_DOMAIN, 2)
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { ...SITE, origin: OTHER_DOMAIN },
      ...callerOf(2, OTHER_DOMAIN)
    })

    const releaseIngress = fake.holdIngressActivation()
    const joinsBeforeOlderWorld = fake.joinCalls.length
    const olderWorld = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    await fake.waitForJoinCalls(joinsBeforeOlderWorld + 2)

    // B has no relationship to A's manual epoch. Its ROOM ownership must not be turned into
    // either a stale success for A or A's later World terminal.
    let newerRoomSettled = false
    const newerRoom = server
      .joinChatRoom({
        domain: OTHER_DOMAIN,
        user: USER,
        site: { ...SITE, origin: OTHER_DOMAIN },
        ...callerOf(2, OTHER_DOMAIN)
      })
      .then((snapshot) => {
        newerRoomSettled = true
        return snapshot
      })
    await settle()
    expect(newerRoomSettled).toBe(true)

    const originalWorldError = new Error('older World activation failed')
    fake.failNextIngressActivation(originalWorldError)
    releaseIngress()

    await expect(olderWorld).rejects.toBe(originalWorldError)
    const newerSnapshot = await newerRoom
    expect(newerSnapshot?.domains.find((item) => item.domain === OTHER_DOMAIN)).toMatchObject({ chatRoomJoined: true })
    expect((await readServerSnapshot(server)).domains.find((item) => item.domain === OTHER_DOMAIN)).toMatchObject({
      chatRoomJoined: true
    })
    disposeServer(server)
  })

  it('returns the original World error after ROOM preparation succeeds', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await attachTab(server, DOMAIN, 1)
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
    const roomPhysicalJoins = fake.physicalJoinCalls.filter((id) => id === roomId).length

    const releaseIngress = fake.holdIngressActivation()
    const joinsBeforeRefresh = fake.joinCalls.length
    const refresh = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    await fake.waitForJoinCalls(joinsBeforeRefresh + 2)
    const originalWorldError = new Error('World precommit failed after ROOM success')
    fake.failReplacementAt('world-precommit', originalWorldError)
    releaseIngress()

    await expect(refresh).rejects.toBe(originalWorldError)
    expect(fake.operationLog.filter((entry) => entry.startsWith('retire:'))).toEqual([
      `retire:${worldRoomId},${roomId}`,
      `retire:${worldRoomId},${roomId}`
    ])
    expect(fake.physicalJoinCalls.filter((id) => id === roomId)).toHaveLength(roomPhysicalJoins + 1)
    await expect(server.getSnapshot(callerOf(1))).rejects.toBe(originalWorldError)
    disposeServer(server)
  })

  it('keeps mixed domain replacement failures fenced to their own next explicit click', async () => {
    const fake = createFakeTransport()
    const roomId = getChatRoomId(DOMAIN)
    const blockedRetireStarted = deferred<void>()
    const releaseBlockedRetire = deferred<void>()
    let blockDomainRetire = false
    const transport: RoomTransport = {
      ...fake.transport,
      retireRoomsForPreparation: async (roomIds) => {
        if (blockDomainRetire && roomIds.includes(roomId)) {
          blockedRetireStarted.resolve()
          await releaseBlockedRetire.promise
        }
        await fake.transport.retireRoomsForPreparation(roomIds)
      }
    }
    const server = createServer({ transport, codec: jsonCodec })
    await attachTab(server, DOMAIN, 1)
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
    await attachTab(server, OTHER_DOMAIN, 2)
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { ...SITE, origin: OTHER_DOMAIN },
      ...callerOf(2, OTHER_DOMAIN)
    })

    blockDomainRetire = true
    const olderDomain = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    await blockedRetireStarted.promise

    const otherWorldError = new Error('OTHER_DOMAIN World precommit failed')
    fake.failReplacementAt('world-precommit', otherWorldError)
    try {
      await expect(server.reconnectDomain({ domain: OTHER_DOMAIN, ...callerOf(2, OTHER_DOMAIN) })).rejects.toBe(
        otherWorldError
      )

      blockDomainRetire = false
      releaseBlockedRetire.resolve()
      await expect(olderDomain).rejects.toMatchObject({ name: 'AbortError' })
      await expect(server.getSnapshot(callerOf(1))).rejects.toMatchObject({ name: 'AbortError' })
      await expect(server.getSnapshot(callerOf(2, OTHER_DOMAIN))).rejects.toBe(otherWorldError)

      // B's retry clears only B's own fence; A's stale epoch remains rejected until A clicks again.
      await expect(
        server.reconnectDomain({ domain: OTHER_DOMAIN, ...callerOf(2, OTHER_DOMAIN) })
      ).resolves.toBeUndefined()
      await expect(server.getSnapshot(callerOf(2, OTHER_DOMAIN))).resolves.toMatchObject({ world: { joined: true } })
      await expect(server.getSnapshot(callerOf(1))).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      blockDomainRetire = false
      releaseBlockedRetire.resolve()
      await olderDomain.catch(() => undefined)
      disposeServer(server)
    }
  })

  it('lets another active domain recover the full shared World intent after a post-cut failure', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, codec: jsonCodec })
    try {
      await attachTab(server, DOMAIN, 1)
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
      await attachTab(server, OTHER_DOMAIN, 2)
      await server.joinChatRoom({
        domain: OTHER_DOMAIN,
        user: USER,
        site: { ...SITE, origin: OTHER_DOMAIN },
        ...callerOf(2, OTHER_DOMAIN)
      })
      const failure = new Error('A World precommit failed after the shared cut')
      fake.failReplacementAt('world-precommit', failure)

      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toBe(failure)
      await expect(server.getSnapshot(callerOf(1))).rejects.toBe(failure)

      await expect(
        server.reconnectDomain({ domain: OTHER_DOMAIN, ...callerOf(2, OTHER_DOMAIN) })
      ).resolves.toBeUndefined()
      const snapshot = await server.getSnapshot(callerOf(2, OTHER_DOMAIN))
      expect(snapshot.world.joined).toBe(true)
      expect(snapshot.world.localPresence?.sites.map((site) => site.origin)).toEqual(
        expect.arrayContaining([DOMAIN, OTHER_DOMAIN])
      )
    } finally {
      disposeServer(server)
    }
  })

  it('preserves a failed participant retry seed through another domain shared World recovery', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    try {
      await attachTab(server, DOMAIN, 1)
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
      await attachTab(server, OTHER_DOMAIN, 2)
      await server.joinChatRoom({
        domain: OTHER_DOMAIN,
        user: USER,
        site: { ...SITE, origin: OTHER_DOMAIN },
        ...callerOf(2, OTHER_DOMAIN)
      })
      fake.peerJoin(roomId, 'remote-room-peer')
      fake.receive(roomId, 'remote-room-peer', session())
      emitRemoteWorldPresence(fake, 'remote-world-peer')
      await settle()
      expect(domainSnapshot(await readServerSnapshot(server))?.sessions).toHaveLength(1)
      expect((await readServerSnapshot(server)).world.presences).toHaveLength(1)

      const failure = new Error('A World precommit failed after the shared cut')
      fake.failReplacementAt('world-precommit', failure)
      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toBe(failure)

      await expect(
        server.reconnectDomain({ domain: OTHER_DOMAIN, ...callerOf(2, OTHER_DOMAIN) })
      ).resolves.toBeUndefined()
      const afterOtherRecovery = await readServerSnapshot(server)
      expect(domainSnapshot(afterOtherRecovery)).toMatchObject({
        chatRoomJoined: false,
        localSession: undefined,
        sessions: []
      })
      expect(domainSnapshot(afterOtherRecovery, OTHER_DOMAIN)).toMatchObject({ chatRoomJoined: true })
      expect(afterOtherRecovery.world.localPresence?.sites.map((site) => site.origin)).toEqual([DOMAIN, OTHER_DOMAIN])
      expect(afterOtherRecovery.world.presences).toEqual([])

      const retiresBeforeWrongDocument = fake.operationLog.filter(
        (entry) => entry === `retire:${worldRoomId},${roomId}`
      ).length
      await expect(
        server.reconnectDomain({
          domain: DOMAIN,
          caller: { tab: { id: 1, url: `${DOMAIN}/other-document` } }
        })
      ).rejects.toThrow('Dual replacement retry seed does not match this caller binding')
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(
        retiresBeforeWrongDocument
      )

      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
      const retried = await readServerSnapshot(server)
      expect(domainSnapshot(retried)).toMatchObject({
        chatRoomJoined: true,
        localSession: expect.any(Object),
        sessions: []
      })
      expect(retried.world.localPresence?.sites.map((site) => site.origin)).toEqual([DOMAIN, OTHER_DOMAIN])
      expect(retried.world.presences).toEqual([])
    } finally {
      disposeServer(server)
    }
  })

  it('consumes a participant seed only after its same-document retry through shared World recovery', async () => {
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    try {
      await attachTab(server, DOMAIN, 1)
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
      await attachTab(server, OTHER_DOMAIN, 2)
      await server.joinChatRoom({
        domain: OTHER_DOMAIN,
        user: USER,
        site: { ...SITE, origin: OTHER_DOMAIN },
        ...callerOf(2, OTHER_DOMAIN)
      })
      fake.peerJoin(roomId, 'remote-room-peer')
      fake.receive(roomId, 'remote-room-peer', session())
      emitRemoteWorldPresence(fake, 'remote-world-peer')
      await settle()

      const failure = new Error('A World precommit failed after the shared cut')
      fake.failReplacementAt('world-precommit', failure)
      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toBe(failure)

      await expect(
        server.reconnectDomain({ domain: OTHER_DOMAIN, ...callerOf(2, OTHER_DOMAIN) })
      ).resolves.toBeUndefined()
      const afterOtherRecovery = await readServerSnapshot(server)
      expect(domainSnapshot(afterOtherRecovery)).toMatchObject({
        chatRoomJoined: false,
        localSession: undefined,
        sessions: []
      })
      expect(domainSnapshot(afterOtherRecovery, OTHER_DOMAIN)).toMatchObject({ chatRoomJoined: true, sessions: [] })
      expect(afterOtherRecovery.world.localPresence?.sites.map((site) => site.origin)).toEqual([DOMAIN, OTHER_DOMAIN])
      expect(afterOtherRecovery.world.presences).toEqual([])

      const retiresBeforeWrongDocument = fake.operationLog.filter(
        (entry) => entry === `retire:${worldRoomId},${roomId}`
      ).length
      await expect(
        server.reconnectDomain({
          domain: DOMAIN,
          caller: { tab: { id: 1, url: `${DOMAIN}/other-document` } }
        })
      ).rejects.toThrow('Dual replacement retry seed does not match this caller binding')
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(
        retiresBeforeWrongDocument
      )

      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
      const afterSameDocumentRetry = await readServerSnapshot(server)
      expect(domainSnapshot(afterSameDocumentRetry)).toMatchObject({
        chatRoomJoined: true,
        localSession: expect.any(Object),
        sessions: []
      })
      expect(domainSnapshot(afterSameDocumentRetry, OTHER_DOMAIN)).toMatchObject({ chatRoomJoined: true, sessions: [] })
      expect(afterSameDocumentRetry.world.localPresence?.sites.map((site) => site.origin)).toEqual([
        DOMAIN,
        OTHER_DOMAIN
      ])
      expect(afterSameDocumentRetry.world.presences).toEqual([])

      const retiresBeforeFreshDocument = fake.operationLog.filter(
        (entry) => entry === `retire:${worldRoomId},${roomId}`
      ).length
      await expect(
        server.reconnectDomain({
          domain: DOMAIN,
          caller: { tab: { id: 1, url: `${DOMAIN}/fresh-after-retry` } }
        })
      ).resolves.toBeUndefined()
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(
        retiresBeforeFreshDocument + 1
      )
      const afterFreshDocumentRetry = await readServerSnapshot(server)
      expect(domainSnapshot(afterFreshDocumentRetry)).toMatchObject({
        chatRoomJoined: true,
        localSession: expect.any(Object),
        sessions: []
      })
      expect(domainSnapshot(afterFreshDocumentRetry, OTHER_DOMAIN)).toMatchObject({
        chatRoomJoined: true,
        sessions: []
      })
      expect(afterFreshDocumentRetry.world.localPresence?.sites.map((site) => site.origin)).toEqual([
        DOMAIN,
        OTHER_DOMAIN
      ])
      expect(afterFreshDocumentRetry.world.presences).toEqual([])
    } finally {
      disposeServer(server)
    }
  })

  it('joins an in-flight replacement attempt instead of running a second destructive reset', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const initialJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    fake.open()
    await initialJoin
    await settle()

    // A's refresh: the destruction settles, then the replacement attempt's physical Chat join is
    // held (phase 2 in flight).
    fake.makeNotReady()
    const refreshA = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)

    // B refreshes while A's replacement attempt is pending: it must join A's whole operation,
    // not run a second destructive reset against the in-flight prepared session.
    let bSettled = false
    const refreshB = server.reconnectDomain({ domain: DOMAIN }).then(() => {
      bSettled = true
    })
    await settle()
    expect(bSettled).toBe(false)
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(false)

    fake.open()
    await Promise.all([refreshA, refreshB])
    await settle()
    // A's prepared session survived (no second reset), and the domain converged to one committed
    // replacement shared by both refreshes.
    expect(bSettled).toBe(true)
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(true)
    expect(fake.physicalJoinCalls.filter((id) => id === getChatRoomId(DOMAIN))).toHaveLength(2)
    disposeServer(server)
  })

  it('does not use reset persistence while an AppButton performs the dual replacement', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let rejectClearSave = false
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as { local?: { status?: string }; observers?: unknown[] }
        // The refresh reset persists the cleared-observer record (retained local seed, no remote
        // observations); a healthy join's commit save carries the same shape, so only reject once
        // the test arms the failure after the initial join settled.
        if (
          rejectClearSave &&
          record &&
          typeof record === 'object' &&
          record.local?.status === 'active' &&
          (record.observers ?? []).length === 0
        ) {
          throw new Error('clear save rejected')
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(true)

    // A manual replacement retains only its local ROOM/World intent and must not route through
    // the legacy destructive reset persistence path.
    rejectClearSave = true
    await expect(server.reconnectDomain({ domain: DOMAIN })).resolves.toBeUndefined()
    await settle()
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(true)
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    disposeServer(server)
  })

  it('preserves World, other domains, page lease, and the logical presence across refresh', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const worldRoomId = getWorldRoomId()
    const otherRoomId = getChatRoomId(OTHER_DOMAIN)
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    fake.peerJoin(otherRoomId, 'peer-x')
    fake.receive(otherRoomId, 'peer-x', session({ id: 'user-x', name: 'User X', avatar: '' }))
    await settle()
    emitRemoteWorldPresence(fake)
    await settle()

    const presenceIdBefore = (Object.values(values)[0] as { local: { presenceId: string } }).local.presenceId
    const before = await readServerSnapshot(server)
    const beforeLocal = before.domains.find((item) => item.domain === DOMAIN)!.localSession!
    const beforeOther = before.domains.find((item) => item.domain === OTHER_DOMAIN)!
    const beforeWorld = before.world

    await server.reconnectDomain({ domain: DOMAIN })
    await settle()

    const after = await readServerSnapshot(server)
    const afterLocal = after.domains.find((item) => item.domain === DOMAIN)!.localSession!
    const afterOther = after.domains.find((item) => item.domain === OTHER_DOMAIN)!
    const afterWorld = after.world
    // Physical identity rotates; the active local logical generation is retained.
    expect(afterLocal.sessionId).not.toBe(beforeLocal.sessionId)
    expect(afterLocal.joinedAt).toBe(beforeLocal.joinedAt)
    expect(afterLocal.user).toEqual(beforeLocal.user)
    expect((Object.values(values)[0] as { local: { presenceId: string } }).local.presenceId).toBe(presenceIdBefore)
    // The page lease stays attached.
    expect(after.domains.find((item) => item.domain === DOMAIN)!.tabIds).toContain(1)
    // World is physically replaced stop-before-start while staying joined; active registrations
    // survive and the refreshed domain site re-publishes through the fresh generation.
    expect(fake.operationLog).toContain(`leave:${worldRoomId}`)
    expect(fake.physicalJoinCalls.filter((roomId) => roomId === worldRoomId)).toHaveLength(2)
    expect(fake.joined.has(worldRoomId)).toBe(true)
    expect(afterWorld.joined).toBe(true)
    expect(afterWorld.localPresence?.sites.map((site) => site.origin)).toContain(DOMAIN)
    // The old remote projection loses authority at the replacement; the list rebuilds only from
    // current-generation presence.
    expect(afterWorld.presences).toEqual([])
    emitRemoteWorldPresence(fake)
    await settle()
    expect((await readServerSnapshot(server)).world.presences).toEqual(beforeWorld.presences)
    // The other domain's connection, members, and local session are untouched.
    expect(afterOther.localSession).toEqual(beforeOther.localSession)
    expect(afterOther.sessions.map((item) => item.user.id)).toEqual(['user-x'])
    disposeServer(server)
  })

  it('replaces the World connection alongside the Domain refresh and coalesces overlapping activations', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    emitRemoteWorldPresence(fake)
    await settle()
    const before = await readServerSnapshot(server)
    expect(before.world.joined).toBe(true)
    expect(before.world.presences.map((item) => item.sourcePeerId)).toContain('remote-peer')

    // One accepted activation starts both physical replacements; the overlapping second activation
    // coalesces into the same one (one Domain operation, one World operation).
    const refreshA = server.reconnectDomain({ domain: DOMAIN })
    const refreshB = server.reconnectDomain({ domain: DOMAIN })
    await Promise.all([refreshA, refreshB])
    await settle()

    // Stop-before-start: the old World owner left before its replacement joined (a second physical
    // join is only possible after the leave), and exactly one replacement ran for both activations.
    expect(fake.operationLog.filter((entry) => entry === `leave:${worldRoomId}`)).toHaveLength(1)
    expect(fake.physicalJoinCalls.filter((roomId) => roomId === worldRoomId)).toHaveLength(2)

    const after = await readServerSnapshot(server)
    // Active registrations and the complete local presence survive and re-publish through the
    // fresh generation; the remote projection rebuilds only from current-generation facts.
    expect(after.world.joined).toBe(true)
    expect(after.world.localPresence?.sites.map((site) => site.origin)).toContain(DOMAIN)
    expect(after.world.presences).toEqual([])
    emitRemoteWorldPresence(fake)
    await settle()
    expect((await readServerSnapshot(server)).world.presences.map((item) => item.sourcePeerId)).toContain('remote-peer')

    // A later activation after both children settled starts a distinct new replacement.
    await server.reconnectDomain({ domain: DOMAIN })
    await settle()
    expect(fake.operationLog.filter((entry) => entry === `leave:${worldRoomId}`)).toHaveLength(2)
    expect(fake.physicalJoinCalls.filter((roomId) => roomId === worldRoomId)).toHaveLength(3)
    disposeServer(server)
  })

  it('requires both AppButton replacements to reach a terminal success', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect((await readServerSnapshot(server)).world.joined).toBe(true)

    // A World child failure makes this AppButton invocation fail closed. Neither old owner may
    // remain readable, and no automatic retry can publish a partial replacement.
    fake.failNextJoin(worldRoomId)
    await expect(server.reconnectDomain({ domain: DOMAIN })).rejects.toThrow(`Room "${worldRoomId}" join failed`)
    await settle()
    await expect(server.getSnapshot({ caller: { tab: { id: 1, url: '' } } })).rejects.toThrow(
      `Room "${worldRoomId}" join failed`
    )
    const joinsAfterFailure = fake.physicalJoinCalls.filter((roomId) => roomId === worldRoomId).length
    clock.advance(ROOM_RECOVERY_RETRY_INTERVAL_MS)
    await settle()
    expect(fake.physicalJoinCalls.filter((roomId) => roomId === worldRoomId)).toHaveLength(joinsAfterFailure)
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(false)
    expect((await readServerSnapshot(server)).world.joined).toBe(false)

    // Only a fresh explicit click can consume the local-only retry seed and publish both owners.
    await expect(server.reconnectDomain({ domain: DOMAIN })).resolves.toBeUndefined()
    await settle()
    expect(fake.physicalJoinCalls.filter((roomId) => roomId === worldRoomId)).toHaveLength(joinsAfterFailure + 1)
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(true)
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    disposeServer(server)
  })

  it('resets the application World projection to current-generation facts across a manual replacement', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    emitRemoteWorldPresence(fake)
    await settle()
    const oldWorldPeerId = fake.transport.peerIdOf(worldRoomId)
    expect((await readServerSnapshot(server)).world.presences.map((item) => item.sourcePeerId)).toContain('remote-peer')

    await server.reconnectDomain({ domain: DOMAIN })
    await settle()

    // The projection resets to the replacement generation: the prior remote source AND the prior
    // local World peer id each lose their contribution, so the list rebuilds only from
    // current-generation facts (no stale remote, no duplicated local presence).
    // The prior remote source and prior local World peer id each lose their contribution.
    const projectedSources = (await readServerSnapshot(server)).world.presences.map((item) => item.sourcePeerId)
    expect(projectedSources).not.toContain('remote-peer')
    expect(projectedSources).not.toContain(oldWorldPeerId)
    expect((await readServerSnapshot(server)).world.presences).toEqual([])
    // The fresh local presence is committed under the replacement generation.
    expect((await readServerSnapshot(server)).world.localPresence?.user).toEqual(USER)
    // A current-generation re-publication rebuilds the remote projection; a never-republishing
    // remote stays absent.
    emitRemoteWorldPresence(fake)
    await settle()
    expect((await readServerSnapshot(server)).world.presences.map((item) => item.sourcePeerId)).toContain('remote-peer')
    disposeServer(server)
  })

  it('fails the AppButton operation closed when its World replacement cannot complete', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    // A genuine World replacement failure does not publish a partial ROOM-success result. It
    // remains UI-silent and diagnostic-visible, while the AppButton operation rejects rather
    // than letting DocumentClient pull a half-replaced projection.
    fake.failNextJoin(worldRoomId)
    await expect(server.reconnectDomain({ domain: DOMAIN })).rejects.toThrow(`Room "${worldRoomId}" join failed`)
    await settle()
    await expect(server.getSnapshot({ caller: { tab: { id: 1, url: '' } } })).rejects.toThrow(
      `Room "${worldRoomId}" join failed`
    )
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(false)
    expect((await readServerSnapshot(server)).world.joined).toBe(false)
    expect(diagnostic).not.toHaveBeenCalled()

    // A subsequent explicit AppButton replacement owns fresh ROOM and World terminals; only its
    // success clears the old failure fence and makes stable current-state reads available again.
    await expect(server.reconnectDomain({ domain: DOMAIN })).resolves.toBeUndefined()
    await expect(server.getSnapshot({ caller: { tab: { id: 1, url: '' } } })).resolves.toMatchObject({
      world: { joined: true }
    })
    diagnostic.mockRestore()
    disposeServer(server)
  })

  it('keeps manual World physical-leave failure console-only while Domain settles', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    const failure = new Error('manual World leave failed')
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    fake.failNextLeave(worldRoomId, failure)

    await expect(server.reconnectDomain({ domain: DOMAIN })).resolves.toBeUndefined()
    await settle()

    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ chatRoomJoined: true })
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    expect((await readServerSnapshot(server)).failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: failure.message })])
    )
    expect(diagnostic).not.toHaveBeenCalled()
    diagnostic.mockRestore()
    disposeServer(server)
  })

  it('supersedes another Domain provisional join before the manual dual replacement commits', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect((await readServerSnapshot(server)).world.joined).toBe(true)

    // The other Domain's combined Chat+World join pends provisionally with the current World
    // generation captured in its join fence.
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    fake.makeNotReady()
    const otherJoin = server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } }).then(
      () => ({ kind: 'joined' as const }),
      (error: Error) => ({ kind: 'failed' as const, error })
    )
    await vi.waitFor(() => expect(fake.joinCalls).toContain(getChatRoomId(OTHER_DOMAIN)))

    // The dual cut wins the shared physical World generation. The old provisional owner must
    // fail rather than continue toward a mixed publish; a fresh normal join may run afterward.
    const refresh = server.reconnectDomain({ domain: DOMAIN }).then(
      () => ({ kind: 'committed' as const }),
      (error: Error) => ({ kind: 'failed' as const, error })
    )
    await settle()
    expect(fake.operationLog.filter((entry) => entry === `leave:${worldRoomId}`)).toHaveLength(1)

    fake.open()
    const [refreshResult, otherResult] = await Promise.all([refresh, otherJoin])
    await settle()
    expect(refreshResult).toEqual({ kind: 'committed' })
    expect(otherResult).toMatchObject({ kind: 'failed', error: expect.any(Error) })
    const after = await readServerSnapshot(server)
    expect(after.domains.some((item) => item.domain === OTHER_DOMAIN && item.chatRoomJoined)).toBe(false)
    expect(fake.operationLog).toContain(`leave:${worldRoomId}`)
    expect(after.world.joined).toBe(true)

    const retriedOther = await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { origin: OTHER_DOMAIN }
    })
    expect(retriedOther?.domains.some((item) => item.domain === OTHER_DOMAIN && item.chatRoomJoined)).toBe(true)
    disposeServer(server)
  })

  it('fences held old World send ownership across a manual replacement', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()

    // A peer-join publication send is invoked and held at the wire.
    fake.hangSendsTo(worldRoomId)
    fake.peerJoin(worldRoomId, 'remote-peer')
    await vi.waitFor(() => expect(fake.sent.length).toBeGreaterThan(0))

    // The manual replacement strips the old send's ownership; its late settlement completes
    // nothing in the fresh generation and produces no error, and the fresh generation works.
    const refresh = server.reconnectDomain({ domain: DOMAIN })
    fake.releaseSends()
    await refresh
    await settle()
    expect((await readServerSnapshot(server)).failures).toEqual([])
    const after = await readServerSnapshot(server)
    expect(after.world.joined).toBe(true)
    expect(after.world.localPresence?.sites.map((site) => site.origin)).toContain(DOMAIN)
    disposeServer(server)
  })

  it('waits for another Domain release once before recapturing the manual World replacement', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let holdOtherCleanup = false
    const otherCleanupStarted = deferred<void>()
    const releaseOtherCleanup = deferred<void>()
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as
          | { domain?: string; local?: unknown; observers?: unknown[] }
          | undefined
        if (
          holdOtherCleanup &&
          record?.domain === OTHER_DOMAIN &&
          !record.local &&
          Array.isArray(record.observers) &&
          record.observers.length === 0
        ) {
          otherCleanupStarted.resolve()
          await releaseOtherCleanup.promise
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    expect((await readServerSnapshot(server)).world.localPresence?.sites).toHaveLength(2)
    emitRemoteWorldPresence(fake)
    await settle()

    // B starts its ordinary explicit release first and remains held in its existing cleanup
    // owner. A must publish neither a cut nor an intermediate snapshot while it waits.
    holdOtherCleanup = true
    const releaseB = server.leaveChatRoom({ domain: OTHER_DOMAIN })
    await otherCleanupStarted.promise
    let refreshSettled = false
    const refresh = server.reconnectDomain({ domain: DOMAIN })
    void refresh.then(
      () => {
        refreshSettled = true
      },
      () => {}
    )
    await settle()
    let readSettled = false
    const read = server.getSnapshot({ caller: { tab: { id: 1, url: '' } } }).then(() => {
      readSettled = true
    })
    void read.catch(() => {})
    await settle()
    expect(refreshSettled).toBe(false)
    expect(readSettled).toBe(false)
    expect(
      fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${getChatRoomId(DOMAIN)}`)
    ).toHaveLength(0)

    releaseOtherCleanup.resolve()
    await Promise.all([refresh, releaseB, read])
    await settle()

    const after = await readServerSnapshot(server)
    expect(after.domains.some((item) => item.domain === DOMAIN && item.chatRoomJoined)).toBe(true)
    // B's ordinary release settled exactly once; A then recaptured current local intent and its
    // fresh World contains no departed B registration.
    expect(after.domains.some((item) => item.domain === OTHER_DOMAIN && item.chatRoomJoined)).toBe(false)
    expect(after.domains.find((item) => item.domain === OTHER_DOMAIN)?.localSession).toBeUndefined()
    expect(after.world.joined).toBe(true)
    expect(after.world.localPresence?.sites.map((site) => site.origin)).toEqual([DOMAIN])
    expect(fake.operationLog.filter((entry) => entry === `leave:${getChatRoomId(OTHER_DOMAIN)}`)).toHaveLength(1)
    expect(
      fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${getChatRoomId(DOMAIN)}`)
    ).toHaveLength(1)
    disposeServer(server)
  })

  it('does not reuse an A+B retry seed after B finishes its explicit release', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let holdOtherCleanup = false
    const otherCleanupStarted = deferred<void>()
    const releaseOtherCleanup = deferred<void>()
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as
          | { domain?: string; local?: unknown; observers?: unknown[] }
          | undefined
        if (
          holdOtherCleanup &&
          record?.domain === OTHER_DOMAIN &&
          !record.local &&
          Array.isArray(record.observers) &&
          record.observers.length === 0
        ) {
          otherCleanupStarted.resolve()
          await releaseOtherCleanup.promise
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()

    // A pre-cut retire failure creates the normal local-only retry seed while A+B current state
    // remains intact. That seed therefore contains an old B World registration.
    const retireError = new Error('first dual retire rejected')
    fake.failNextRetire(retireError)
    await expect(server.reconnectDomain({ domain: DOMAIN })).rejects.toBe(retireError)
    expect((await readServerSnapshot(server)).world.localPresence?.sites.map((site) => site.origin).toSorted()).toEqual(
      [DOMAIN, OTHER_DOMAIN]
    )

    holdOtherCleanup = true
    const releaseB = server.leaveChatRoom({ domain: OTHER_DOMAIN })
    await otherCleanupStarted.promise
    const refresh = server.reconnectDomain({ domain: DOMAIN })
    releaseOtherCleanup.resolve()
    await Promise.all([releaseB, refresh])
    await settle()

    expect((await readServerSnapshot(server)).world.localPresence?.sites.map((site) => site.origin)).toEqual([DOMAIN])
    expect(
      fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${getChatRoomId(DOMAIN)}`)
    ).toHaveLength(2)
    disposeServer(server)
  })

  it('clears a pre-release retry seed before a post-barrier failure permits a fresh document retry', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let holdOtherCleanup = false
    const otherCleanupStarted = deferred<void>()
    const releaseOtherCleanup = deferred<void>()
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as
          | { domain?: string; local?: unknown; observers?: unknown[] }
          | undefined
        if (
          holdOtherCleanup &&
          record?.domain === OTHER_DOMAIN &&
          !record.local &&
          Array.isArray(record.observers) &&
          record.observers.length === 0
        ) {
          otherCleanupStarted.resolve()
          await releaseOtherCleanup.promise
        }
        Object.assign(values, items)
      }
    })
    const tabs = new Map<number, { id: number; url: string }>([
      [1, { id: 1, url: `${DOMAIN}/topic` }],
      [2, { id: 2, url: `${OTHER_DOMAIN}/topic` }]
    ])
    let ensureCalls = 0
    let failEnsureCall = -1
    const postBarrierFailure = new Error('post-release caller revalidation failed')
    const admission = {
      tabs: {
        get: async (tabId: number) => {
          const tab = tabs.get(tabId)
          if (!tab) throw new Error('tab missing')
          return tab
        },
        query: async () => [...tabs.values()],
        sendMessage: async () => undefined
      },
      ensureTransport: async () => {
        ensureCalls += 1
        if (ensureCalls === failEnsureCall) throw postBarrierFailure
      }
    }
    const callerOf = (tabId: number) => ({ caller: { tab: tabs.get(tabId)! } })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore, admission })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, ...callerOf(1) })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
    await server.attachPage({ domain: OTHER_DOMAIN, ...callerOf(2) })
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { origin: OTHER_DOMAIN },
      ...callerOf(2)
    })
    fake.peerJoin(roomId, 'remote-room-peer')
    fake.receive(roomId, 'remote-room-peer', session())
    emitRemoteWorldPresence(fake)
    await settle()

    // A fails before the cut, preserving only its local intent plus the exact caller binding.
    // Its old World intent still includes B, while remote facts stay outside the retry seed.
    const retireFailure = new Error('first dual retire rejected')
    fake.failNextRetire(retireFailure)
    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toBe(retireFailure)
    const beforeRelease = await readServerSnapshot(server)
    expect(beforeRelease.world.localPresence?.sites.map((site) => site.origin).toSorted()).toEqual([
      DOMAIN,
      OTHER_DOMAIN
    ])
    expect(domainSnapshot(beforeRelease)?.sessions).toHaveLength(1)
    expect(beforeRelease.world.presences).toHaveLength(1)

    // B's active release is the barrier. The existing browser-admission hook fails only during
    // A's post-barrier revalidation, before retained-seed lookup, fresh capture, or commit.
    holdOtherCleanup = true
    const releaseB = server.leaveChatRoom({ domain: OTHER_DOMAIN, ...callerOf(2) })
    await otherCleanupStarted.promise
    failEnsureCall = ensureCalls + 2
    const interruptedA = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    void interruptedA.catch(() => {})
    releaseOtherCleanup.resolve()
    await Promise.all([
      expect(releaseB).resolves.toBeUndefined(),
      expect(interruptedA).rejects.toBe(postBarrierFailure)
    ])
    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)

    // With the barrier's early invalidation, a new document is a fresh A click, not an old-seed
    // binding failure. Its new World capture excludes departed B and all old remote facts.
    failEnsureCall = -1
    const differentDocument = { id: 1, url: `${DOMAIN}/different-after-release` }
    tabs.set(1, differentDocument)
    await expect(
      server.reconnectDomain({ domain: DOMAIN, caller: { tab: differentDocument } })
    ).resolves.toBeUndefined()
    const after = await readServerSnapshot(server)
    expect(domainSnapshot(after)).toMatchObject({ chatRoomJoined: true, sessions: [] })
    expect(after.domains.some((item) => item.domain === OTHER_DOMAIN && item.chatRoomJoined)).toBe(false)
    expect(after.world.localPresence?.sites.map((site) => site.origin)).toEqual([DOMAIN])
    expect(after.world.presences).toEqual([])
    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(2)
    disposeServer(server)
  })

  it('returns an in-flight other Domain release failure before the manual replacement cuts', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    const otherCleanupStarted = deferred<void>()
    const rejectOtherCleanup = deferred<void>()
    const releaseError = new Error('other domain release cleanup rejected')
    let rejectOther = false
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as
          | { domain?: string; local?: unknown; observers?: unknown[] }
          | undefined
        if (
          rejectOther &&
          record?.domain === OTHER_DOMAIN &&
          !record.local &&
          Array.isArray(record.observers) &&
          record.observers.length === 0
        ) {
          otherCleanupStarted.resolve()
          await rejectOtherCleanup.promise
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()

    rejectOther = true
    const releaseB = server.leaveChatRoom({ domain: OTHER_DOMAIN })
    await otherCleanupStarted.promise
    const refresh = server.reconnectDomain({ domain: DOMAIN })
    await settle()
    expect(
      fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${getChatRoomId(DOMAIN)}`)
    ).toHaveLength(0)

    rejectOtherCleanup.reject(releaseError)
    await expect(releaseB).rejects.toBe(releaseError)
    await expect(refresh).rejects.toBe(releaseError)
    expect(
      fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${getChatRoomId(DOMAIN)}`)
    ).toHaveLength(0)
    await expect(server.getSnapshot({ caller: { tab: { id: 1, url: '' } } })).rejects.toBe(releaseError)
    const after = await readServerSnapshot(server)
    expect(after.domains.find((item) => item.domain === DOMAIN)?.chatRoomJoined).toBe(true)
    expect(after.world.localPresence?.sites.map((site) => site.origin).toSorted()).toEqual([DOMAIN, OTHER_DOMAIN])
    disposeServer(server)
  })

  it('fails the same click before cut when a newer release begins after the barrier', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const thirdDomain = 'https://third.example'
    const values: Record<string, unknown> = {}
    const otherCleanupStarted = deferred<void>()
    const releaseOtherCleanup = deferred<void>()
    const thirdCleanupStarted = deferred<void>()
    const releaseThirdCleanup = deferred<void>()
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as
          | { domain?: string; local?: unknown; observers?: unknown[] }
          | undefined
        if (!record?.local && Array.isArray(record?.observers) && record.observers.length === 0) {
          if (record.domain === OTHER_DOMAIN) {
            otherCleanupStarted.resolve()
            await releaseOtherCleanup.promise
          }
          if (record.domain === thirdDomain) {
            thirdCleanupStarted.resolve()
            await releaseThirdCleanup.promise
          }
        }
        Object.assign(values, items)
      }
    })
    const tabs = new Map<number, { id: number; url: string }>([
      [1, { id: 1, url: `${DOMAIN}/topic` }],
      [2, { id: 2, url: `${OTHER_DOMAIN}/topic` }],
      [3, { id: 3, url: `${thirdDomain}/topic` }]
    ])
    let ensureCalls = 0
    let heldEnsureCall = -1
    const postBarrierValidationStarted = deferred<void>()
    const releasePostBarrierValidation = deferred<void>()
    const admission = {
      tabs: {
        get: async (tabId: number) => {
          const tab = tabs.get(tabId)
          if (!tab) throw new Error('tab missing')
          return tab
        },
        query: async () => [...tabs.values()],
        sendMessage: async () => undefined
      },
      ensureTransport: async () => {
        ensureCalls += 1
        if (ensureCalls !== heldEnsureCall) return
        postBarrierValidationStarted.resolve()
        await releasePostBarrierValidation.promise
      }
    }
    const callerOf = (tabId: number) => ({ caller: { tab: tabs.get(tabId)! } })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore, admission })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, ...callerOf(1) })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, ...callerOf(1) })
    await server.attachPage({ domain: OTHER_DOMAIN, ...callerOf(2) })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN }, ...callerOf(2) })
    await server.attachPage({ domain: thirdDomain, ...callerOf(3) })
    await server.joinChatRoom({ domain: thirdDomain, user: USER, site: { origin: thirdDomain }, ...callerOf(3) })
    await settle()

    const releaseB = server.leaveChatRoom({ domain: OTHER_DOMAIN, ...callerOf(2) })
    await otherCleanupStarted.promise
    // reconnect's initial caller check is one call; its post-release revalidation is the second.
    heldEnsureCall = ensureCalls + 2
    const refresh = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    releaseOtherCleanup.resolve()
    await postBarrierValidationStarted.promise

    // C starts only after B's exact terminal. It advances the private release generation while
    // A is held immediately before its first cut, so A must fail closed rather than cut C.
    const releaseC = server.leaveChatRoom({ domain: thirdDomain, ...callerOf(3) })
    await thirdCleanupStarted.promise
    releasePostBarrierValidation.resolve()
    await expect(refresh).rejects.toThrow('Runtime release lifecycle changed before the dual replacement cut')
    expect(
      fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${getChatRoomId(DOMAIN)}`)
    ).toHaveLength(0)

    releaseThirdCleanup.resolve()
    await Promise.all([releaseB, releaseC])
    await settle()
    const after = await readServerSnapshot(server)
    expect(after.domains.find((item) => item.domain === DOMAIN)?.chatRoomJoined).toBe(true)
    expect(after.world.localPresence?.sites.map((site) => site.origin)).toEqual([DOMAIN])
    disposeServer(server)
  })

  it('supersedes the held old full-publication owner across a manual replacement', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    emitRemoteWorldPresence(fake)
    await settle()

    // A new registration publishes one full snapshot: that broadcast owner is invoked and held.
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    fake.hangSendsTo(worldRoomId)
    const otherJoin = server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } }).then(
      () => ({ kind: 'joined' as const }),
      (error: Error) => ({ kind: 'failed' as const, error })
    )
    await vi.waitFor(() => expect(fake.sent.filter((item) => item.roomId === worldRoomId).length).toBeGreaterThan(0))

    // The manual cut revokes this old publisher. Its late terminal cannot complete the old normal
    // join; a fresh normal join is required after the shared manual commit.
    const refresh = server.reconnectDomain({ domain: DOMAIN }).then(
      () => ({ kind: 'committed' as const }),
      (error: Error) => ({ kind: 'failed' as const, error })
    )
    fake.releaseSends()
    const [refreshResult, otherResult] = await Promise.all([refresh, otherJoin])
    await settle()
    expect(refreshResult).toEqual({ kind: 'committed' })
    expect(otherResult).toMatchObject({ kind: 'failed', error: expect.any(Error) })
    const after = await readServerSnapshot(server)
    expect(after.world.joined).toBe(true)
    expect(after.world.localPresence?.sites.map((site) => site.origin)).toEqual([DOMAIN])

    const retriedOther = await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { origin: OTHER_DOMAIN }
    })
    expect(retriedOther?.world.localPresence?.sites.map((site) => site.origin)).toEqual(
      expect.arrayContaining([DOMAIN, OTHER_DOMAIN])
    )
    disposeServer(server)
  })

  it('keeps the committed owners readable when a post-commit World publication fails', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()

    // The post-commit catch-up is no longer a replacement terminal. Its failure may be retained
    // diagnostically, but it cannot revoke either already-shared current owner or block a pull.
    fake.failNextSend(worldRoomId)
    await server.reconnectDomain({ domain: DOMAIN })
    await settle()
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(true)
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    expect((await readServerSnapshot(server)).failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: `Room "${worldRoomId}" send failed` })])
    )
    await expect(server.getSnapshot(callerOf(1))).resolves.toMatchObject({ world: { joined: true } })
    disposeServer(server)
  })

  it('replaces World through the dual path when legacy reset persistence would reject', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let rejectClearSave = false
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as { local?: { status?: string }; observers?: unknown[] }
        if (
          rejectClearSave &&
          record &&
          typeof record === 'object' &&
          record.local?.status === 'active' &&
          (record.observers ?? []).length === 0
        ) {
          throw new Error('clear save rejected')
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect((await readServerSnapshot(server)).world.joined).toBe(true)

    rejectClearSave = true
    await expect(server.reconnectDomain({ domain: DOMAIN })).resolves.toBeUndefined()
    await settle()
    expect((await readServerSnapshot(server)).domains[0].chatRoomJoined).toBe(true)
    expect(fake.physicalJoinCalls.filter((roomId) => roomId === worldRoomId)).toHaveLength(2)
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    expect(fake.operationLog.filter((entry) => entry === `leave:${worldRoomId}`)).toHaveLength(1)
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    disposeServer(server)
  })

  it('starts no manual World replacement before readiness', async () => {
    const fake = createFakeTransport({ physicalReady: false })
    const clock = new FakeClock()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    // Pre-ready: no committed runtime and no retained seed, so a manual activation is inadmissible
    // and the World child never fires (the Retry slot keeps its existing initialization behavior).
    void server.reconnectDomain({ domain: DOMAIN })
    await settle()
    expect(fake.operationLog.filter((entry) => entry === `leave:${worldRoomId}`)).toHaveLength(0)
    expect((await readServerSnapshot(server)).world.joined).toBe(false)
    disposeServer(server)
  })

  it('returns the committed local snapshot without awaiting active Presence persistence', async () => {
    const values: Record<string, unknown> = {}
    const activeStarted = deferred<void>()
    const releaseActive = deferred<void>()
    let writeCount = 0
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        writeCount += 1
        if (writeCount === 2) {
          activeStarted.resolve()
          await releaseActive.promise
        }
        Object.assign(values, items)
      }
    })
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    let joinedSnapshot: Awaited<ReturnType<RuntimeServer['joinChatRoom']>> | undefined
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then((snapshot) => {
      joinedSnapshot = snapshot
      return snapshot
    })
    await activeStarted.promise
    await settle()

    try {
      expect(joinedSnapshot?.domains[0]).toMatchObject({
        domain: DOMAIN,
        chatRoomJoined: true,
        localSession: { user: USER }
      })
    } finally {
      releaseActive.resolve()
      await join
      disposeServer(server)
    }
  })

  it('projects the production page user shape to the wire identity before joining', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    // Pre-existing room members become the initial publication's distinct targets.
    fake.plantPeer(getChatRoomId(DOMAIN), 'remote-peer')
    fake.plantPeer(getWorldRoomId(), 'remote-peer')

    const snapshot = await server.joinChatRoom({
      domain: DOMAIN,
      user: { id: USER_INFO.id, name: USER_INFO.name, avatar: USER_INFO.avatar },
      site: SITE
    })
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()

    expect(fake.joinCalls).toEqual([getChatRoomId(DOMAIN), getWorldRoomId()])
    expect(fake.physicalJoinCalls).toEqual([getChatRoomId(DOMAIN), getWorldRoomId()])
    expect(
      fake.messages(getChatRoomId(DOMAIN)).filter((message) => message.type === MESSAGE_TYPE.SESSION)
    ).toHaveLength(1)
    expect(snapshot.domains[0].localSession?.user).toEqual(USER)
    const presence = fake.messages(getWorldRoomId()).find(isWorldPresence)
    expect(presence?.user).toEqual(USER)
    expect(Object.keys(presence?.user ?? {})).toEqual(['id', 'name', 'avatar'])
  })

  it('keeps an existing-user join provisional until cold physical rooms are ready', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    const desiredRoomsRegistered = fake.waitForDesiredRooms(2)
    // Pre-existing room members become the initial publication's distinct targets.
    fake.plantPeer(roomId, 'remote-peer')
    fake.plantPeer(worldRoomId, 'remote-peer')
    let joinResult: 'pending' | 'resolved' | 'rejected' = 'pending'
    const joinTask = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      (snapshot) => {
        joinResult = 'resolved'
        return snapshot
      },
      (error: Error) => {
        joinResult = 'rejected'
        throw error
      }
    )
    await desiredRoomsRegistered

    expect(joinResult).toBe('pending')
    expect(fake.desired).toEqual(new Set([roomId, worldRoomId]))
    expect(fake.joined).toEqual(new Set())
    expect(fake.sendAttempts).toEqual([])
    const provisional = await readServerSnapshot(server)
    expect(provisional.domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined })
    expect(provisional.world).toMatchObject({ joined: false, localPresence: undefined })

    fake.open()
    const snapshot = await joinTask
    if (!snapshot) throw new Error('Join was cancelled')

    expect(joinResult).toBe('resolved')
    expect(fake.joined).toEqual(fake.desired)
    expect(fake.joinCalls).toEqual([roomId, worldRoomId])
    // The initial Session is one native broadcast; the pre-existing member is its provider-side recipient.
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(1)
    const sessionAttempt = fake.sendAttempts.findLast(
      (attempt) => attempt.roomId === roomId && JSON.parse(attempt.payload).type === MESSAGE_TYPE.SESSION
    )
    expect(sessionAttempt?.to).toEqual(['remote-peer'])
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(1)
    expect(snapshot.domains[0]).toMatchObject({ chatRoomJoined: true, localSession: { user: USER } })
    expect(snapshot.world).toMatchObject({ joined: true, localPresence: { user: USER } })

    fake.receive(roomId, 'remote-peer', session())
    fake.receive(worldRoomId, 'remote-peer', {
      sessionId: 'remote-world-session',
      user: REMOTE_USER,
      sites: [SITE]
    })
    await settle()

    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(1)
    const converged = await readServerSnapshot(server)
    expect(converged.domains[0]).toMatchObject({
      chatRoomJoined: true,
      localSession: { user: USER },
      sessions: [{ sourcePeerId: 'remote-peer', user: REMOTE_USER }]
    })
    expect(converged.world).toMatchObject({
      joined: true,
      localPresence: { user: USER },
      presences: [{ sourcePeerId: 'remote-peer', presence: { user: REMOTE_USER } }]
    })
  })

  it('buffers late remote membership until a cold local join commits', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    // Pre-existing room members become the initial publication's distinct targets.
    fake.plantPeer(roomId, 'remote-peer')
    fake.plantPeer(worldRoomId, 'remote-peer')
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForDesiredRooms(2)

    fake.open()
    // The World publication is hung at the provider: the commit is still pending, and late remote
    // membership stays buffered behind the publication. Session delivery is independent.
    await expect(worldSendAttempt).resolves.toMatchObject({ roomId: worldRoomId })
    fake.receive(roomId, 'remote-peer', session())
    fake.receive(worldRoomId, 'remote-peer', {
      sessionId: 'remote-world-session',
      user: REMOTE_USER,
      sites: [SITE]
    })
    await settle()

    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({
      chatRoomJoined: false,
      localSession: undefined
    })
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')

    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(1)
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(1)
    expect(snapshot.domains[0]).toMatchObject({
      chatRoomJoined: true,
      localSession: { user: USER },
      sessions: [{ sourcePeerId: 'remote-peer', user: REMOTE_USER }]
    })
    expect(snapshot.world).toMatchObject({
      joined: true,
      localPresence: { user: USER },
      presences: [{ sourcePeerId: 'remote-peer', presence: { user: REMOTE_USER } }]
    })
  })

  it('projects a strictly later remote join received while the local join is provisional', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const worldRoomId = getWorldRoomId()
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    // A pre-existing room member becomes the initial publication's distinct target.
    fake.plantPeer(roomId, 'remote-peer')
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForDesiredRooms(2)
    fake.open()
    // The World publication is hung at the provider while the strictly later remote join lands in
    // the provisional window.
    await worldSendAttempt
    fake.receive(roomId, 'later-peer', {
      ...session(),
      joinedAt: NOW + 1
    })
    await settle()
    expect((await readServerSnapshot(server)).domains[0]?.sessions).toEqual([])

    fake.releaseSends()
    await join
    await settle()
    expect((await readServerSnapshot(server)).domains[0]?.sessions).toEqual([
      expect.objectContaining({ sourcePeerId: 'later-peer', user: REMOTE_USER })
    ])
  })

  it('converges a refreshed logical projection across every physical binding', async () => {
    const { fake, server, roomId } = await setup()
    const presenceId = 'shared-remote-presence'
    const originalUser = { ...REMOTE_USER, name: 'Before', avatar: 'before.png' }
    const refreshedUser = { ...REMOTE_USER, name: 'After', avatar: 'after.png' }
    fake.receive(roomId, 'remote-peer-a', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'remote-session-a',
      presenceId,
      joinedAt: NOW + 1,
      user: originalUser
    })
    fake.receive(roomId, 'remote-peer-b', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'remote-session-b',
      presenceId,
      joinedAt: NOW + 1,
      user: originalUser
    })
    await settle()

    fake.receive(roomId, 'remote-peer-a', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'remote-session-a',
      presenceId,
      joinedAt: NOW + 1,
      user: refreshedUser
    })
    await settle()

    const sessions = (await readServerSnapshot(server)).domains[0].sessions.filter((item) =>
      ['remote-peer-a', 'remote-peer-b'].includes(item.sourcePeerId)
    )
    expect(sessions).toHaveLength(2)
    expect(sessions.map((item) => item.user)).toEqual([refreshedUser, refreshedUser])
  })

  it('lets only the newest generation complete a superseded cold join', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)
    // A pre-existing Chat member becomes the committed publication's distinct target.
    fake.plantPeer(roomId, 'remote-peer')
    const refreshedUser = { ...USER, name: 'Refreshed' }
    const secondJoin = server.joinChatRoom({ domain: DOMAIN, user: refreshedUser, site: SITE })

    await expect(firstJoin).resolves.toBeNull()
    expect((await readServerSnapshot(server)).domains[0]?.localSession).toBeUndefined()
    fake.open()
    const snapshot = await secondJoin
    if (!snapshot) throw new Error('Join was cancelled')

    expect(fake.joinCalls).toEqual([roomId, worldRoomId, roomId, worldRoomId])
    expect(fake.physicalJoinCalls).toEqual([roomId, worldRoomId])
    const sessions = fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.SESSION)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.user).toEqual(refreshedUser)
    fake.peerJoin(worldRoomId, 'remote-peer')
    await settle()
    expect(fake.messages(worldRoomId).filter(isWorldPresence).at(-1)).toEqual(
      expect.objectContaining({ user: refreshedUser })
    )
    expect((await readServerSnapshot(server)).world.presences.map((item) => item.sourcePeerId)).not.toContain(
      'local-peer'
    )
    expect(snapshot.domains[0]).toMatchObject({ chatRoomJoined: true, localSession: { user: refreshedUser } })
  })

  it('cancels a cold join on grace release and ignores a late physical open', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const joinResult = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)

    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await expect(joinResult).resolves.toEqual(new Error('Domain released during join'))
    expect(fake.desired).toEqual(new Set())
    expect(fake.joined).toEqual(new Set())

    fake.open()
    expect(fake.physicalJoinCalls).toEqual([])
    expect(fake.sendAttempts).toEqual([])
    expect((await readServerSnapshot(server)).domains).toEqual([])
  })

  it('rolls back a bounded cold join timeout before a late physical open', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const joinResult = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)

    clock.advance(PHYSICAL_ROOM_JOIN_TIMEOUT_MS + 1)
    await expect(joinResult).resolves.toEqual(new Error('Physical room join timed out'))
    expect(fake.desired).toEqual(new Set())
    expect(fake.joined).toEqual(new Set())
    expect(fake.sendAttempts).toEqual([])
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({
      chatRoomJoined: false,
      localSession: undefined
    })

    fake.open()
    expect(fake.physicalJoinCalls).toEqual([])
    expect(fake.sendAttempts).toEqual([])
  })

  it('disposes a pending host join before a replacement host can converge', async () => {
    const oldClock = new FakeClock()
    const oldFake = createFakeTransport({ physicalReady: false })
    const oldServer = createServer({ transport: oldFake.transport, clock: oldClock, codec: jsonCodec })
    await oldServer.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const pendingJoin = oldServer.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await oldFake.waitForDesiredRooms(2)

    disposeServer(oldServer)
    oldFake.open()
    await expect(pendingJoin).rejects.toEqual(
      new DOMException('Runtime presence is completing its final release', 'AbortError')
    )
    expect(oldFake.desired).toEqual(new Set())
    expect(oldFake.physicalJoinCalls).toEqual([])
    expect(oldFake.sendAttempts).toEqual([])

    const replacementFake = createFakeTransport()
    const replacement = createServer({ transport: replacementFake.transport, clock: oldClock, codec: jsonCodec })
    await replacement.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const snapshot = await replacement.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    if (!snapshot) throw new Error('Join was cancelled')
    expect(snapshot.domains[0]).toMatchObject({ chatRoomJoined: true, localSession: { user: USER } })
    expect(replacementFake.physicalJoinCalls).toEqual([getChatRoomId(DOMAIN), getWorldRoomId()])
  })

  it('keeps a reconnect provisional and commits one replacement session after physical recovery', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const before = await readServerSnapshot(server)
    // A live remote target turns the reconnect revision into one wire publication.
    emitRemoteWorldPresence(fake)
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)

    let reconnectResult: 'pending' | 'resolved' = 'pending'
    const reconnect = server.reconnectDomain({ domain: DOMAIN }).then(() => {
      reconnectResult = 'resolved'
    })
    await fake.waitForJoinCalls(4)

    expect(reconnectResult).toBe('pending')
    // Both children physically left their rooms while both replacement joins pend: nothing is
    // joined during the provisional window.
    expect(fake.joined).toEqual(new Set())
    // The refresh destruction removed the committed aggregate: no prior session/readiness may
    // satisfy the replacement while it is still provisional.
    expect((await readServerSnapshot(server)).domains[0].localSession).toBeUndefined()
    fake.open()
    await worldSendAttempt
    fake.releaseSends()
    await reconnect

    const after = await readServerSnapshot(server)
    expect(reconnectResult).toBe('resolved')
    expect(after.domains[0].localSession?.sessionId).not.toBe(before.domains[0].localSession?.sessionId)
    expect(fake.physicalJoinCalls.filter((id) => id === roomId)).toHaveLength(2)
    // The World child also physically re-joined through its own replacement.
    expect(fake.physicalJoinCalls.filter((id) => id === worldRoomId)).toHaveLength(2)
    const sessionAttempts = fake.sendAttempts.filter(
      (attempt) => attempt.roomId === roomId && JSON.parse(attempt.payload).type === MESSAGE_TYPE.SESSION
    )
    expect(sessionAttempts).toHaveLength(1)
    expect(sessionAttempts.map((attempt) => attempt.to)).toEqual([['remote-peer']])
    const worldMessages = fake.messages(worldRoomId).filter(isWorldPresence)
    expect(worldMessages.length).toBeGreaterThanOrEqual(2)
    expect(worldMessages.at(-1)).toEqual(after.world.localPresence)
  })

  it('opens the AppButton current-state pull at the shared commit before ordinary World catch-up settles', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(worldRoomId)
    const worldPublicationStarted = fake.waitForSendAttempt(worldRoomId)

    let reconnectSettled = false
    const reconnect = server.reconnectDomain({ domain: DOMAIN }).then(() => {
      reconnectSettled = true
    })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: worldRoomId })

    let readSettled = false
    const currentRead = server.getSnapshot(callerOf(1)).then((snapshot) => {
      readSettled = true
      return snapshot
    })
    await settle()
    expect(reconnectSettled).toBe(true)
    expect(readSettled).toBe(true)

    await reconnect
    const snapshot = await currentRead
    expect(snapshot.domains.find((item) => item.domain === DOMAIN)?.chatRoomJoined).toBe(true)
    expect(snapshot.world.joined).toBe(true)
    fake.releaseSends()
    disposeServer(server)
  })

  it('waits for both physical retires before one silent current-owner cut', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const releaseRetires = fake.holdRetires()
    fake.makeNotReady()
    const joinsBefore = fake.joinCalls.length
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    const reconnectTerminal = reconnect.then(
      () => ({ kind: 'reconnect-resolved' as const }),
      (error) => ({ kind: 'reconnect-rejected' as const, error })
    )
    await vi.waitFor(() =>
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    )

    let readSettled = false
    const blockedRead = server.getSnapshot(callerOf(1)).then((value) => {
      readSettled = true
      return value
    })
    const blockedReadTerminal = blockedRead.then(
      () => ({ kind: 'read-resolved' as const }),
      (error) => ({ kind: 'read-rejected' as const, error })
    )
    await settle()
    expect(readSettled).toBe(false)
    expect((await readServerSnapshot(server)).domains[0]?.chatRoomJoined).toBe(true)
    expect((await readServerSnapshot(server)).world.joined).toBe(true)

    releaseRetires()
    const successorJoins = fake.waitForJoinCalls(joinsBefore + 2)
    const firstCompletion = await Promise.race([
      successorJoins.then(() => ({ kind: 'successor-joins' as const })),
      reconnectTerminal,
      blockedReadTerminal
    ])
    expect(firstCompletion).toEqual({ kind: 'successor-joins' })
    await successorJoins
    await settle()
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({
      chatRoomJoined: false,
      localSession: undefined,
      sessions: []
    })
    expect((await readServerSnapshot(server)).world.joined).toBe(false)
    expect(readSettled).toBe(false)

    fake.open()
    await reconnect
    const snapshot = await blockedRead
    expect(snapshot.domains[0]).toMatchObject({ chatRoomJoined: true })
    expect(snapshot.world.joined).toBe(true)
    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    disposeServer(server)
  })

  it('binds a dual-retire retry seed to its exact caller and document before its one fresh retry', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    emitRemoteWorldPresence(fake)
    await settle()
    const before = readServerSnapshot(server)
    const joinsBefore = fake.joinCalls.length
    const failure = new Error('physical dual-retire rejected')
    fake.failNextRetire(failure)

    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toBe(failure)

    expect(fake.joinCalls).toHaveLength(joinsBefore)
    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    expect(
      fake.operationLog.filter((entry) => entry === `leave:${roomId}` || entry === `leave:${worldRoomId}`)
    ).toEqual([])
    expect(readServerSnapshot(server)).toEqual(before)
    await expect(server.getSnapshot(callerOf(1))).rejects.toBe(failure)

    await expect(
      server.reconnectDomain({
        domain: DOMAIN,
        caller: { tab: { id: 1, url: `${DOMAIN}/other-document` } }
      })
    ).rejects.toThrow('Dual replacement retry seed does not match this caller binding')
    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)

    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ chatRoomJoined: true })
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    disposeServer(server)
  })

  it('silently cancels a late dual-retire terminal after its caller binding is invalidated', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const releaseRetires = fake.holdRetires()
    fake.makeNotReady()
    const joinsBefore = fake.joinCalls.length
    const reconnect = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    await vi.waitFor(() =>
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    )

    await removeServerTab(server, 1)
    releaseRetires()

    await expect(reconnect).resolves.toBeNull()
    await settle()
    expect(fake.joinCalls).toHaveLength(joinsBefore)
    expect(fake.joined).toEqual(new Set())
    disposeServer(server)
  })

  it('keeps a dual replacement live while its exact caller remains current', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const releaseRetires = fake.holdRetires()
    fake.makeNotReady()
    const joinsBefore = fake.joinCalls.length
    const reconnect = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })

    await vi.waitFor(() =>
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    )
    releaseRetires()
    await fake.waitForJoinCalls(joinsBefore + 2)
    fake.open()

    await expect(reconnect).resolves.toBeUndefined()
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ chatRoomJoined: true })
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    disposeServer(server)
  })

  it('allows a reattached caller to start a fresh replacement after its old attempt is cancelled', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const releaseRetires = fake.holdRetires()
    const first = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })

    await vi.waitFor(() =>
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    )
    await removeServerTab(server, 1)
    releaseRetires()

    await expect(first).resolves.toBeNull()
    await attachTab(server, DOMAIN, 1)
    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ chatRoomJoined: true })
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    disposeServer(server)
  })

  it('cancels a cut dual replacement when the same domain explicitly leaves before shared commit', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const releaseIngress = fake.holdIngressActivation()
    const reconnect = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })

    await vi.waitFor(() =>
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    )
    await vi.waitFor(() =>
      expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined })
    )
    expect(readServerSnapshot(server).world).toMatchObject({ joined: false, localPresence: undefined, presences: [] })

    const leave = server.leaveChatRoom({ domain: DOMAIN, ...callerOf(1) })
    releaseIngress()

    await expect(leave).resolves.toBeUndefined()
    await expect(reconnect).resolves.toBeNull()
    await settle()
    expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined })
    expect(readServerSnapshot(server).world).toMatchObject({ joined: false, localPresence: undefined, presences: [] })
    expect(fake.joined.has(roomId)).toBe(false)
    expect(fake.joined.has(worldRoomId)).toBe(false)
    disposeServer(server)
  })

  it('cancels a cut dual replacement when its Server host is disposed', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const releaseIngress = fake.holdIngressActivation()
    const reconnect = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })

    await vi.waitFor(() =>
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    )
    await vi.waitFor(() =>
      expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined })
    )

    disposeServer(server)
    releaseIngress()

    await expect(reconnect).resolves.toBeNull()
    expect(fake.joined).toEqual(new Set())
  })

  it.each([
    ['ROOM', (roomId: string, _worldRoomId: string) => roomId],
    ['World', (_roomId: string, worldRoomId: string) => worldRoomId]
  ] as const)(
    'aborts a cut dual replacement when its prepared %s room closes before shared commit',
    async (_owner, closedRoom) => {
      const { fake, server, roomId } = await setup()
      const worldRoomId = getWorldRoomId()
      const releaseIngress = fake.holdIngressActivation()
      const reconnect = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })

      await vi.waitFor(() =>
        expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
      )
      await vi.waitFor(() =>
        expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined })
      )

      fake.roomClose(closedRoom(roomId, worldRoomId))
      releaseIngress()

      await expect(reconnect).rejects.toThrow()
      await settle()
      expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined })
      expect(readServerSnapshot(server).world).toMatchObject({ joined: false, localPresence: undefined, presences: [] })
      expect(fake.joined.has(roomId)).toBe(false)
      expect(fake.joined.has(worldRoomId)).toBe(false)
      disposeServer(server)
    }
  )

  it('drops a late old World frame after a manual cut and accepts only the fresh room generation', async () => {
    const oldDecode = deferred<unknown>()
    let oldDecodeStarted = false
    const codec: WireCodec = {
      encode: async (value) => JSON.stringify(value),
      decode: async (payload) => {
        const value = JSON.parse(payload as string) as { sessionId?: string }
        if (value.sessionId === 'old-world-session') {
          oldDecodeStarted = true
          return oldDecode.promise
        }
        return value
      }
    }
    const { fake, server, roomId } = await setup(DOMAIN, NOW, codec)
    const worldRoomId = getWorldRoomId()
    fake.peerJoin(worldRoomId, 'remote-peer')
    fake.receive(worldRoomId, 'remote-peer', {
      sessionId: 'old-world-session',
      user: REMOTE_USER,
      sites: [{ origin: 'https://old.example', title: 'Old' }]
    })
    await vi.waitFor(() => expect(oldDecodeStarted).toBe(true))

    const releaseIngress = fake.holdIngressActivation()
    const reconnect = server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })
    await vi.waitFor(() =>
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(1)
    )
    await vi.waitFor(() => expect(readServerSnapshot(server).world.presences).toEqual([]))

    oldDecode.resolve({
      sessionId: 'old-world-session',
      user: REMOTE_USER,
      sites: [{ origin: 'https://old.example', title: 'Old' }]
    })
    await settle()
    expect(readServerSnapshot(server).world.presences).toEqual([])

    releaseIngress()
    await reconnect
    await settle()
    expect(readServerSnapshot(server).world.presences).toEqual([])

    fake.receive(worldRoomId, 'remote-peer', {
      sessionId: 'fresh-world-session',
      user: REMOTE_USER,
      sites: [{ origin: 'https://fresh.example', title: 'Fresh' }]
    })
    await vi.waitFor(() =>
      expect(readServerSnapshot(server).world.presences).toEqual([
        expect.objectContaining({
          sourcePeerId: 'remote-peer',
          presence: expect.objectContaining({ sessionId: 'fresh-world-session' })
        })
      ])
    )
    disposeServer(server)
  })

  it('does not create a retry seed when recovered ROOM local intent has no World counterpart', async () => {
    const fake = createFakeTransport()
    const roomId = getChatRoomId(DOMAIN)
    const server = createServer({
      transport: {
        ...fake.transport,
        roomRecovery: () => ({
          rooms: [
            {
              roomId,
              domain: DOMAIN,
              local: {
                sessionId: 'recovered-session',
                presenceId: 'recovered-presence',
                user: USER,
                site: SITE,
                joinedAt: NOW
              },
              sessions: []
            }
          ]
        })
      }
    })
    await attachTab(server, DOMAIN, 1)

    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()

    expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: true })
    expect(readServerSnapshot(server).world).toMatchObject({ joined: false, localPresence: undefined })
    expect(fake.operationLog.filter((entry) => entry.startsWith('retire:'))).toEqual([])
    disposeServer(server)
  })

  it('does not create a retry seed when recovered World local intent has no ROOM counterpart', async () => {
    const fake = createFakeTransport()
    const server = createServer({
      transport: {
        ...fake.transport,
        worldRecovery: () => ({
          members: [],
          presences: [],
          local: {
            peerId: 'recovered-world-peer',
            handle: 'recovered-world-handle',
            registrations: [{ domain: DOMAIN, user: USER, site: SITE }]
          }
        })
      }
    })
    await attachTab(server, DOMAIN, 1)

    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()

    expect(readServerSnapshot(server).domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined })
    expect(readServerSnapshot(server).world.joined).toBe(true)
    expect(fake.operationLog.filter((entry) => entry.startsWith('retire:'))).toEqual([])
    disposeServer(server)
  })

  it.each([
    ['ROOM', (roomId: string, _worldRoomId: string) => roomId],
    ['World', (_roomId: string, worldRoomId: string) => worldRoomId]
  ] as const)(
    'cross-aborts both prepared owners on a %s admission failure and retries only by a new AppButton click',
    async (_owner, failedRoom) => {
      const { fake, server, roomId } = await setup()
      const worldRoomId = getWorldRoomId()
      const failedRoomId = failedRoom(roomId, worldRoomId)
      fake.failNextJoin(failedRoomId)

      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toThrow(
        `Room "${failedRoomId}" join failed`
      )
      const failed = await readServerSnapshot(server)
      expect(failed.domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined, sessions: [] })
      expect(failed.world).toMatchObject({ joined: false, presences: [] })
      expect(fake.joined.has(roomId)).toBe(false)
      expect(fake.joined.has(worldRoomId)).toBe(false)
      await expect(server.getSnapshot(callerOf(1))).rejects.toThrow(`Room "${failedRoomId}" join failed`)

      const retiresBeforeRejectedCaller = fake.operationLog.filter(
        (entry) => entry === `retire:${worldRoomId},${roomId}`
      ).length
      await expect(
        server.reconnectDomain({
          domain: DOMAIN,
          caller: { tab: { id: 1, url: `${DOMAIN}/other-document` } }
        })
      ).rejects.toThrow('Dual replacement retry seed does not match this caller binding')
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(
        retiresBeforeRejectedCaller
      )

      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
      const retried = await readServerSnapshot(server)
      expect(retried.domains[0]).toMatchObject({ chatRoomJoined: true, localSession: expect.any(Object) })
      expect(retried.world.joined).toBe(true)
      expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(3)
      disposeServer(server)
    }
  )

  it('cross-aborts both staged owners when ingress activation rejects and allows only a fresh retry', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const failure = new Error('prepared ingress activation rejected')
    fake.failNextIngressActivation(failure)

    await expect(server.reconnectDomain({ domain: DOMAIN })).rejects.toBe(failure)
    const failed = await readServerSnapshot(server)
    expect(failed.domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined, sessions: [] })
    expect(failed.world).toMatchObject({ joined: false, presences: [] })
    expect(fake.joined.has(roomId)).toBe(false)
    expect(fake.joined.has(worldRoomId)).toBe(false)
    await expect(server.getSnapshot(callerOf(1))).rejects.toBe(failure)

    await expect(server.reconnectDomain({ domain: DOMAIN })).resolves.toBeUndefined()
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ chatRoomJoined: true })
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    disposeServer(server)
  })

  it.each([
    ['ROOM hydrate', 'room-hydrate'],
    ['World hydrate', 'world-hydrate'],
    ['ROOM precommit', 'room-precommit'],
    ['World precommit', 'world-precommit']
  ] as const)(
    'cross-aborts without publication when private %s fails, then succeeds through one fresh retry',
    async (_label, stage) => {
      const observer = stage === 'room-hydrate' ? observeDualEpochGateDispatches() : undefined
      const worldObserver = stage === 'world-hydrate' ? observeDualEpochGateDispatches() : undefined
      const precommitObserver = stage === 'room-precommit' ? observeDualEpochGateDispatches() : undefined
      const worldPrecommitObserver = stage === 'world-precommit' ? observeDualEpochGateDispatches() : undefined
      const { fake, server, roomId } = await setup()
      observer?.restore()
      worldObserver?.restore()
      precommitObserver?.restore()
      worldPrecommitObserver?.restore()
      const worldRoomId = getWorldRoomId()
      const failure = new Error(`${stage} injected failure`)
      const sentBefore = fake.sent.length
      fake.failReplacementAt(stage, failure)

      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toBe(failure)
      if (observer) {
        expect(observer.begins).toHaveLength(1)
        expect(observer.aborts).toHaveLength(1)
        expect(observer.aborts[0]).toBe(observer.begins[0])
        expect(observer.aborts[0]).toMatchObject({ domain: DOMAIN, epoch: observer.begins[0]?.epoch })
      }
      if (worldObserver) {
        expect(worldObserver.begins).toHaveLength(1)
        expect(worldObserver.aborts).toHaveLength(1)
        expect(worldObserver.aborts[0]).toBe(worldObserver.begins[0])
        expect(worldObserver.aborts[0]).toMatchObject({ domain: DOMAIN, epoch: worldObserver.begins[0]?.epoch })
      }
      if (precommitObserver) {
        expect(precommitObserver.begins).toHaveLength(1)
        expect(precommitObserver.aborts).toHaveLength(1)
        expect(precommitObserver.aborts[0]).toBe(precommitObserver.begins[0])
        expect(precommitObserver.aborts[0]).toMatchObject({ domain: DOMAIN, epoch: precommitObserver.begins[0]?.epoch })
      }
      if (worldPrecommitObserver) {
        expect(worldPrecommitObserver.begins).toHaveLength(1)
        expect(worldPrecommitObserver.aborts).toHaveLength(1)
        expect(worldPrecommitObserver.aborts[0]).toBe(worldPrecommitObserver.begins[0])
        expect(worldPrecommitObserver.aborts[0]).toMatchObject({
          domain: DOMAIN,
          epoch: worldPrecommitObserver.begins[0]?.epoch
        })
      }
      const failed = await readServerSnapshot(server)
      expect(failed.domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined, sessions: [] })
      expect(failed.world).toMatchObject({ joined: false, presences: [], localPresence: undefined })
      expect(fake.joined.has(roomId)).toBe(false)
      expect(fake.joined.has(worldRoomId)).toBe(false)
      expect(fake.sent).toHaveLength(sentBefore)
      await expect(server.getSnapshot(callerOf(1))).rejects.toBe(failure)

      await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
      expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ chatRoomJoined: true })
      expect((await readServerSnapshot(server)).world.joined).toBe(true)
      disposeServer(server)
    }
  )

  it('consumes a successful retry seed once and never carries old remote ROOM or World facts', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    fake.peerJoin(roomId, 'remote-room-peer')
    fake.receive(roomId, 'remote-room-peer', session())
    emitRemoteWorldPresence(fake, 'remote-world-peer')
    await settle()
    expect((await readServerSnapshot(server)).domains[0]?.sessions).toHaveLength(1)
    expect((await readServerSnapshot(server)).world.presences).toHaveLength(1)

    fake.failNextJoin(worldRoomId)
    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toThrow(
      `Room "${worldRoomId}" join failed`
    )
    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
    const retried = await readServerSnapshot(server)
    expect(retried.domains[0]).toMatchObject({ chatRoomJoined: true, sessions: [] })
    expect(retried.world.presences).toEqual([])

    const retiresBeforeDifferentDocument = fake.operationLog.filter(
      (entry) => entry === `retire:${worldRoomId},${roomId}`
    ).length
    await expect(
      server.reconnectDomain({
        domain: DOMAIN,
        caller: { tab: { id: 1, url: `${DOMAIN}/different-after-success` } }
      })
    ).resolves.toBeUndefined()
    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(
      retiresBeforeDifferentDocument + 1
    )
    disposeServer(server)
  })

  it('clears a failed retry seed on detach instead of allowing its caller to reuse it', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    fake.failNextJoin(worldRoomId)
    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toThrow(
      `Room "${worldRoomId}" join failed`
    )
    const retiresBeforeDetach = fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`).length

    await removeServerTab(server, 1)
    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()

    expect(fake.operationLog.filter((entry) => entry === `retire:${worldRoomId},${roomId}`)).toHaveLength(
      retiresBeforeDetach
    )
    disposeServer(server)
  })

  it('does not transfer a failed retry seed to a replacement Server host', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    fake.failNextJoin(worldRoomId)
    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).rejects.toThrow(
      `Room "${worldRoomId}" join failed`
    )
    disposeServer(server)

    const replacement = createServer({ transport: fake.transport, clock: new FakeClock(), codec: jsonCodec })
    await attachTab(replacement, DOMAIN, 1)
    await expect(replacement.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()
    expect(fake.operationLog.filter((entry) => entry.startsWith('retire:'))).toHaveLength(2)
    disposeServer(replacement)
  })

  it('applies the latest two-owner state on DocumentClient first pull after an AppButton replacement', async () => {
    const fake = createFakeTransport()
    const listeners = new Set<(message: unknown) => void>()
    const tabs = new Map<number, { id: number; url: string }>([
      [1, { id: 1, url: `${DOMAIN}/` }],
      [2, { id: 2, url: `${OTHER_DOMAIN}/` }]
    ])
    const server = createServer({
      transport: fake.transport,
      codec: jsonCodec,
      admission: {
        tabs: {
          get: async (tabId) => {
            const tab = tabs.get(tabId)
            if (!tab) throw new Error('tab missing')
            return tab
          },
          query: async () => [...tabs.values()],
          sendMessage: async (_tabId, message) => listeners.forEach((listener) => listener(message))
        },
        ensureTransport: async () => {}
      }
    })
    const localCaller = { tab: tabs.get(1)! }
    const client = new DocumentClient({
      coordinator: {
        registerPage: (payload) => server.attachPage({ ...payload, caller: localCaller })
      },
      server: {
        getSnapshot: (payload) => server.getSnapshot({ ...payload, caller: localCaller })
      } as RuntimeServer,
      domain: DOMAIN
    })
    const applies: Array<{ sessionId?: string; sites: string[] }> = []
    client.registerApplier('world', (projection) => {
      const domain = projection.domains.find((item) => item.domain === DOMAIN)
      applies.push({
        sessionId: domain?.localSession?.sessionId,
        sites: projection.world.localPresence?.sites.map((site) => site.origin) ?? []
      })
    })
    listeners.add((message) => {
      if ((message as { type?: string }).type === 'runtime:state-changed') client.invalidate()
    })

    await client.init()
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE, caller: localCaller })
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: tabs.get(2)! } })
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { origin: OTHER_DOMAIN },
      caller: { tab: tabs.get(2)! }
    })
    await vi.waitFor(() => expect(applies.at(-1)?.sites).toEqual([DOMAIN, OTHER_DOMAIN]))
    const beforeClick = applies.length
    const oldSessionId = applies.at(-1)?.sessionId

    const worldRoomId = getWorldRoomId()
    fake.plantPeer(worldRoomId, 'world-peer')
    fake.makeNotReady()
    fake.hangSendsTo(worldRoomId)
    const worldPublicationStarted = fake.waitForSendAttempt(worldRoomId)
    const joinsBeforeClick = fake.joinCalls.length
    const reconnect = server.reconnectDomain({ domain: DOMAIN, caller: localCaller })
    await fake.waitForJoinCalls(joinsBeforeClick + 2)
    await settle()
    expect(applies).toHaveLength(beforeClick)
    fake.open()
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: worldRoomId })
    await vi.waitFor(() => expect(applies.length).toBeGreaterThan(beforeClick))
    expect(applies[beforeClick]).toEqual({
      sessionId: expect.any(String),
      sites: [DOMAIN, OTHER_DOMAIN]
    })
    expect(applies[beforeClick]?.sessionId).not.toBe(oldSessionId)

    fake.releaseSends()
    await reconnect
    client.detach()
    disposeServer(server)
  })

  it('projects one authoritative local identity to every attached tab without replacing remote sessions', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    const first = (await readServerSnapshot(server)).domains[0]?.localSession
    expect(first).toMatchObject({ user: USER, joinedAt: NOW })

    // A later same-domain join retains the one authoritative identity in the current projection.
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect((await readServerSnapshot(server)).domains[0]?.localSession).toMatchObject({
      sessionId: first!.sessionId,
      joinedAt: first!.joinedAt,
      user: first!.user
    })

    const roomId = getChatRoomId(DOMAIN)
    fake.receive(roomId, 'remote-peer', session())
    await settle()
    expect((await readServerSnapshot(server)).domains[0]?.sessions.map((item) => item.sourcePeerId)).toEqual([
      'remote-peer'
    ])

    const refreshedUser = { ...USER, name: 'Refreshed', avatar: 'refreshed-avatar' }
    clock.advance(1)
    await server.joinChatRoom({ domain: DOMAIN, user: refreshedUser, site: SITE })
    await settle()
    const refreshed = (await readServerSnapshot(server)).domains[0]?.localSession
    expect(refreshed).toMatchObject({ user: refreshedUser, joinedAt: first!.joinedAt })
    expect(refreshed?.sessionId).toBe(first!.sessionId)
    expect((await readServerSnapshot(server)).domains[0]?.sessions.map((item) => item.sourcePeerId)).toEqual([
      'remote-peer'
    ])
    expect([...fake.joined].filter((id) => id === roomId)).toHaveLength(1)
  })

  it('rehydrates F5, manual reconnect, and transport rejoin from the current local session', async () => {
    const { clock, fake, server, roomId } = await setup()
    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS - 1)
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    const first = (await readServerSnapshot(server)).domains[0]?.localSession
    expect(first?.user).toEqual(USER)

    await server.reconnectDomain({ domain: DOMAIN })
    await settle()
    const second = (await readServerSnapshot(server)).domains[0]?.localSession
    expect(second?.sessionId).not.toBe(first?.sessionId)

    fake.roomClose(roomId)
    await vi.waitFor(async () => {
      const third = (await readServerSnapshot(server)).domains[0]?.localSession
      expect(third?.sessionId).not.toBe(second?.sessionId)
    })
    expect(fake.joined.has(roomId)).toBe(true)
  })

  it('keeps the tab lease active across a join with no Page callback dependency', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ phase: 'active', tabIds: [1] })
  })

  it('trusts typed identity at local production and joins without protocol revalidation', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    // Local identity production does not validate protocol shape: the typed join proceeds and
    // the receiving peer remains responsible for its own inbound parse.
    await expect(
      server.joinChatRoom({
        domain: DOMAIN,
        user: { ...USER_INFO, name: 1 } as unknown as ChatUser,
        site: SITE
      })
    ).resolves.toMatchObject({ domains: [{ domain: DOMAIN, chatRoomJoined: true }] })
    expect(fake.joinCalls.length).toBeGreaterThan(0)
  })

  it('disposes the Remesh host and physical transport exactly once', async () => {
    const { clock, fake, server } = await setup()

    disposeServer(server)
    disposeServer(server)

    expect(fake.disposeCount()).toBe(1)
    expect(fake.joined.size).toBe(0)
  })

  it('shares one domain room and releases it with the inbound buffer after grace', async () => {
    const { clock, fake, server, roomId } = await setup()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })
    expect([...fake.joined].filter((id) => id === roomId)).toHaveLength(1)

    fake.receive(roomId, 'remote-peer', session())
    fake.receive(roomId, 'remote-peer', text('message-1'))
    await settle()
    expect(await projectedInboundIds(server)).toHaveLength(1)

    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    expect(fake.joined.has(roomId)).toBe(true)

    await removeServerTab(server, 2)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    expect(await projectedInboundIds(server)).toEqual([])
  })

  it('keeps a tab lease and its retained inbound until an explicit detach releases it', async () => {
    const { clock, fake, server, roomId } = await setup()
    fake.receive(roomId, 'remote-peer', session())
    fake.receive(roomId, 'remote-peer', text('message-1'))
    await settle()

    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ phase: 'active', tabIds: [1] })
    expect(await projectedInboundIds(server)).toEqual(['message-1'])
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    expect(fake.joined.has(roomId)).toBe(true)

    await removeServerTab(server, 1)
    expect((await readServerSnapshot(server)).domains[0].phase).toBe('grace')
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
  })

  it('reattaches inside grace without recreating the room or losing buffered events', async () => {
    const { clock, fake, server, roomId } = await setup()
    fake.receive(roomId, 'remote-peer', session())
    fake.receive(roomId, 'remote-peer', text('message-1'))
    await settle()

    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS - 1)
    const snapshot = await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)

    expect(snapshot.domains[0].phase).toBe('active')
    expect(fake.joined.has(roomId)).toBe(true)
    expect(await projectedInboundIds(server)).toEqual(['message-1'])
  })

  it('reconnects the Chat room and replaces World with a full re-publish', async () => {
    const { fake, server, roomId } = await setup()
    // A live remote target makes each committed revision one wire publication.
    emitRemoteWorldPresence(fake)
    await settle()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 4, url: '' } } })
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { origin: OTHER_DOMAIN }
    })
    const worldRoomId = getWorldRoomId()
    const presenceCount = fake.messages(worldRoomId).filter(isWorldPresence).length

    await server.reconnectDomain({ domain: DOMAIN })

    // The refreshed domain re-publishes once and the World replacement publishes its one current
    // full snapshot through the fresh generation; other rooms stay joined.
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(presenceCount + 1)
    expect(fake.joined.has(roomId)).toBe(true)
    expect(fake.joined.has(getChatRoomId(OTHER_DOMAIN))).toBe(true)
    expect(fake.joined.has(worldRoomId)).toBe(true)
  })

  it('self-recovers an unexpectedly closed World room independently from Chat rooms', async () => {
    const { fake, roomId } = await setup()
    const worldRoomId = getWorldRoomId()

    fake.roomClose(worldRoomId)
    await settle()

    expect(fake.joined.has(worldRoomId)).toBe(true)
    expect(fake.joined.has(roomId)).toBe(true)
  })

  it('uses distinct valid generations after a World-only recovery for one AppButton replacement', async () => {
    const observer = observeDualEpochGateDispatches()
    const { fake, server, roomId } = await setup()
    observer.restore()
    const worldRoomId = getWorldRoomId()
    const worldJoinsBeforeRecovery = fake.joinCalls.filter((id) => id === worldRoomId).length

    fake.roomClose(worldRoomId)
    await vi.waitFor(() =>
      expect(fake.joinCalls.filter((id) => id === worldRoomId)).toHaveLength(worldJoinsBeforeRecovery + 1)
    )
    await settle()

    await expect(server.reconnectDomain({ domain: DOMAIN, ...callerOf(1) })).resolves.toBeUndefined()

    expect(observer.begins).toHaveLength(1)
    expect(observer.begins[0]).toMatchObject({ domain: DOMAIN })
    expect(observer.begins[0]?.chatGeneration).not.toBe(observer.begins[0]?.worldGeneration)
    expect(observer.aborts).toEqual([])
    const snapshot = await readServerSnapshot(server)
    expect(snapshot.domains[0]).toMatchObject({ chatRoomJoined: true, localSession: expect.any(Object) })
    expect(snapshot.world).toMatchObject({ joined: true })
    expect(fake.joined.has(roomId)).toBe(true)
    expect(fake.joined.has(worldRoomId)).toBe(true)
    disposeServer(server)
  })

  it('self-recovers an unexpectedly closed domain room without rebuilding World', async () => {
    const { fake, roomId } = await setup()
    const worldRoomId = getWorldRoomId()

    fake.roomClose(roomId)
    await settle()

    expect(fake.joined.has(roomId)).toBe(true)
    expect(fake.joined.has(worldRoomId)).toBe(true)
  })

  it('retries a failed Chat recovery at a bounded cadence until the room rejoins', async () => {
    const { fake, server, roomId } = await setup()
    fake.failNextJoin(roomId)

    fake.roomClose(roomId)
    await settle()
    await vi.waitFor(async () =>
      expect((await readServerSnapshot(server)).failures.map((item) => item.message)).toEqual([
        `Room "${roomId}" join failed`
      ])
    )
    expect(fake.joined.has(roomId)).toBe(false)

    await vi.advanceTimersByTimeAsync(10000)
    await settle()

    expect(fake.joined.has(roomId)).toBe(true)
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({ chatRoomJoined: true })
    expect((await readServerSnapshot(server)).failures).toHaveLength(1)
  })

  it('retries a failed World recovery at a bounded cadence until the room rejoins', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    fake.failNextJoin(worldRoomId)

    fake.roomClose(worldRoomId)
    await settle()
    await vi.waitFor(async () =>
      expect((await readServerSnapshot(server)).failures.map((item) => item.message)).toEqual([
        `Room "${worldRoomId}" join failed`
      ])
    )
    expect((await readServerSnapshot(server)).world.joined).toBe(false)

    await vi.advanceTimersByTimeAsync(10000)
    await settle()

    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    expect((await readServerSnapshot(server)).failures).toHaveLength(1)
  })

  it('retries a failed initial domain join at the bounded cadence with its preserved typed input', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const chatRoomId = getChatRoomId(DOMAIN)
    fake.failNextJoin(chatRoomId)

    await expect(server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })).rejects.toThrow()
    const joinsBefore = fake.joinCalls.filter((roomId) => roomId === chatRoomId).length

    await vi.advanceTimersByTimeAsync(10000)
    await settle()

    const joinsAfter = fake.joinCalls.filter((roomId) => roomId === chatRoomId).length
    expect(joinsAfter).toBeGreaterThan(joinsBefore)
    expect((await readServerSnapshot(server)).domains[0]).toMatchObject({
      domain: DOMAIN,
      chatRoomJoined: true,
      localSession: { user: USER }
    })
    disposeServer(server)
  })

  it('retries a failed initial World step at the same bounded cadence', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const worldRoomId = getWorldRoomId()
    fake.failNextJoin(worldRoomId)

    await expect(server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })).rejects.toThrow()
    const worldJoinsBefore = fake.joinCalls.filter((roomId) => roomId === worldRoomId).length

    await vi.advanceTimersByTimeAsync(10000)
    await settle()

    const worldJoinsAfter = fake.joinCalls.filter((roomId) => roomId === worldRoomId).length
    expect(worldJoinsAfter).toBeGreaterThan(worldJoinsBefore)
    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    disposeServer(server)
  })

  it('leaves the released Chat peer physically before publishing its World removal', async () => {
    const { clock, fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    emitRemoteWorldPresence(fake)
    await settle()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    fake.operationLog.length = 0

    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))

    const chatLeaveIndex = fake.operationLog.indexOf(`leave:${roomId}`)
    const worldRemovalIndex = fake.operationLog.indexOf(`send:${worldRoomId}`)
    expect(chatLeaveIndex).toBeGreaterThanOrEqual(0)
    expect(worldRemovalIndex).toBeGreaterThan(chatLeaveIndex)
    expect((await readServerSnapshot(server)).domains.map((item) => item.domain)).toEqual([OTHER_DOMAIN])
  })

  it('publishes the empty World snapshot before the final-site release owner closes', async () => {
    const { clock, fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    emitRemoteWorldPresence(fake)
    await settle()

    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(worldRoomId)).toBe(false))

    const finalSnapshot = fake.messages(worldRoomId).filter(isWorldPresence).at(-1)
    expect(finalSnapshot?.sites).toEqual([])
    expect(fake.operationLog.indexOf(`leave:${worldRoomId}`)).toBeGreaterThan(
      fake.operationLog.lastIndexOf(`send:${worldRoomId}`)
    )
    expect((await readServerSnapshot(server)).world.joined).toBe(false)
  })

  it("routes a Chat-domain provider error only to that domain's pages", async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()

    fake.emitError(new Error('chat-a signaling failed'), roomId)
    await settle()

    // One retained current failure fact, scoped to its exact domain; a Page presents it only
    // when its own domain matches the scope.
    expect((await readServerSnapshot(server)).failures).toEqual([
      expect.objectContaining({ message: 'chat-a signaling failed', scope: DOMAIN })
    ])
  })

  it("routes a domain-scoped failure only to that domain's current pages", async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    fake.failNextJoin(roomId)

    fake.roomClose(roomId)
    await settle()
    await vi.waitFor(async () =>
      expect((await readServerSnapshot(server)).failures.map((item) => item.message)).toEqual([
        `Room "${roomId}" join failed`
      ])
    )
    expect((await readServerSnapshot(server)).failures[0]?.scope).toBe(DOMAIN)
  })

  it('retains a Runtime failure as current state even when no affected tab is current', async () => {
    const { clock, fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    await removeServerTab(server, 1)
    fake.failNextJoin(worldRoomId)

    fake.roomClose(worldRoomId)
    await vi.waitFor(async () =>
      expect((await readServerSnapshot(server)).failures.map((item) => item.message)).toEqual([
        `Room "${worldRoomId}" join failed`
      ])
    )
  })

  it("routes a provisional domain's provider error only to its joining page", async () => {
    const { clock, fake, server } = await setup()
    const roomIdB = getChatRoomId(OTHER_DOMAIN)
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    // Keep Chat(B) provisional: the physical room joined but its session broadcast stays hung
    // before the domain commits.
    fake.plantPeer(roomIdB, 'chat-peer-b')
    fake.hangSendsTo(roomIdB)
    const joinB = server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    fake.receive(roomIdB, 'chat-peer-b', session())
    await fake.waitForSendAttempt(roomIdB)
    await settle()

    fake.emitError(new Error('chat-b provisional signaling failed'), roomIdB)
    await settle()

    expect((await readServerSnapshot(server)).failures).toEqual([
      expect.objectContaining({ message: 'chat-b provisional signaling failed', scope: OTHER_DOMAIN })
    ])

    fake.releaseSends()
    await joinB
  })

  it("routes a releasing domain's provider error away from unrelated domains", async () => {
    const { clock, fake, server, roomId } = await setup()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(getWorldRoomId())
    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    // The release closes Chat(A) and holds the final World publication, so Chat(A) stays in the
    // live-release record without any committed or prepared state.
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))

    fake.emitError(new Error('chat-a closing leave failed'), roomId)
    await settle()

    // The failure is retained once with its exact domain scope; no other domain is implicated.
    expect((await readServerSnapshot(server)).failures).toEqual([
      expect.objectContaining({ message: 'chat-a closing leave failed', scope: DOMAIN })
    ])

    diagnostic.mockRestore()
    fake.releaseSends()
    await settle()
  })

  it('coalesces overlapping finalizing-release leases into one fresh committed generation', async () => {
    const { clock, fake, server, roomId } = await setup()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(getWorldRoomId())

    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    // The release closes Chat(A) and then holds the final World publication.
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))

    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 3, url: '' } } })
    let rejectedB: unknown
    let rejectedC: unknown
    const joinB = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).catch((error: unknown) => {
      rejectedB = error
      return null
    })
    const joinC = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).catch((error: unknown) => {
      rejectedC = error
      return null
    })
    await settle()
    await settle()

    // Both leases wait behind the single closing release; neither is rejected mid-release.
    expect(rejectedB).toBeUndefined()
    expect(rejectedC).toBeUndefined()
    expect(fake.joined.has(roomId)).toBe(false)

    // The release closed Chat(A) exactly once; the waiting leases never replay its cleanup.
    expect(fake.operationLog.filter((entry) => entry === `leave:${roomId}`)).toHaveLength(1)

    fake.releaseSends()
    const [snapshotB, snapshotC] = await Promise.all([joinB, joinC])
    expect(rejectedB).toBeUndefined()
    expect(rejectedC).toBeUndefined()
    expect(snapshotB?.domains[0]).toMatchObject({ domain: DOMAIN, chatRoomJoined: true })
    expect(snapshotC?.domains[0]).toMatchObject({ domain: DOMAIN, chatRoomJoined: true })
    // Exactly one fresh physical rebuild served both coalesced leases, and still exactly one
    // Chat(A) physical exit overall.
    expect(fake.physicalJoinCalls.filter((id) => id === roomId)).toHaveLength(2)
    expect(fake.physicalJoinCalls.filter((id) => id === getWorldRoomId())).toHaveLength(2)
    expect(fake.operationLog.filter((entry) => entry === `leave:${roomId}`)).toHaveLength(1)
    expect((await readServerSnapshot(server)).domains[0].tabIds.slice().sort()).toEqual([2, 3])
  })

  it('commits a staged cross-domain join only from a World snapshot containing its own site', async () => {
    const { clock, fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(worldRoomId)

    // A's final-site release closes Chat(A) and then holds the empty final World publication.
    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    await vi.waitFor(() => expect(fake.sendAttempts.some((attempt) => attempt.roomId === worldRoomId)).toBe(true))

    // B stages on a different domain while the empty final publication is still in flight.
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    let rejectedB: unknown
    const joinB = server
      .joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
      .catch((error: unknown) => {
        rejectedB = error
        return null
      })
    await settle()
    await settle()
    // B must not become ready from the pending empty snapshot.
    expect(rejectedB).toBeUndefined()
    expect(
      (await readServerSnapshot(server)).domains.find((item) => item.domain === OTHER_DOMAIN)?.chatRoomJoined ?? false
    ).toBe(false)

    fake.releaseSends()
    const snapshotB = await joinB
    expect(rejectedB).toBeUndefined()
    expect(snapshotB?.domains.find((item) => item.domain === OTHER_DOMAIN)).toMatchObject({
      chatRoomJoined: true
    })

    // The wire publication that accepted B carries B's own site; the empty final snapshot only
    // settled A's release facts.
    const publications = fake.messages(worldRoomId).filter(isWorldPresence)
    const emptyFinalIndex = publications.findIndex((message) => message.sites.length === 0)
    const acceptingIndex = publications.findIndex((message) =>
      message.sites.some((site) => site.origin === OTHER_DOMAIN)
    )
    expect(emptyFinalIndex).toBeGreaterThanOrEqual(0)
    expect(acceptingIndex).toBeGreaterThan(emptyFinalIndex)
    expect(acceptingIndex).toBe(publications.length - 1)
  })

  it('attaches a late lease to a pending cleanup without a redundant write or false failure', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let cleanupWrites = 0
    const cleanupStarted = deferred<void>()
    const releaseCleanup = deferred<void>()
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as { local?: unknown } | undefined
        // The release cleanup save carries no local record; active-record saves always do.
        if (record && typeof record === 'object' && !('local' in record)) {
          cleanupWrites += 1
          if (cleanupWrites === 1) {
            cleanupStarted.resolve()
            await releaseCleanup.promise
          } else {
            throw new Error('redundant cleanup failed')
          }
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const roomId = getChatRoomId(DOMAIN)
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(getWorldRoomId())

    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    // The release's authoritative cleanup write is in flight (held).
    await cleanupStarted.promise

    // A late same-domain lease attaches behind the pending cleanup without re-issuing it.
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })
    let rejectedB: unknown
    const joinB = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).catch((error: unknown) => {
      rejectedB = error
      return null
    })
    await settle()
    await settle()
    expect(cleanupWrites).toBe(1)

    // The authoritative cleanup succeeds; the World removal stays held.
    releaseCleanup.resolve()
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    await settle()
    expect(cleanupWrites).toBe(1)
    expect(rejectedB).toBeUndefined()

    fake.releaseSends()
    const snapshotB = await joinB
    expect(rejectedB).toBeUndefined()
    expect(snapshotB?.domains[0]).toMatchObject({ domain: DOMAIN, chatRoomJoined: true })
    expect(cleanupWrites).toBe(1)
    disposeServer(server)
  })

  it('rolls back the World projection when a deferred follow-up publication aborts', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    let failFollowUpEncode = false
    const codec: WireCodec = {
      encode: async (value) => {
        const message = value as { sites?: { origin: string }[] }
        if (failFollowUpEncode && message.sites?.some((site) => site.origin === OTHER_DOMAIN)) {
          throw new Error('follow-up encode failed')
        }
        return JSON.stringify(value)
      },
      decode: async (payload) => JSON.parse(payload)
    }
    const server = createServer({ transport: fake.transport, clock, codec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(worldRoomId)

    // A's final-site release closes Chat(A) and holds the empty final World publication.
    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    await vi.waitFor(() => expect(fake.sendAttempts.some((attempt) => attempt.roomId === worldRoomId)).toBe(true))

    // B stages on a different domain; its follow-up snapshot will fail before any provider send.
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    let rejectedB: unknown
    const joinB = server
      .joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
      .catch((error: unknown) => {
        rejectedB = error
        return null
      })
    await settle()
    await settle()
    failFollowUpEncode = true
    fake.releaseSends()

    await joinB
    expect(rejectedB).toEqual(new Error('follow-up encode failed'))
    await vi.waitFor(() => expect(fake.joined.has(worldRoomId)).toBe(false))
    // The abort was the last World owner: the projection settles the same terminal truth as final
    // World departure instead of a false joined state with stale remote presences.
    const world = (await readServerSnapshot(server)).world
    expect(world.joined).toBe(false)
    expect(world.presences).toEqual([])
    expect(world.localPresence).toBeUndefined()
    disposeServer(server)
  })

  it('retains live remote World presence across ordinary same-domain supersession', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    // Hold the first cold join's World publication after the physical rooms join.
    fake.plantPeer(roomId, 'chat-peer')
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)
    fake.open()
    fake.receive(roomId, 'chat-peer', session())
    await worldSendAttempt

    // A live remote World presence arrives while the first join is provisional.
    emitRemoteWorldPresence(fake)
    await settle()
    expect((await readServerSnapshot(server)).world.presences.map((item) => item.sourcePeerId)).toContain('remote-peer')

    // Supersede with a new same-domain join; the physical World owner stays live throughout.
    const refreshedUser = { ...USER, name: 'Refreshed' }
    const secondJoin = server.joinChatRoom({ domain: DOMAIN, user: refreshedUser, site: SITE })
    await expect(firstJoin).resolves.toBeNull()

    fake.releaseSends()
    const snapshot = await secondJoin
    if (!snapshot) throw new Error('Join was cancelled')

    expect(snapshot.domains[0]).toMatchObject({ domain: DOMAIN, chatRoomJoined: true })
    expect(fake.joined.has(worldRoomId)).toBe(true)
    expect((await readServerSnapshot(server)).world.presences).toEqual([
      expect.objectContaining({ sourcePeerId: 'remote-peer' })
    ])
    disposeServer(server)
  })

  it('retains another domain live final release World ownership across a provisional Chat failure', async () => {
    const { clock, fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(worldRoomId)

    // A's final-site release closes Chat(A) and holds the empty final World publication.
    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    await vi.waitFor(() => expect(fake.sendAttempts.some((attempt) => attempt.roomId === worldRoomId)).toBe(true))

    // B's independent provisional Chat join fails while A's release continuation and pending
    // final publication still own the physical World owner.
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    fake.failNextJoin(getChatRoomId(OTHER_DOMAIN))
    const joinB = server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await expect(joinB).rejects.toThrow(`Room "${getChatRoomId(OTHER_DOMAIN)}" join failed`)
    await settle()

    // The departure decision must respect exact World demand: A's live release keeps the room.
    expect(fake.joined.has(worldRoomId)).toBe(true)

    fake.releaseSends()
    await vi.waitFor(() => expect(fake.joined.has(worldRoomId)).toBe(false))
    expect(fake.messages(worldRoomId).filter(isWorldPresence).at(-1)?.sites).toEqual([])
    disposeServer(server)
  })
})

describe('RuntimeServer provisional recovery races', () => {
  it('catches up every World peer exactly once across iterator, pending, join, and discovery paths', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    // A held World publication keeps the staged join pending while a remote World member lands.
    fake.plantPeer(roomId, 'chat-peer')
    fake.plantPeer(worldRoomId, 'early-peer')
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForDesiredRooms(2)

    fake.open()
    fake.receive(roomId, 'chat-peer', session())
    await worldSendAttempt
    emitRemoteWorldPresence(fake, 'early-peer')
    await settle()
    await settle()
    // The World wire remains held so the publication iterator stays pending while another peer joins.
    fake.peerJoin(worldRoomId, 'mid-peer')
    await settle()
    expect(sentToPeer(fake, worldRoomId, 'mid-peer')).toEqual([])

    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()

    const currentPresence = snapshot.world.localPresence
    if (!currentPresence) throw new Error('Committed local presence missing')
    expect(sentToPeer(fake, worldRoomId, 'early-peer')).toEqual([currentPresence])
    expect(sentToPeer(fake, worldRoomId, 'mid-peer')).toEqual([currentPresence])
    expect(snapshot.domains[0]?.localSession?.user).toEqual(USER)
    expect(snapshot.world.localPresence?.user).toEqual(USER)

    fake.peerJoin(worldRoomId, 'late-peer')
    await settle()
    expect(sentToPeer(fake, worldRoomId, 'late-peer')).toEqual([currentPresence])
    // Opposite control: a World catch-up is explicitly targeted to the newly active peer.
    const catchUpAttempt = fake.sendAttempts.findLast((a) => a.roomId === worldRoomId && Array.isArray(a.rawTarget))
    expect(catchUpAttempt).toBeDefined()
    expect(catchUpAttempt?.rawTarget).toEqual(['late-peer'])

    emitRemoteWorldPresence(fake, 'discovered-peer')
    await settle()
    expect(sentToPeer(fake, worldRoomId, 'discovered-peer')).toEqual([currentPresence])
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(4)
  })

  it('discards peer catch-up owned by a superseded provisional join', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    // Hold the first attempt's World publication so the peer join lands inside its pending window.
    fake.plantPeer(roomId, 'chat-peer')
    fake.hangSendsTo(roomId)
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)
    fake.open()
    fake.receive(roomId, 'chat-peer', session())
    await worldSendAttempt

    fake.peerJoin(roomId, 'stale-peer')
    fake.peerJoin(worldRoomId, 'stale-peer')
    await settle()
    const refreshedUser = { ...USER, name: 'Refreshed' }
    const replacement = server.joinChatRoom({ domain: DOMAIN, user: refreshedUser, site: SITE })
    await settle()
    fake.releaseSends()

    await expect(firstJoin).resolves.toBeNull()
    await expect(replacement).resolves.toMatchObject({
      domains: [expect.objectContaining({ localSession: expect.objectContaining({ user: refreshedUser }) })]
    })
    await settle()
    // The superseded attempt never commits, so the peer can only receive the replacement identity.
    const staleChatSessions = sentToPeer(fake, roomId, 'stale-peer')
    expect(staleChatSessions).toEqual([])
    // The superseded attempt never commits, so the peer can only receive the replacement identity,
    // exactly once, as a current World Room target.
    expect(sentToPeer(fake, worldRoomId, 'stale-peer')).toEqual([
      expect.objectContaining({ user: expect.objectContaining({ name: 'Refreshed' }) })
    ])
  })

  it('cleans provisional History ownership before a same-source retry', async () => {
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock: new FakeClock(), codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        return new Promise<HistorySupplyResult>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelled.push(request.syncId)
              reject(signal.reason ?? new Error('History supply cancelled'))
            },
            { once: true }
          )
        })
      }
    )

    fake.plantPeer(roomId, 'history-peer')
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      () => null
    )
    await fake.waitForDesiredRooms(2)
    fake.open()
    await worldSendAttempt

    fake.receive(roomId, 'history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'provisional-pull',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['provisional-pull']))

    const replacement = server.joinChatRoom({
      domain: DOMAIN,
      user: { ...USER, name: 'Retried' },
      site: SITE
    })
    await settle()
    fake.releaseSends()
    await expect(firstJoin).resolves.toBeNull()
    const replacementSnapshot = await replacement
    expect(replacementSnapshot?.domains[0]?.localSession?.user.name).toBe('Retried')

    await vi.waitFor(() => expect(cancelled).toEqual(['provisional-pull']))
    fake.receive(roomId, 'history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'fresh-pull',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['provisional-pull', 'fresh-pull']))
    disposeServer(server)
  })

  it('preserves a committed History owner while a replacement attempt is superseded', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        return new Promise<HistorySupplyResult>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelled.push(request.syncId)
              reject(signal.reason ?? new Error('History supply cancelled'))
            },
            { once: true }
          )
        })
      }
    )
    fake.receive(roomId, 'committed-history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'committed-pull',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['committed-pull']))

    fake.plantPeer(worldRoomId, 'world-peer')
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const firstReplacement = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await worldSendAttempt
    const secondReplacement = server.joinChatRoom({
      domain: DOMAIN,
      user: { ...USER, name: 'Second replacement' },
      site: SITE
    })
    await settle()
    fake.releaseSends()

    await expect(firstReplacement).resolves.toBeNull()
    const snapshot = await secondReplacement
    expect(snapshot?.domains[0]?.localSession?.user.name).toBe('Second replacement')
    expect(cancelled).toEqual([])
    disposeServer(server)
  })

  it('cleans provisional History on domain release before commit and allows a same-source retry', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })

    const started: string[] = []
    const cancelled: string[] = []
    const installProvider = () =>
      registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        return new Promise<HistorySupplyResult>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelled.push(request.syncId)
              reject(signal.reason ?? new Error('History supply cancelled'))
            },
            { once: true }
          )
        })
      })
    await installProvider()

    fake.plantPeer(roomId, 'grace-history-peer')
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      () => null
    )
    await fake.waitForDesiredRooms(2)
    fake.open()
    await worldSendAttempt

    fake.receive(roomId, 'grace-history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'grace-pull',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['grace-pull']))

    // The last page detaches while the combined Chat+World attempt is still provisional; grace
    // expiry releases the attempt and must cancel its History owner before the domain disappears.
    await removeServerTab(server, 1)
    await vi.advanceTimersByTimeAsync(RUNTIME_DOMAIN_GRACE_MS)
    await settle()
    fake.releaseSends()
    await expect(firstJoin).resolves.toBeNull()
    await vi.waitFor(() => expect(cancelled).toEqual(['grace-pull']))

    // A fresh page lease and same-source Pull must bind a new History incarnation after release.
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await installProvider()
    const retry = server.joinChatRoom({ domain: DOMAIN, user: { ...USER, name: 'Retried after grace' }, site: SITE })
    await retry
    fake.receive(roomId, 'grace-history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'fresh-after-grace',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['grace-pull', 'fresh-after-grace']))
    disposeServer(server)
  })

  it('cancels a deferred peer after leave before commit and preserves the current peer opposite', async () => {
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock: new FakeClock(), codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => ({
      records: [],
      done: true
    }))

    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForDesiredRooms(2)
    fake.open()
    await worldSendAttempt

    fake.peerJoin(roomId, 'leaving-peer')
    fake.peerJoin(roomId, 'current-peer')
    await settle()
    fake.peerLeave(roomId, 'leaving-peer')
    await settle()

    fake.releaseSends()
    await join
    await vi.waitFor(() => {
      expect(sentToPeer(fake, roomId, 'current-peer')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: MESSAGE_TYPE.SESSION }),
          expect.objectContaining({ type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL })
        ])
      )
    })

    const leavingMessages = sentToPeer(fake, roomId, 'leaving-peer').filter(
      (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
    )
    expect(leavingMessages).toEqual([])
    const currentMessages = sentToPeer(fake, roomId, 'current-peer').filter(
      (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
    )
    expect(currentMessages.filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(1)
    expect(currentMessages.filter((message) => message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toHaveLength(1)
    disposeServer(server)
  })

  it('keeps reconnect inbound sessions attempt-owned until replacement commit', async () => {
    const { fake, server, roomId } = await setup()
    // A current room member becomes the provisional publication's distinct target.
    fake.plantPeer(roomId, 'chat-peer')
    fake.makeNotReady()
    const worldRoomId = getWorldRoomId()
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    fake.peerJoin(roomId, 'remote-peer')
    // The provisional World publication is hung at the provider while the remote session lands.
    await expect(worldSendAttempt).resolves.toMatchObject({ roomId: worldRoomId })
    fake.receive(roomId, 'remote-peer', session())
    await settle()
    const sessionsBeforeCommit = (await readServerSnapshot(server)).domains[0].sessions
    fake.releaseSends()
    await reconnect
    await settle()

    expect
      .soft(sessionsBeforeCommit)
      .toEqual([expect.objectContaining({ sourcePeerId: 'remote-peer', user: REMOTE_USER })])
    expect((await readServerSnapshot(server)).domains[0].sessions).toEqual([
      expect.objectContaining({ sourcePeerId: 'remote-peer', user: REMOTE_USER })
    ])
  })

  it('discards remote sessions owned by a superseded provisional reconnect', async () => {
    const { fake, server, roomId } = await setup()
    // A current room member becomes the provisional publication's distinct target.
    fake.plantPeer(roomId, 'chat-peer')
    fake.makeNotReady()
    const worldRoomId = getWorldRoomId()
    fake.hangSendsTo(worldRoomId)
    const worldSendAttempt = fake.waitForSendAttempt(worldRoomId)
    const firstReconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    fake.receive(roomId, 'stale-remote-peer', session())
    await expect(worldSendAttempt).resolves.toMatchObject({ roomId: worldRoomId })
    await settle()
    const retainedBeforeSupersede = (await readServerSnapshot(server)).domains[0].sessions
    const replacement = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await expect(firstReconnect).resolves.toBeUndefined()
    await settle()
    const retainedAfterSupersede = (await readServerSnapshot(server)).domains[0].sessions

    fake.releaseSends()
    const replacementSnapshot = await replacement
    if (!replacementSnapshot) throw new Error('Join was cancelled')
    await settle()

    expect.soft(retainedBeforeSupersede).toEqual([])
    expect.soft(retainedAfterSupersede).toEqual([])
    expect(replacementSnapshot.domains[0]).toMatchObject({
      chatRoomJoined: true,
      localSession: { user: USER },
      sessions: []
    })
    expect((await readServerSnapshot(server)).domains[0].sessions).toEqual([])
  })

  it('sends one Session and one History Pull to a peer admitted by the replacement generation', async () => {
    const { fake, server, roomId } = await setup()
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => ({
      records: [],
      done: true
    }))
    const worldRoomId = getWorldRoomId()
    fake.makeNotReady()
    fake.hangSendsTo(worldRoomId)
    const firstWorldSend = fake.waitForSendAttempt(worldRoomId)
    const firstReconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await firstWorldSend

    const replacement = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await expect(firstReconnect).resolves.toBeUndefined()
    await fake.waitForJoinCalls(6)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(true))

    fake.peerJoin(roomId, 'replacement-peer')
    await settle()
    expect(
      sentToPeer(fake, roomId, 'replacement-peer').filter(
        (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
      )
    ).toEqual([])

    fake.releaseSends()
    await replacement
    await vi.waitFor(() => {
      const messages = sentToPeer(fake, roomId, 'replacement-peer').filter(
        (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
      )
      expect(messages).toHaveLength(2)
    })
    const messages = sentToPeer(fake, roomId, 'replacement-peer').filter(
      (message) => message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
    )
    expect(messages.filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(1)
    expect(messages.filter((message) => message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toHaveLength(1)
    disposeServer(server)
  })

  it('catches up only peers that miss a provisional World recovery publication', async () => {
    const { clock, fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    const currentPresence = (await readServerSnapshot(server)).world.localPresence
    if (!currentPresence) throw new Error('Committed local presence missing')
    // A known remote presence is active for the recovery-iterator publication.
    emitRemoteWorldPresence(fake)
    await settle()
    expect(sentToPeer(fake, worldRoomId, 'remote-peer')).toEqual([currentPresence])
    fake.makeNotReady()

    fake.roomClose(worldRoomId)
    await fake.waitForJoinCalls(3)
    expect((await readServerSnapshot(server)).world.joined).toBe(false)
    fake.hangSendsTo(worldRoomId)
    fake.open()
    await fake.waitForSendAttempt(worldRoomId)
    fake.peerJoin(worldRoomId, 'missed-peer')
    await settle()

    expect((await readServerSnapshot(server)).world.joined).toBe(false)
    expect(sentToPeer(fake, worldRoomId, 'missed-peer')).toEqual([])
    // The committed local presence fact survives the provisional recovery window.
    expect((await readServerSnapshot(server)).world.localPresence).toEqual(currentPresence)

    fake.releaseSends()
    await settle()

    expect((await readServerSnapshot(server)).world.joined).toBe(true)
    // The recovery revision was broadcast exactly once more, and the peer that
    // joined mid-publication receives exactly one catch-up at commit.
    expect(sentToPeer(fake, worldRoomId, 'remote-peer')).toEqual([currentPresence, currentPresence])
    expect(sentToPeer(fake, worldRoomId, 'missed-peer')).toEqual([currentPresence])
    expect((await readServerSnapshot(server)).world.localPresence).toEqual(currentPresence)
  })

  it('fences a timed-out World rejoin or republishes before late-open commitment', async () => {
    const { clock, fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    const presenceCount = fake.messages(worldRoomId).filter(isWorldPresence).length
    fake.makeNotReady()

    fake.roomClose(worldRoomId)
    await fake.waitForJoinCalls(3)
    clock.advance(PHYSICAL_ROOM_JOIN_TIMEOUT_MS + 1)
    await settle()
    expect.soft(fake.joined.has(worldRoomId)).toBe(false)
    expect.soft((await readServerSnapshot(server)).world.joined).toBe(false)
    expect.soft(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(presenceCount)
    fake.open()
    await settle()

    const outcome = {
      physicalJoined: fake.joined.has(worldRoomId),
      logicalDesired: fake.desired.has(worldRoomId),
      snapshotJoined: (await readServerSnapshot(server)).world.joined,
      presenceDelta: fake.messages(worldRoomId).filter(isWorldPresence).length - presenceCount
    }
    expect([
      { physicalJoined: false, logicalDesired: false, snapshotJoined: false, presenceDelta: 0 },
      { physicalJoined: true, logicalDesired: true, snapshotJoined: true, presenceDelta: 1 }
    ]).toContainEqual(outcome)
  })
})

describe('RuntimeServer trusted delivery', () => {
  it('projects the current domain session snapshot on every current-state read', async () => {
    const { server } = await setup()
    const first = await readServerSnapshot(server)
    const replacement = await readServerSnapshot(server)

    expect(first.domains[0]).toMatchObject({
      domain: DOMAIN,
      localSession: expect.objectContaining({ user: USER })
    })
    // Reads are pure: the same current authority answers every pull without side effects.
    expect(replacement.domains[0]?.localSession?.sessionId).toBe(first.domains[0]?.localSession?.sessionId)
    disposeServer(server)
  })

  it('binds live authors to the transport source session and ignores payload identity claims', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-a', session(REMOTE_USER))
    fake.receive(roomId, 'peer-a', text('forged', 'somebody-else'))
    fake.receive(roomId, 'peer-a', { ...text('extra-field'), peerId: 'peer-b' })
    fake.receive(roomId, 'peer-a', text('valid'))
    await settle()

    expect(await projectedInboundIds(server)).toEqual(['valid'])
  })

  it('binds logical identity while accepting only same-generation user projection refreshes', async () => {
    const { fake, server, roomId } = await setup()
    const accepted = session(REMOTE_USER)
    const refreshedUser = { ...REMOTE_USER, name: 'Refreshed remote' }

    fake.receive(roomId, 'peer-a', accepted)
    fake.receive(roomId, 'peer-a', { ...accepted, user: refreshedUser })
    fake.receive(roomId, 'peer-a', { ...accepted, user: { ...refreshedUser, id: 'forged-user' } })
    fake.receive(roomId, 'peer-a', { ...accepted, joinedAt: accepted.joinedAt + 1 })
    fake.receive(roomId, 'peer-a', { ...accepted, joinedAt: undefined } as unknown as TestWireMessage)
    await settle()

    expect((await readServerSnapshot(server)).domains[0].sessions).toEqual([
      expect.objectContaining({
        sourcePeerId: 'peer-a',
        sessionId: accepted.sessionId,
        joinedAt: accepted.joinedAt,
        user: refreshedUser
      })
    ])
  })

  it('drops old-only and old-plus-new wire keys before page projection', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-a', session())

    const legacyMention = { ...text('legacy-mention'), mentions: [{ ...REMOTE_USER, positions: [[0, 0]] }] }
    const dualMention = {
      ...text('dual-mention'),
      mentions: [{ ...REMOTE_USER, ranges: [[0, 0]], positions: [[0, 0]] }]
    }
    const legacyRequest = { type: 'history-request', requestId: 'legacy-sync' }
    const dualRequest = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'current-sync',
      page: 0,
      messageIds: [],
      done: true,
      requestId: 'legacy'
    }
    const legacyResponse = {
      type: 'history-response',
      requestId: 'legacy-sync',
      users: [REMOTE_USER],
      events: [text('legacy-history')],
      done: true
    }
    const dualResponse = { ...legacyResponse, syncId: 'current-sync', messages: legacyResponse.events }
    ;[legacyMention, dualMention, legacyRequest, dualRequest, legacyResponse, dualResponse].forEach((invalid) =>
      fake.receive(roomId, 'peer-a', invalid as unknown as TestWireMessage)
    )
    fake.receive(roomId, 'peer-a', text('valid-after-rejections'))
    await settle()

    expect(await projectedInboundIds(server)).toEqual(['valid-after-rejections'])
  })

  it('accepts any safe HLC at receive (time rules are not declaratively expressible)', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', text('future', REMOTE_USER.id, NOW + 5 * 60 * 1000 + 1))
    fake.receive(roomId, 'peer-a', {
      ...text('counter-overflow'),
      hlc: { timestamp: NOW, counter: Number.MAX_SAFE_INTEGER }
    })
    fake.receive(roomId, 'peer-a', text('valid'))
    await settle()

    // The declarative schema accepts every safe non-negative integer HLC; the receiver-time
    // future rule is not expressible and is therefore not validated.
    expect(await projectedInboundIds(server)).toEqual(['future', 'counter-overflow', 'valid'])
    const local = await server.allocateTextMessage({ domain: DOMAIN, body: 'next', mentions: [] })
    expect(local.message.hlc.timestamp).toBe(NOW + 5 * 60 * 1000 + 1)
  })

  it('clears buffered events only after a page ACK and treats duplicate ACK as idempotent', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', text('one'))
    fake.receive(roomId, 'peer-a', text('two', REMOTE_USER.id, NOW + 1))
    await settle()

    await server.ackInbound({ domain: DOMAIN, sequence: 2, inserted: false })
    await server.ackInbound({ domain: DOMAIN, sequence: 2, inserted: false })
    expect(await projectedInboundIds(server)).toEqual(['one'])

    await server.ackInbound({ domain: DOMAIN, sequence: 1, inserted: false })
    expect(await projectedInboundIds(server)).toEqual([])
  })
})

describe('RuntimeServer send reliability', () => {
  it('reaches the step-4 gate with zero peers: join+trusted+commit complete and a first TEXT reaches the provider exactly once', async () => {
    const { fake, server, roomId } = await setup()
    // No peers are planted, no session()/History is supplied: the whole join must complete on its own.

    const snapshot = await readServerSnapshot(server)
    const domain = snapshot.domains.find((item) => item.domain === DOMAIN)
    expect(domain?.phase).toBe('active')
    expect(domain?.chatRoomJoined).toBe(true)
    expect(domain?.localSession?.user.id).toBe(USER.id)

    // The room is trusted with zero members: a freshly allocated TEXT is accepted and reaches the
    // provider exactly once through the empty-member no-op broadcast with its exact identity.
    const record = await server.allocateTextMessage({ domain: DOMAIN, body: 'zero peers', mentions: [] })
    await expect(server.sendChatMessage({ domain: DOMAIN, event: record.message })).resolves.toBe(record.message)
    await settle()

    const attempts = fake.sent.filter(
      (item) => item.roomId === roomId && JSON.parse(item.payload).type === MESSAGE_TYPE.TEXT
    )
    expect(attempts).toHaveLength(1)
    expect(attempts[0].to).toEqual([])
    expect(JSON.parse(attempts[0].payload).id).toBe(record.message.id)
    disposeServer(server)
  })

  it('accepts later protocol-valid texts without waiting for an earlier transport settlement', async () => {
    const { fake, server, roomId } = await setup()
    // A current member makes the room-wide sends reach the provider; the caller settlement
    // still comes from local acceptance, not from transport completion.
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.hangSendsTo(roomId)
    const first = await server.allocateTextMessage({ domain: DOMAIN, body: 'first', mentions: [] })
    const second = await server.allocateTextMessage({ domain: DOMAIN, body: 'second', mentions: [] })
    const settled: string[] = []

    const firstTask = server
      .sendChatMessage({ domain: DOMAIN, event: first.message })
      .then(() => settled.push(first.message.id))
    await fake.waitForSendAttempt(roomId)
    const secondTask = server
      .sendChatMessage({ domain: DOMAIN, event: second.message })
      .then(() => settled.push(second.message.id))
    await settle()

    try {
      expect(settled).toEqual([first.message.id, second.message.id])
    } finally {
      fake.releaseSends()
      await Promise.all([firstTask, secondTask])
    }
  })

  it.each([MESSAGE_TYPE.TEXT, MESSAGE_TYPE.REACTION])(
    'broadcasts a room-wide %s send natively to the current room members',
    async (messageType) => {
      const { fake, server, roomId } = await setup()
      fake.plantPeer(roomId, 'peer-a')
      fake.receive(roomId, 'peer-a', session())
      await settle()
      const record =
        messageType === MESSAGE_TYPE.TEXT
          ? await server.allocateTextMessage({ domain: DOMAIN, body: 'outbound', mentions: [] })
          : await server.allocateReactionMessage({ domain: DOMAIN, targetId: 'target', reaction: 'like', active: true })

      await server.sendChatMessage({ domain: DOMAIN, event: record.message })

      const attempt = fake.sendAttempts.find((item) => JSON.parse(item.payload).type === messageType)
      expect(attempt).toBeDefined()
      expect(attempt?.to).toEqual(['peer-a'])
      expect(attempt?.rawTarget).toBeUndefined()
      expect(fake.messages(roomId).filter((message) => message.type === messageType)).toHaveLength(1)
    }
  )

  it('accepts text before a transport failure while retaining the Runtime error owner', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const record = await server.allocateTextMessage({ domain: DOMAIN, body: 'outbound', mentions: [] })

    await server.sendChatMessage({ domain: DOMAIN, event: record.message })
    await settle()
    expect(fake.messages(roomId).some((message) => message.type === MESSAGE_TYPE.TEXT)).toBe(true)
    expect(fake.sent.find((message) => JSON.parse(message.payload).type === MESSAGE_TYPE.TEXT)?.to).toEqual(['peer-a'])
    expect((await readServerSnapshot(server)).failures).toEqual([])

    fake.failSend(new Error('partial send'))
    await expect(server.sendChatMessage({ domain: DOMAIN, event: record.message })).resolves.toBe(record.message)
    await settle()
    expect((await readServerSnapshot(server)).failures.map((item) => item.message)).toEqual(['partial send'])
    const next = await server.allocateTextMessage({ domain: DOMAIN, body: 'next', mentions: [] })
    expect(next.message.hlc).toEqual({ timestamp: NOW, counter: 1 })
  })

  it.each([MESSAGE_TYPE.TEXT, MESSAGE_TYPE.REACTION])(
    'resumes a queued room-wide %s send after recovery and broadcasts to the then-active members',
    async (messageType) => {
      const { fake, server, roomId } = await setup()
      const oldUser = { id: 'old-user', name: 'Old', avatar: '' }
      const newUser = { id: 'new-user', name: 'New', avatar: '' }
      fake.peerJoin(roomId, 'peer-old')
      fake.receive(roomId, 'peer-old', session(oldUser))
      await settle()
      const record =
        messageType === MESSAGE_TYPE.TEXT
          ? await server.allocateTextMessage({ domain: DOMAIN, body: 'queued', mentions: [] })
          : await server.allocateReactionMessage({ domain: DOMAIN, targetId: 'target', reaction: 'like', active: true })

      fake.roomClose(roomId)
      const sending = server.sendChatMessage({ domain: DOMAIN, event: record.message })
      await sending
      await vi.waitFor(() => {
        const attempt = fake.sendAttempts.find((item) => JSON.parse(item.payload).type === messageType)
        expect(attempt?.to).toEqual(['peer-old'])
      })

      // Membership churn after the send never causes a re-send: no retry, outbox, or target
      // re-derivation exists.
      fake.peerLeave(roomId, 'peer-old')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      fake.peerJoin(roomId, 'peer-new')
      fake.receive(roomId, 'peer-new', session(newUser))
      await settle()
      expect(fake.sendAttempts.filter((item) => JSON.parse(item.payload).type === messageType)).toHaveLength(1)
      disposeServer(server)
    }
  )

  it('keeps reaction transport failure in the caller settlement', async () => {
    const { fake, server, roomId } = await setup()
    // A current member makes the room-wide reaction reach the provider so its failure can
    // settle the caller.
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const record = await server.allocateReactionMessage({
      domain: DOMAIN,
      targetId: 'target',
      reaction: 'like',
      active: true
    })
    const transportError = new Error('reaction transport failed')
    fake.failSend(transportError)

    await expect(server.sendChatMessage({ domain: DOMAIN, event: record.message })).rejects.toBe(transportError)
  })

  it('rejects protocol-invalid text before any wire attempt', async () => {
    const { fake, server } = await setup()
    const record = await server.allocateTextMessage({ domain: DOMAIN, body: 'valid', mentions: [] })
    const attemptsBefore = fake.sendAttempts.length
    const invalid = { ...record.message, body: 1 } as unknown as ChatMessage

    await expect(server.sendChatMessage({ domain: DOMAIN, event: invalid })).rejects.toThrow('Invalid message.')
    expect(fake.sendAttempts).toHaveLength(attemptsBefore)
  })
})

describe('RuntimeServer World presence', () => {
  it('emits the updated local presence to existing pages after a second domain joins', async () => {
    const { fake, server } = await setup()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    // A live remote peer is the recipients of each committed revision's native broadcast.
    emitRemoteWorldPresence(fake)
    await settle()

    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()

    const localPresence = (await readServerSnapshot(server)).world.localPresence
    expect(localPresence?.user).toEqual(USER)
    expect(Object.keys(localPresence?.user ?? {})).toEqual(['id', 'name', 'avatar'])
    expect(localPresence?.sites).toEqual([SITE, { origin: OTHER_DOMAIN }])

    const outgoing = fake.messages(getWorldRoomId()).filter(isWorldPresence)
    expect(outgoing).toHaveLength(3)
    const outgoingAttempts = fake.sendAttempts.filter((attempt) => attempt.roomId === getWorldRoomId())
    expect(outgoingAttempts.map((attempt) => attempt.to)).toEqual([[], ['remote-peer'], ['remote-peer']])
    expect(localPresence).toEqual(outgoing.at(-1))
  })

  it('surfaces a World target failure and still settles the revision and join', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    // A known remote peer receives the second-domain revision's native broadcast.
    emitRemoteWorldPresence(fake)
    await settle()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 2, url: '' } } })
    fake.failSend(new Error('world send failed'), worldRoomId)

    const snapshot = await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    if (!snapshot) throw new Error('Join was cancelled')

    expect(snapshot.domains.map((domain) => domain.domain)).toEqual([DOMAIN, OTHER_DOMAIN])
    expect((await readServerSnapshot(server)).failures.map((item) => item.message)).toEqual(['world send failed'])
    expect((await readServerSnapshot(server)).world.localPresence?.sites).toEqual([SITE, { origin: OTHER_DOMAIN }])
  })

  it('publishes full privacy-bounded snapshots and atomically replaces/deletes remote presence', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    // A live remote peer is the recipients of each committed revision's native broadcast.
    emitRemoteWorldPresence(fake)
    await settle()
    await server.attachPage({ domain: OTHER_DOMAIN, caller: { tab: { id: 4, url: '' } } })
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { origin: OTHER_DOMAIN, description: 'Other' }
    })
    await settle()

    const outgoing = fake.messages(worldRoomId).filter(isWorldPresence).at(-1)!
    expect(outgoing.sites).toEqual([SITE, { origin: OTHER_DOMAIN, description: 'Other' }])
    expect(JSON.stringify(outgoing)).not.toMatch(/hostname|href/)

    const first = { sessionId: 'world-1', user: REMOTE_USER, sites: [{ origin: DOMAIN }] }
    const second = {
      sessionId: 'world-1',
      user: REMOTE_USER,
      sites: [{ origin: OTHER_DOMAIN }]
    }
    fake.receive(worldRoomId, 'peer-a', first)
    await settle()
    expect((await readServerSnapshot(server)).world.presences).toContainEqual(
      expect.objectContaining({
        sourcePeerId: 'peer-a',
        presence: expect.objectContaining({ sites: [{ origin: DOMAIN }] })
      })
    )
    // A replacement atomically replaces the remote contribution; a departure deletes it.
    fake.receive(worldRoomId, 'peer-a', second)
    await settle()
    expect((await readServerSnapshot(server)).world.presences).toContainEqual(
      expect.objectContaining({
        sourcePeerId: 'peer-a',
        presence: expect.objectContaining({ sites: [{ origin: OTHER_DOMAIN }] })
      })
    )
    fake.peerLeave(worldRoomId, 'peer-a')
    await settle()
    expect((await readServerSnapshot(server)).world.presences.map((item) => item.sourcePeerId)).not.toContain('peer-a')
  })
})

describe('RuntimeServer concurrent World registration convergence', () => {
  const createConvergenceFixture = (options: { failFirstPublication?: boolean } = {}) => {
    const attempts: Array<{ message: WorldRoomMessage; settle: ReturnType<typeof deferred<void>> }> = []
    const accepted: WorldRoomMessage[] = []
    const joinCalls: string[] = []
    const leave = vi.fn()
    let closeListener: ((roomId: string) => void) | null = null
    let peerJoinListener: ((roomId: string, sourcePeerId: string) => void) | null = null
    let joinGate: Promise<void> | null = null
    let releaseJoinGate = () => {}
    const transport: RoomTransport = {
      peerIdOf: () => 'local-peer',
      join: async (roomId) => {
        joinCalls.push(roomId)
        if (joinGate) await joinGate
      },
      leave,
      retireRoomsForPreparation: async () => {},
      send: async (roomId, payload) => {
        if (roomId !== getWorldRoomId()) return
        const message = JSON.parse(payload) as WorldRoomMessage
        const settle = deferred<void>()
        attempts.push({ message, settle })
        if (options.failFirstPublication && attempts.length === 1) throw new Error('first World publication failed')
        await settle.promise
        accepted.push(message)
      },
      onMessage: () => () => {},
      onPeerJoin: (callback) => {
        peerJoinListener = callback
        return () => {
          peerJoinListener = null
        }
      },
      onPeerLeave: () => () => {},
      onRoomClose: (callback) => {
        closeListener = callback
        return () => {
          closeListener = null
        }
      },
      onError: () => () => {},
      dispose: vi.fn()
    }
    const flush = async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    }
    const server = createServer({ transport, codec: jsonCodec, clock: new FakeClock() })
    return {
      server,
      attempts,
      accepted,
      joinCalls,
      leave,
      flush,
      closeWorld: () => closeListener?.(getWorldRoomId()),
      pauseJoins: () => {
        joinGate = new Promise<void>((resolve) => {
          releaseJoinGate = resolve
        })
      },
      releaseJoins: () => {
        releaseJoinGate()
        joinGate = null
      },
      /** Establishes one known remote World peer so each publication has one live member. */
      primeTarget: async () => {
        peerJoinListener?.(getWorldRoomId(), 'remote-peer')
        await flush()
      }
    }
  }

  it('serializes concurrent registrations so the final accepted snapshot contains every successful domain', async () => {
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, caller: { tab: { id: 1, url: '' } } })
    await server.attachPage({ domain: domainB, caller: { tab: { id: 2, url: '' } } })

    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA, title: 'A' } })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB, title: 'B' } })
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    attempts[1].settle.resolve()
    await Promise.all([joinA, joinB])

    expect(
      accepted
        .at(-1)
        ?.sites.map(({ origin }) => origin)
        .toSorted()
    ).toEqual([domainA, domainB])
    disposeServer(server)
  })

  it('republishes the current registry before a staged join succeeds after release', async () => {
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, caller: { tab: { id: 1, url: '' } } })
    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await joinA

    await server.attachPage({ domain: domainB, caller: { tab: { id: 2, url: '' } } })
    let joinedB = false
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } }).then(() => {
      joinedB = true
    })
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    // The release is queued while the staged send is held; it resolves only after the World
    // convergence settles.
    const leaveA = server.leaveChatRoom({ domain: domainA })
    attempts[1].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(3))

    expect(joinedB).toBe(false)
    expect(attempts[2].message.sites.map(({ origin }) => origin)).toEqual([domainB])
    attempts[2].settle.resolve()
    await leaveA
    await joinB

    expect(accepted.at(-1)?.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect((await readServerSnapshot(server)).world.localPresence?.sites.map(({ origin }) => origin)).toEqual([domainB])
    disposeServer(server)
  })

  it('does not let a release queued during a staged send erase the newly committed domain', async () => {
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    const domainC = 'https://c.example'
    fixture.pauseJoins()
    let primed = false
    let attachTabId = 0
    for (const domain of [domainA, domainC] as const) {
      attachTabId += 1
      await server.attachPage({ domain, caller: { tab: { id: attachTabId, url: '' } } })
      const join = server.joinChatRoom({ domain, user: USER, site: { origin: domain } })
      if (!primed) {
        primed = true
        await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
        await fixture.primeTarget()
        fixture.releaseJoins()
      }
      await vi.waitFor(() => expect(attempts).toHaveLength(domain === domainA ? 1 : 2))
      attempts.at(-1)!.settle.resolve()
      await join
    }

    await server.attachPage({ domain: domainB, caller: { tab: { id: 2, url: '' } } })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } })
    await vi.waitFor(() => expect(attempts).toHaveLength(3))
    const leaveA = server.leaveChatRoom({ domain: domainA })
    attempts[2].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(4))
    expect(attempts[3].message.sites.map(({ origin }) => origin).toSorted()).toEqual([domainB, domainC])
    attempts[3].settle.resolve()
    await leaveA
    await joinB

    const expected = [domainB, domainC]
    expect(
      accepted
        .at(-1)
        ?.sites.map(({ origin }) => origin)
        .toSorted()
    ).toEqual(expected)
    expect(
      (await readServerSnapshot(server)).world.localPresence?.sites.map(({ origin }) => origin).toSorted()
    ).toEqual(expected)
    disposeServer(server)
  })

  it('makes recovery and a staged join wait for the same accepted registry revision', async () => {
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted, joinCalls, closeWorld } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, caller: { tab: { id: 1, url: '' } } })
    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await joinA

    closeWorld()
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    await server.attachPage({ domain: domainB, caller: { tab: { id: 2, url: '' } } })
    let joinedB = false
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } }).then(() => {
      joinedB = true
    })
    await vi.waitFor(() => expect(joinCalls).toHaveLength(5))
    await settle()
    expect((await readServerSnapshot(server)).domains.find(({ domain }) => domain === domainB)?.chatRoomJoined).toBe(
      false
    )

    attempts[1].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(3))
    expect(joinedB).toBe(false)
    expect(attempts[2].message.sites.map(({ origin }) => origin).toSorted()).toEqual([domainA, domainB])
    attempts[2].settle.resolve()
    await joinB

    const snapshot = await readServerSnapshot(server)
    expect(snapshot.world.joined).toBe(true)
    expect(
      accepted
        .at(-1)
        ?.sites.map(({ origin }) => origin)
        .toSorted()
    ).toEqual([domainA, domainB])
    disposeServer(server)
  })

  it('does not fail the next staged domain when the released prior stage publication rejects late', async () => {
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, caller: { tab: { id: 1, url: '' } } })
    await server.attachPage({ domain: domainB, caller: { tab: { id: 2, url: '' } } })
    fixture.pauseJoins()
    const joinAResult = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } }).then(
      () => null,
      (error: Error) => error
    )
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
    let joinedB = false
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } }).then(() => {
      joinedB = true
    })

    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    expect(attempts[0].message.sites.map(({ origin }) => origin)).toEqual([domainA])
    const leaveA = server.leaveChatRoom({ domain: domainA })
    attempts[0].settle.reject(new Error('released A publication failed late'))
    await vi.waitFor(() => expect(attempts).toHaveLength(2))

    expect(joinedB).toBe(false)
    expect(attempts[1].message.sites.map(({ origin }) => origin)).toEqual([domainB])
    attempts[1].settle.resolve()
    await leaveA
    await joinB

    expect((await joinAResult)?.message).toBe('Domain released during join')
    expect(accepted.at(-1)?.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect((await readServerSnapshot(server)).world.localPresence?.sites.map(({ origin }) => origin)).toEqual([domainB])
    disposeServer(server)
  })

  it('settles a staged join when a superseded revision target rejects late', async () => {
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, caller: { tab: { id: 1, url: '' } } })
    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await joinA

    await server.attachPage({ domain: domainB, caller: { tab: { id: 2, url: '' } } })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } })
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    await server.leaveChatRoom({ domain: domainA })
    // The B revision is superseded by the release revision; its late target rejection is discarded,
    // and the newest revision still settles the join.
    attempts[1].settle.reject(new Error('staged World publication failed'))
    await vi.waitFor(() => expect(attempts).toHaveLength(3))
    attempts[2].settle.resolve()
    const joinBSnapshot = await joinB
    if (!joinBSnapshot) throw new Error('Join was cancelled')

    expect(attempts[2].message.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect(accepted.at(-1)?.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect((await readServerSnapshot(server)).world.localPresence?.sites.map(({ origin }) => origin)).toEqual([domainB])
    disposeServer(server)
  })

  it('surfaces a failed publication target without removing the concurrent registration', async () => {
    const fixture = createConvergenceFixture({ failFirstPublication: true })
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, caller: { tab: { id: 1, url: '' } } })
    await server.attachPage({ domain: domainB, caller: { tab: { id: 2, url: '' } } })

    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA, title: 'A' } })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB, title: 'B' } })
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
    // The first revision's only target throws synchronously; the iterator settles it and the joins continue.
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    attempts[1].settle.resolve()
    const [snapshotA] = await Promise.all([joinA, joinB])
    if (!snapshotA) throw new Error('Join was cancelled')

    expect((await readServerSnapshot(server)).failures.map((item) => item.message)).toEqual([
      'first World publication failed'
    ])
    expect(
      accepted
        .at(-1)
        ?.sites.map(({ origin }) => origin)
        .toSorted()
    ).toEqual([domainA, domainB])
    const snapshot = await readServerSnapshot(server)
    expect(snapshot.world.localPresence?.sites.map(({ origin }) => origin).toSorted()).toEqual([domainA, domainB])
    expect(snapshot.domains.map(({ domain, chatRoomJoined }) => ({ domain, chatRoomJoined }))).toEqual([
      { domain: domainA, chatRoomJoined: true },
      { domain: domainB, chatRoomJoined: true }
    ])
    disposeServer(server)
  })
})

describe('RuntimeServer history', () => {
  const request = (syncId: string, page: number, messageIds: string[], done: boolean) => ({
    type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
    syncId,
    page,
    messageIds,
    done
  })
  const registerInventoryProvider = (server: RuntimeServer, records: TextMessageRecord[] = []) =>
    registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      async (): Promise<HistorySupplyResult> => ({ records, done: true })
    )

  it('resets a provider-only terminal binding across room recovery', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (pull) => {
      if (pull.mode === 'inventory') return { records: [], done: true }
      started.push(pull.syncId)
      return { records: [], done: true }
    })

    // A provider Pull is valid without peerJoin or a requester/session setup on this runtime.
    fake.receive(roomId, 'provider-only-peer', request('provider-only-initial', 0, [], true))
    await vi.waitFor(() => expect(started).toEqual(['provider-only-initial']))
    await vi.waitFor(() => {
      expect(
        fake
          .messages(roomId)
          .filter(
            (message) =>
              message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH &&
              (message as { syncId: string }).syncId === 'provider-only-initial'
          )
      ).toHaveLength(1)
    })
    await settle()
    await settle()

    // Keep the source out of the fake recovery join list: this control has no peer lifecycle.
    fake.forgetPeer(roomId, 'provider-only-peer')
    fake.roomClose(roomId)
    await vi.waitFor(async () => {
      expect(fake.joined.has(roomId)).toBe(true)
      expect((await readServerSnapshot(server)).domains[0]?.chatRoomJoined).toBe(true)
    })

    fake.receive(roomId, 'provider-only-peer', request('provider-only-recovery', 0, [], true))
    await vi.waitFor(() => expect(started).toEqual(['provider-only-initial', 'provider-only-recovery']))
    expect(started).toEqual(['provider-only-initial', 'provider-only-recovery'])
    disposeServer(server)
  })

  it('delivers a schema-accepted response whose message userId is absent from the users array', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    await settle()
    const requestMsg = await vi.waitFor(() => {
      const found = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
      expect(found).toBeDefined()
      return found
    })
    const syncId = (requestMsg as { syncId: string }).syncId

    // The declarative schema does not validate History user references: a message whose userId
    // is absent from the page users is still delivered with a minimal author snapshot, not
    // silently filtered or converted into an error.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [],
      messages: [text('missing-reference')],
      done: true
    })
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['missing-reference']))
  })

  it('serves a load-accepted record whose outer/message/user identities differ', async () => {
    const { fake, server, roomId } = await setup()
    const database = createMemoryMessageDatabase('history-mismatch-db')
    const store = createMessageStore(database)
    // The load boundary accepts identity mismatches (relationships are not validated), and the
    // History supplier must not re-filter them downstream.
    const mismatched = {
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      id: 'outer-mismatch',
      message: { ...text('inner-message', REMOTE_USER.id, NOW - 1), id: 'inner-message' },
      user: { id: 'another-user', name: 'Another', avatar: '' },
      receivedAt: NOW - 1
    }
    await store.insert(mismatched)
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => {
      const records = await store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return { records: records as TextMessageRecord[], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', request('sync-mismatch', 0, [], true))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'sync-mismatch')).toBe(true)
    })
    const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
    expect(sent[sent.length - 1]).toMatchObject({ messages: [{ id: 'inner-message' }] })
    // Opposite control: a History response is explicitly targeted to the requesting peer.
    const pushAttempt = fake.sendAttempts.findLast(
      (a) => a.roomId === roomId && JSON.parse(a.payload).type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH
    )
    expect(pushAttempt).toBeDefined()
    expect(pushAttempt?.rawTarget).toEqual(['peer-a'])
  })

  it('runs one exact-difference inventory -> missing-body sync through the real page boundary', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId
    expect((requestMsg as { messageIds: string[] }).messageIds).toEqual([])
    expect((requestMsg as { done: boolean }).done).toBe(true)

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('history-a'), text('history-b', REMOTE_USER.id, NOW - 1)],
      done: true
    })
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['history-a', 'history-b']))
  })

  it('publishes one attempt-owned loading Toast on first actual insert and dismisses at final page', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    // The page persists each inbound History record and ACKs with the real insert result.
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('history-a')],
      done: false
    })
    // The page persists the batch and ACKs the real insert result: the attempt-owned loading
    // owner appears in the provider tab's current projection.
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['history-a']))
    await ackAllProjectedInbound(server)
    const projectedFeedback = async () => domainSnapshot(await server.getSnapshot(callerOf(1)))?.historyFeedback ?? []
    await vi.waitFor(async () => expect(await projectedFeedback()).toHaveLength(1))

    // The provider's final page completes the attempt and dismisses the same owner.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('history-b', REMOTE_USER.id, NOW - 1)],
      done: true
    })
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['history-b']))
    await ackAllProjectedInbound(server)
    await vi.waitFor(async () => expect(await projectedFeedback()).toHaveLength(0))
  })

  it('stays silent when a response page is empty or every insert already exists', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await settle()
    expect(domainSnapshot(await readServerSnapshot(server))?.historyFeedback ?? []).toEqual([])
  })

  it('provides only records absent from the complete inventory in recent-first order', async () => {
    const { fake, server, roomId } = await setup()
    const database = createMemoryMessageDatabase('history-provider-db')
    const store = createMessageStore(database)
    await store.insert(textRecord('local-1', NOW))
    await store.insert(textRecord('local-2', NOW - 1))
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => {
      const records = await store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return { records: records as TextMessageRecord[], done: true }
    })

    // Commit the remote session so the provider binding exists, then the requester sends inventory.
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', request('sync-provider', 0, ['local-1'], true))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.length).toBeGreaterThan(0)
    })
    const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
    expect(sent[0]).toMatchObject({
      syncId: 'sync-provider',
      page: 0,
      done: true,
      messages: [{ id: 'local-2' }]
    })
    expect(sent[0].users).toHaveLength(1)
  })

  it('cancels the attempt on a page gap or out-of-order page', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 5,
      users: [REMOTE_USER],
      messages: [text('gap')],
      done: true
    })
    await settle()
    // The requester cancels the attempt: no further request pages are sent.
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toHaveLength(1)
  })

  it('rejects old history shapes and never falls back', async () => {
    const { fake, roomId } = await setup()
    fake.receive(roomId, 'peer-a', {
      type: 'history-request',
      syncId: 'old',
      before: { hlc: { timestamp: 1, counter: 0 }, id: 'x' }
    })
    fake.receive(roomId, 'peer-a', { type: 'history-response', syncId: 'old', users: [], messages: [], done: true })
    await settle()
    const types = fake.messages(roomId).map((m) => ('type' in m ? m.type : ''))
    expect(types).not.toContain('history-request')
    expect(types).not.toContain('history-response')
  })

  it('slices inventory pages by the encoded 256KiB frame cap, never by the phase count', async () => {
    // A size-limited codec that throws on an oversized frame exactly like NativeWireCodec, while
    // staying JSON-transport compatible so the fake can carry it. This proves the throw-closes-bucket
    // paging and the single-unpageable-ID cancel paths against a real codec-size boundary.
    const sizeLimited: WireCodec = {
      // NativeWireCodec accepts a general frame of exactly 262,144 bytes; History requires strictly
      // below. Throwing only above the cap makes the strict predicate the bucket-closing boundary.
      encode: async (value) => {
        const json = JSON.stringify(value)
        if (new TextEncoder().encode(json).byteLength > 256 * 1024) {
          throw new Error('Wire frame exceeds 262144 bytes')
        }
        return json
      },
      decode: async (value) => JSON.parse(value)
    }
    const { fake, server, roomId } = await setup(DOMAIN, NOW, sizeLimited)
    // 1000 ids of ~300 bytes total about 300KiB, so the real 256KiB codec bound still splits
    // them across multiple pages while keeping the throw-closes-bucket encoding cost small.
    const manyIds = Array.from(
      { length: 1000 },
      (_, index) => `id-${index.toString(36).padStart(6, '0')}${'x'.repeat(292)}`
    )
    const records = manyIds.map((id, index) => textRecord(id, NOW - index))
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => ({
      records,
      done: true
    }))
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await vi.waitFor(() => {
      const pages = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
      expect(pages.length).toBeGreaterThan(1)
    })
    const pages = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    // Every page stays strictly below 256KiB after the codec's own size boundary.
    pages.forEach((page) => expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThan(256 * 1024))
    expect(pages[pages.length - 1]).toMatchObject({ done: true })
    const covered = pages.flatMap((p) => (p as { messageIds: string[] }).messageIds)
    expect(new Set(covered).size).toBe(manyIds.length)
  })

  it('rejects a cross-page recent-first violation atomically without applying a prefix', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    // Page 0 applies records older than page 1's newest: a cross-page ordering violation must cancel
    // the attempt instead of applying the violating prefix.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('older-page-0', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toContain('older-page-0'))
    await ackAllProjectedInbound(server)
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('newer-page-1', REMOTE_USER.id, NOW - 5)],
      done: true
    })
    await settle()
    // The violating page never applies.
    expect(await projectedInboundIds(server)).not.toContain('newer-page-1')
  })

  it('queues a valid next response page while a batch is pending and cancels a changed replay', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    // The page-0 batch is buffered but not yet ACKed: it stays pending while page 1 arrives.
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['page-0-msg']))
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('page-1-msg', REMOTE_USER.id, NOW - 20)],
      done: true
    })
    await settle()
    // ACK page 0: it settles, then the queued page 1 applies in order and is ACKed too.
    await ackAllProjectedInbound(server)
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['page-1-msg']))
    await ackAllProjectedInbound(server)
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual([]))
    // Identical replay of the accepted page 0 after it settled is idempotent (no new delivery).
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
  })

  it('preserves every provider record through the work list without a false terminal', async () => {
    const { fake, server, roomId } = await setup()
    const database = createMemoryMessageDatabase('history-preflight-db')
    const store = createMessageStore(database)
    await store.insert(textRecord('keep-1', NOW))
    await store.insert(textRecord('keep-2', NOW - 1))
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => {
      const records = await store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return { records: records as TextMessageRecord[], done: true }
    })
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId,
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.length).toBeGreaterThan(0)
    })
    const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
    const ids = sent.flatMap((m) => (m as { messages: { id: string }[] }).messages.map((x) => x.id))
    expect(ids.sort()).toEqual(['keep-1', 'keep-2'])
    expect(sent.every((m) => (m as { messages: unknown[] }).messages.length > 0 || sent.length === 1)).toBe(true)
  })

  it('cancels the attempt when a single opaque inventory id cannot form a valid page', async () => {
    const sizeLimited: WireCodec = {
      // NativeWireCodec accepts a general frame of exactly 262,144 bytes; History requires strictly
      // below. Throwing only above the cap makes the strict predicate the bucket-closing boundary.
      encode: async (value) => {
        const json = JSON.stringify(value)
        if (new TextEncoder().encode(json).byteLength > 256 * 1024) {
          throw new Error('Wire frame exceeds 262144 bytes')
        }
        return json
      },
      decode: async (value) => JSON.parse(value)
    }
    const { fake, server, roomId } = await setup(DOMAIN, NOW, sizeLimited)
    const hugeId = 'x'.repeat(300 * 1024)
    await registerInventoryProvider(server, [textRecord(hugeId, NOW)])
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // The single opaque id cannot form any valid page: the attempt cancels locally, never sending.
    expect(fake.messages(roomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(false)
  })

  it('cancels a dormant successor on changed replay or post-done inventory input', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const firstSync = (
      fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL) as {
        syncId: string
      }
    ).syncId
    // A replacement syncId while the first inventory is still supplying occupies a dormant successor.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-1',
      page: 0,
      messageIds: ['known-a'],
      done: false
    })
    await settle()
    // Identical replay of the successor's page 0 is idempotent (no cancellation).
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-1',
      page: 0,
      messageIds: ['known-a'],
      done: false
    })
    await settle()
    // Changed replay of the successor's page 0 cancels the successor attempt.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-1',
      page: 0,
      messageIds: ['known-b'],
      done: false
    })
    await settle()
    // Post-done inventory input on a fresh successor is rejected (cancels it).
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-2',
      page: 0,
      messageIds: [],
      done: true
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-2',
      page: 1,
      messageIds: ['late'],
      done: true
    })
    await settle()
    // No provider response ever flows from the rejected successors.
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(0)
    expect(firstSync).toBeTruthy()
  })

  it('counts partial provider attempts toward admission and releases slots on peer removal', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // Many peers send partial (non-final) inventories: each occupies admission from page zero.
    for (let peer = 0; peer < 5; peer += 1) {
      const peerId = `peer-${peer}`
      fake.receive(roomId, peerId, session())
      await settle()
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `partial-${peer}`,
        page: 0,
        messageIds: [`known-${peer}`],
        done: false
      })
      await settle()
    }
    // The provider jobs are admitted even without a final inventory page.
    // Peer removal cancels the attempt and releases its slot accounting without leaking.
    // Trigger the connection-level binding removal path: removing the peer via the session domain.
    await server.leaveChatRoom({ domain: DOMAIN })
    await settle()
    // No provider response pages ever flow from partial attempts.
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(0)
  })

  it('transitions a partial provider inventory to ready on the final page and serves responses', async () => {
    const { fake, server, roomId } = await setup()
    const database = createMemoryMessageDatabase('history-multipage-provider-db')
    const store = createMessageStore(database)
    await store.insert(textRecord('mp-1', NOW))
    await store.insert(textRecord('mp-2', NOW - 1))
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async () => {
      const records = await store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return { records: records as TextMessageRecord[], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // A multi-page inventory: page 0 is partial, page 1 is final. The provider must transition the
    // single page-zero admission to ready on the final page and then serve the missing records.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'multi-page',
      page: 0,
      messageIds: ['mp-1'],
      done: false
    })
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'multi-page',
      page: 1,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => {
      const responses = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(responses.length).toBeGreaterThan(0)
    })
    const responses = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
    const ids = responses.flatMap((m) => (m as { messages: { id: string }[] }).messages.map((x) => x.id))
    // Only the record absent from the inventory is returned.
    expect(ids).toEqual(['mp-2'])
  })

  it('treats an identical queued-terminal replay as idempotent and still applies queued pages', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['page-0-msg']))
    const page1 = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('page-1-msg', REMOTE_USER.id, NOW - 20)],
      done: false
    }
    const page2 = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 2,
      users: [REMOTE_USER],
      messages: [text('page-2-msg', REMOTE_USER.id, NOW - 30)],
      done: true
    }
    fake.receive(roomId, 'peer-a', page1)
    fake.receive(roomId, 'peer-a', page2)
    // Identical replay of the queued terminal N+2 is idempotent: the attempt must NOT cancel.
    fake.receive(roomId, 'peer-a', page2)
    await settle()
    // Page 0's batch settles first; the queued N+1 and N+2 then apply in order.
    await ackAllProjectedInbound(server)
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['page-1-msg']))
    await ackAllProjectedInbound(server)
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['page-2-msg']))
    await ackAllProjectedInbound(server)
    // The identical replay did not cancel: every queued page applied in order.
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual([]))
  })

  it('cancels immediately on a changed queued-terminal replay and discards queued work', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['page-0-msg']))
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('page-1-msg', REMOTE_USER.id, NOW - 20)],
      done: false
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 2,
      users: [REMOTE_USER],
      messages: [text('page-2-msg', REMOTE_USER.id, NOW - 30)],
      done: true
    })
    await settle()
    // A changed replay of the queued terminal N+2 is rejected as invalid, but it does not erase
    // the already-accepted queued N+1 and N+2: they are retained and merged once page 0 settles.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 2,
      users: [REMOTE_USER],
      messages: [text('changed-terminal', REMOTE_USER.id, NOW - 35)],
      done: true
    })
    await settle()
    // The already-accepted queued pages are retained and merge in order once page 0 settles.
    await ackAllProjectedInbound(server)
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['page-1-msg']))
    await ackAllProjectedInbound(server)
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['page-2-msg']))
    await ackAllProjectedInbound(server)
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual([]))
  })

  it('frees admission capacity on real peer removal so a new peer progresses', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    // Two peers send partial inventories (page 0 non-final) plus a completed peer.
    fake.receive(roomId, 'peer-removed', session({ id: 'removed-user', name: 'Removed', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-removed', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'removed-partial',
      page: 0,
      messageIds: ['r-1'],
      done: false
    })
    await settle()
    fake.receive(roomId, 'peer-live', session({ id: 'live-user', name: 'Live', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-live', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'live-partial',
      page: 0,
      messageIds: ['l-1'],
      done: true
    })
    // Remove the first peer: its dormant/waiting/provider accounting is cleaned.
    fake.peerLeave(roomId, 'peer-removed')
    await settle()
    // The live peer's completed inventory must still be able to transition to ready and serve.
    await vi.waitFor(() => {
      const responses = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(responses.length).toBeGreaterThan(0)
    })
  })

  it('never promotes a waiter before the old active supplier physically settles', async () => {
    const { fake, server, roomId } = await setup()
    // A held supplier that settles ONLY through the real cancellation path: cleanup cancels the
    // in-flight supply via its recorded supplyId, the provider's AbortSignal fires, and the
    // supply settles (rejects) shortly after the abort is observed.
    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelled.push(request.syncId)
            // The physical query settles after the abort is observable, never before.
            setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
          })
        })
      }
    )
    for (let peer = 0; peer < 5; peer += 1) {
      const peerId = `peer-${peer}`
      fake.receive(roomId, peerId, session({ id: `user-${peer}`, name: `User ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `full-${peer}`,
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
    }
    // Exactly four suppliers are physically running (the fifth is a waiting projection).
    expect(started).toEqual(['full-0', 'full-1', 'full-2', 'full-3'])
    // Remove peer-0: cleanup must actually cancel its live supply through the recorded supplyId
    // (observable on the AbortSignal), while the waiting fifth peer is NOT promoted early.
    fake.peerLeave(roomId, 'peer-0')
    await vi.waitFor(() => expect(cancelled).toEqual(['full-0']))
    expect(started).toEqual(['full-0', 'full-1', 'full-2', 'full-3'])
    // The cancelled supply settles (abort rejection) and exactly one waiter is promoted; no
    // manual gate resolution was involved anywhere.
    await vi.waitFor(() => expect(started).toEqual(['full-0', 'full-1', 'full-2', 'full-3', 'full-4']))
  })

  it('promotes a fresh successor admitted after cleanup when the old supply settles', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelled.push(request.syncId)
            // Physical settlement follows the observable abort after a short delay, so the dormant
            // successor has a window to be admitted before the old supply settles.
            setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
          })
        })
      }
    )
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a']))
    // Cleanup removes the peer: the in-flight supply is cancelled via its recorded supplyId.
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    expect(cancelled).toEqual(['old-a'])
    // A fresh session submits a replacement request with a DIFFERENT syncId: it becomes one
    // dormant successor while the old active supply is still unsettled (no parallel supply).
    fake.peerJoin(roomId, 'peer-0')
    fake.receive(roomId, 'peer-0', session({ id: 'user-0b', name: 'User 0b', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    expect(started).toEqual(['old-a'])
    // The old supply settles (abort rejection): the successor is promoted by the late-settlement
    // path and its own supply starts; it is never deleted as stale.
    await vi.waitFor(() => expect(started).toEqual(['old-a', 'new-b']))
  })

  it('keeps a grace-retained committed binding untrusted across a prepared rebind and its rollback', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained only by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // A local reconnect enters its prepared phase; its World publication is held.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    fake.peerJoin(roomId, 'peer-b')
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    // B's valid same-presence SESSION arrived during the prepared phase.
    await settle()
    // A fresh TEXT from B's source before the commit is NOT admitted (attempt-owned until commit).
    fake.receive(roomId, 'peer-b', { ...text('pre-commit-live'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    // The prepared attempt is superseded (rolled back): the committed deadline is preserved, so
    // the retained committed binding stays untrusted after the rollback too.
    const replacement = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await expect(reconnect).resolves.toBeUndefined()
    await settle()
    fake.receive(roomId, 'peer-b', { ...text('post-rollback-live'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    fake.releaseSends()
    const snapshot = await replacement
    if (!snapshot) throw new Error('Join was cancelled')
    // The aborted attempt's rebind does NOT transfer to the successor replacement: B's committed
    // binding stays under its pending leave after the replacement commit (live and History closed).
    fake.receive(roomId, 'peer-b', { ...text('post-commit-live'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    // Only a CURRENT source publishing a valid SESSION cancels the matching leave.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', { ...text('post-rebind-live'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual(['post-rebind-live'])
  })

  it('removes an absent non-grace source at reconnect commit and admits nothing without a current SESSION', async () => {
    const { fake, server, roomId } = await setup()
    // B is an ordinary ACTIVE committed source (no pending leave).
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A local reconnect's replacement Room contains no B and B publishes no replacement SESSION.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    fake.receive(roomId, 'remote-peer', session())
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    fake.releaseSends()
    await reconnect
    await settle()
    // The commit cannot manufacture a current binding the attempt never observed: B is removed.
    const snapshot = await readServerSnapshot(server)
    expect(snapshot.domains[0].sessions.some((session) => session.user.id === 'user-b')).toBe(false)
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-absent-reconnect'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    // A current valid SESSION restores authority.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', { ...text('post-absent-reconnect'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual(['post-absent-reconnect'])
  })

  it('keeps the graced generation displayed when the rebound source switches to a different presence', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // A held local replacement accepts B's valid same-presence SESSION in its prepared attempt...
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    fake.peerJoin(roomId, 'peer-b')
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    await settle()
    // ... then the SAME source switches to a different presence C before commit.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.releaseSends()
    await reconnect
    await settle()
    // The refresh destroyed the grace ledger and the fresh B observation was displaced by C on
    // the same source without grace protection: the commit keeps only current C.
    const snapshot = await readServerSnapshot(server)
    const userIds = snapshot.domains[0].sessions.map((session) => session.user.id)
    expect(userIds).toEqual(['user-c'])
    // B's departed source stays untrusted (live) without a CURRENT valid B SESSION.
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-presence-switch'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    // C is current and trusted.
    fake.receive(roomId, 'peer-b', { ...text('post-c-current'), userId: 'user-c' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual(['post-c-current'])
    // A REPEATED current C SESSION updates only the current slot: one C and no B (the refresh
    // destroyed the grace ledger, so no graced generation remains to protect).
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    const afterRepeat = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(afterRepeat.filter((id) => id === 'user-c')).toHaveLength(1)
    expect(afterRepeat.filter((id) => id === 'user-b')).toHaveLength(0)
    disposeServer(server)
  })

  it('deduplicates repeated same-presence prepared SESSION frames into one cancellation fact', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    fake.peerJoin(roomId, 'peer-b')
    const rebind = session({ id: 'user-b', name: 'User B', avatar: '' })
    fake.receive(roomId, 'peer-b', rebind)
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    // Duplicate valid same-presence SESSION frames: one logical rebind marker.
    fake.receive(roomId, 'peer-b', rebind)
    await settle()
    fake.releaseSends()
    await reconnect
    await settle()
    // The single cancellation fact is honored: B is current and trusted after the commit.
    fake.receive(roomId, 'peer-b', { ...text('post-duplicate-rebind'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual(['post-duplicate-rebind'])
    disposeServer(server)
  })

  it('does not cancel the reused-source History supply when the graced generation expires', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      // B departs (grace armed); the same source later carries current C.
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      fake.plantPeer(roomId, 'remote-peer')
      fake.makeNotReady()
      fake.hangSendsTo(getWorldRoomId())
      const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
      const reconnect = server.reconnectDomain({ domain: DOMAIN })
      await fake.waitForJoinCalls(4)
      fake.open()
      fake.peerJoin(roomId, 'peer-b')
      // The provisional Session broadcast is hung at the provider while the reused source's
      // current-C session lands in the prepared attempt.
      await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
      fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
      await settle()
      fake.releaseSends()
      await reconnect
      await settle()
      // A real public History supply for current C on the reused source starts while B's grace
      // is still running (its own request timeout is separated from the grace deadline).
      const cancelled: string[] = []
      await registerHistoryProvider(
        server,
        { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
        (request, signal) => {
          if (request.mode !== 'inventory') {
            signal.addEventListener('abort', () => cancelled.push(request.syncId))
            return new Promise<HistorySupplyResult>(() => {})
          }
          return Promise.resolve({ records: [], done: true })
        }
      )
      await vi.advanceTimersByTimeAsync(100)
      fake.receive(roomId, 'peer-b', {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: 'current-c',
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
      // B's original deadline expires: B is removed, C stays current, and C's active supply is
      // NOT cancelled (the expiry never emits a source-removal event for a still-owned source).
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS - 100)
      await vi.advanceTimersByTimeAsync(0)
      const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
      expect(after).not.toContain('user-b')
      expect(after).toContain('user-c')
      expect(cancelled).toEqual([])
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits exactly one join for a provisional presence that later binds authoritatively', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A held ordinary join provisionally switches that source to C.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The source departs before the commit: provisional C has no surviving authoritative
    // binding and must not remain logically active.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    // C's first REAL binding on a different source is a zero-to-one join.
    fake.receive(roomId, 'peer-c', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // C's first real binding converges alongside B without replacing it.
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-b', 'user-c'])
    disposeServer(server)
  })

  it('accepts an exact grace rebind on a new source before commit and keeps B past the deadline', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      fake.plantPeer(roomId, 'remote-peer')
      fake.makeNotReady()
      fake.hangSendsTo(getWorldRoomId())
      const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
      const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await fake.waitForJoinCalls(4)
      fake.open()
      await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
      // The prepared switch to C and the source departure arm B's committed grace.
      fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
      await settle()
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      // A valid exact B rebind on a NEW source before the commit cancels the pending leave.
      fake.receive(roomId, 'peer-b-new', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      fake.releaseSends()
      const snapshot = await join
      if (!snapshot) throw new Error('Join was cancelled')
      await settle()
      // B stays continuously present past the original grace deadline (the rebind cancelled it).
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await vi.advanceTimersByTimeAsync(0)
      const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
      expect(after).toContain('user-b')
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a same-presence generation ended when its last prepared source departs after displacement', async () => {
    const { fake, server, roomId } = await setup()
    // One logical B presence committed on TWO physical sources.
    fake.receive(roomId, 'peer-b-1', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b-2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b2',
      presenceId: 'presence-user-b',
      joinedAt: NOW + 1,
      user: { id: 'user-b', name: 'User B', avatar: '' }
    })
    await settle()
    // A held ordinary preparation switches peer-b-1 from B to C (B displaced on that source).
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    fake.receive(roomId, 'peer-b-1', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The LAST prepared B source departs: no B source survives in the preparation, and the
    // displaced committed peer-b-1=B binding must not keep B active.
    fake.peerLeave(roomId, 'peer-b-2')
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    // Replaying B's exact generation from a new source is source-locally dropped.
    fake.receive(roomId, 'peer-b-new', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('keeps unrelated ended tombstones across a prepared PeerLeave and rejects the expired replay', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      // Commit B, deliver B's PeerLeave, and advance the deadline so B is removed and recorded ended.
      fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await vi.advanceTimersByTimeAsync(0)
      // Commit an unrelated current D.
      fake.receive(roomId, 'peer-d', session({ id: 'user-d', name: 'User D', avatar: '' }))
      await settle()
      // A held ordinary replacement preparation receives D's PeerLeave (exercises reconciliation).
      fake.plantPeer(roomId, 'remote-peer')
      fake.makeNotReady()
      fake.hangSendsTo(roomId)
      const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
      const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await fake.waitForJoinCalls(4)
      fake.open()
      await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
      fake.peerLeave(roomId, 'peer-d')
      await settle()
      fake.releaseSends()
      const snapshot = await join
      if (!snapshot) throw new Error('Join was cancelled')
      await settle()
      // Replaying B's exact expired SESSION from a new source is source-locally dropped:
      // the tombstone survived the unrelated reconciliation, and grace-preserved D stays shown.
      fake.receive(roomId, 'peer-b-new', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
      expect(after).toEqual(['user-d'])
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the preparation-owned displaced finality across an unrelated PeerLeave', async () => {
    const { fake, server, roomId } = await setup()
    // Commit B and D.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-d', session({ id: 'user-d', name: 'User D', avatar: '' }))
    await settle()
    // A held ordinary preparation switches B's source to C.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // An UNRELATED D PeerLeave must not reactivate the preparation-displaced B.
    fake.peerLeave(roomId, 'peer-d')
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    // B stays ended: replaying its exact generation on a new source is source-locally rejected,
    // while grace-preserved D stays displayed.
    fake.receive(roomId, 'peer-b-new', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c', 'user-d'])
    disposeServer(server)
  })

  it('emits no finality event when the prepared switch source departs before commit', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A held ordinary join receives changed-user C from the same source, recording displaced B.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The source departs before the commit: provisional C is removed and committed B enters
    // grace. The displaced fact is revoked, so the commit emits NO leave/replace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-b'])
    disposeServer(server)
  })

  it('emits one final transition per logical user when one preparation displaces two presences', async () => {
    const { fake, server, roomId } = await setup()
    // User B has two distinct presences on two sources.
    fake.receive(roomId, 'peer-b1', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b2',
      presenceId: 'presence-b2',
      joinedAt: NOW + 1,
      user: { id: 'user-b', name: 'User B', avatar: '' }
    })
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(getWorldRoomId())
    const worldPublicationStarted = fake.waitForSendAttempt(getWorldRoomId())
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(worldPublicationStarted).resolves.toMatchObject({ roomId: getWorldRoomId() })
    // Both sources switch to C and D during the held preparation.
    fake.receive(roomId, 'peer-b1', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-d',
      presenceId: 'presence-d',
      joinedAt: NOW + 2,
      user: { id: 'user-d', name: 'User D', avatar: '' }
    })
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c', 'user-d'])
    // B's two displaced presences converge to exactly one remaining absence: no B session survives.
    expect(after).not.toContain('user-b')
    disposeServer(server)
  })

  it('emits a replacement lifecycle when a held ordinary join switches a changed user during preparation', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A held ordinary join receives a later changed-user C SESSION from B's same source.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    // The commit classifies the attempt-owned displaced fact: B is gone, only C survives.
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('emits only the displaced final leave when a held ordinary join switches to historical C', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    // Historical C (joinedAt before the local generation): converges without a join notice.
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-historical',
      presenceId: 'presence-historical',
      joinedAt: NOW - 10,
      user: { id: 'user-c', name: 'User C', avatar: '' }
    })
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('keeps one current C and one grace B when a held ordinary join repeats C during preparation', async () => {
    const { fake, server, roomId } = await setup()
    // Build [grace B, current C] on one source in the committed runtime.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // An ordinary local join preparation seeds BOTH committed same-source entries.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    // Repeated current C during the prepared phase: only the current C slot is normalized.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    const userIds = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(userIds.filter((id) => id === 'user-c')).toHaveLength(1)
    expect(userIds.filter((id) => id === 'user-b')).toHaveLength(1)
    disposeServer(server)
  })

  it('keeps [current C, grace B] stable under a repeated current C SESSION', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    fake.peerJoin(roomId, 'peer-b')
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    // B's same-presence rebind then the SAME source switches to C before commit.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.releaseSends()
    await reconnect
    await settle()
    // The refresh destroyed the grace ledger; the fresh B rebind was displaced by C on the same
    // source without grace protection, so the commit keeps only current C.
    const userIds = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(userIds).toEqual(['user-c'])
    // A repeated valid C SESSION updates only the current C slot: C stays single, no graced B.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after.filter((id) => id === 'user-c')).toHaveLength(1)
    expect(after.filter((id) => id === 'user-b')).toHaveLength(0)
    disposeServer(server)
  })

  it('keeps the committed grace running when a prepared rebind source leaves again before commit', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained only by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // A held local replacement accepts B's valid same-presence SESSION in its prepared attempt.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    fake.peerJoin(roomId, 'peer-b')
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    await settle()
    // The rebind source leaves AGAIN before the commit: its cancellation fact is revoked.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.releaseSends()
    await reconnect
    await settle()
    // The refresh destroyed the committed grace: the rebind source left again before commit and
    // no grace ledger remains to protect it, so B is not displayed and its authority is closed
    // without a CURRENT valid SESSION.
    const snapshot = await readServerSnapshot(server)
    expect(snapshot.domains[0].sessions.some((session) => session.user.id === 'user-b')).toBe(false)
    fake.peerJoin(roomId, 'peer-b')
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-revoked-commit'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    // A CURRENT valid SESSION restores authority.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', { ...text('post-current-rebind'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual(['post-current-rebind'])
  })

  it('replaces the unprotected committed source binding on a direct same-source switch', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A valid C SESSION from the SAME committed source, with NO pending leave protecting B.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The snapshot contains only C (stale unprotected B is replaced, not appended).
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    // Stale B live is rejected; current C live is admitted.
    fake.receive(roomId, 'peer-b', { ...text('stale-b-live'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    fake.receive(roomId, 'peer-b', { ...text('current-c-live'), userId: 'user-c' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual(['current-c-live'])
    disposeServer(server)
  })

  it('emits a replacement lifecycle (not a second join) for a changed-user direct source switch', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // Direct changed-user switch on the same committed source: the displaced B observation is
    // ended and the lifecycle is a replacement, not a second join.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('emits no leave when the displaced user keeps another active presence', async () => {
    const { fake, server, roomId } = await setup()
    // C is already active on peer-c; user B has TWO distinct active presences on two sources.
    fake.receive(roomId, 'peer-c', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b1', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b2',
      presenceId: 'presence-b2',
      joinedAt: NOW + 1,
      user: { id: 'user-b', name: 'User B', avatar: '' }
    })
    await settle()
    // One B source switches to the already-active C: the other B stays displayed, so NO final
    // leave is emitted (the incoming C was not a zero-to-one join either).
    fake.receive(roomId, 'peer-b1', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The displaced B1 binding is removed, but the other B presence stays displayed.
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c', 'user-b', 'user-c'])
    disposeServer(server)
  })

  it('emits no leave when the displaced user keeps a grace-preserved presence', async () => {
    const { fake, server, roomId } = await setup()
    // User B has one grace-preserved presence and one current presence on two sources.
    fake.receive(roomId, 'peer-b1', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-b1')
    await settle()
    fake.receive(roomId, 'peer-b2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b2',
      presenceId: 'presence-b2',
      joinedAt: NOW + 1,
      user: { id: 'user-b', name: 'User B', avatar: '' }
    })
    await settle()
    // The current B source switches to C: grace B stays displayed, so NO finality event (leave
    // or replace) may encode B's one-to-zero transition.
    fake.receive(roomId, 'peer-b2', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-b', 'user-c'])
    disposeServer(server)
  })

  it('emits the displaced leave when the source switches to an already-active generation', async () => {
    const { fake, server, roomId } = await setup()
    // C is already active on peer-c.
    fake.receive(roomId, 'peer-c', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // B joins on peer-b, then peer-b switches to the same accepted C generation.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The displaced B is finally gone even though incoming C was already active elsewhere.
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c', 'user-c'])
    disposeServer(server)
  })

  it('emits the displaced leave when the source switches to an earlier historical generation', async () => {
    const { fake, server, roomId } = await setup()
    // B joins, then the source switches to historical C (joinedAt before the local generation).
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-historical',
      presenceId: 'presence-historical',
      joinedAt: NOW - 10,
      user: { id: 'user-c', name: 'User C', avatar: '' }
    })
    await settle()
    // C converges without a join notice, but B's final leave is still emitted.
    const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('emits exactly one final leave when the replaced same-user generation itself departs and expires', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      // B and C are two distinct generations of the SAME user on one source.
      fake.receive(roomId, 'peer-b', {
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-b',
        presenceId: 'presence-same-b',
        joinedAt: NOW + 1,
        user: { id: 'same-user', name: 'Same', avatar: '' }
      })
      await settle()
      fake.receive(roomId, 'peer-b', {
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-c',
        presenceId: 'presence-same-c',
        joinedAt: NOW + 2,
        user: { id: 'same-user', name: 'Same', avatar: '' }
      })
      await settle()
      // C's real PeerLeave arms C's own deadline; the displaced B observation is ended, so the
      // expiry emits exactly one final leave (no phantom active presence suppresses it).
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await vi.advanceTimersByTimeAsync(0)
      const after = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
      expect(after).toEqual([])
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('admits current C live and arms C own leave on a direct [grace B, current C] source', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      // B commits and departs: B's pending leave arms.
      fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      // The SAME committed source directly receives current C.
      fake.peerJoin(roomId, 'peer-b')
      fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
      await settle()
      const afterSwitch = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
      expect(afterSwitch).toEqual(['user-b', 'user-c'])
      // C's live traffic is admitted (the current binding resolves the non-pending C).
      fake.receive(roomId, 'peer-b', { ...text('current-c-live'), userId: 'user-c' })
      await settle()
      expect(await projectedInboundIds(server)).toEqual(['current-c-live'])
      // The source leaves again: C's OWN leave arms; B's original deadline keeps running.
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await vi.advanceTimersByTimeAsync(0)
      const afterExpiry = (await readServerSnapshot(server)).domains[0].sessions.map((session) => session.user.id)
      expect(afterExpiry).toEqual([])
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a grace-retained committed binding untrusted across an ordinary local replacement join', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained only by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // An ordinary local replacement join carries the committed sessions into its prepared runtime
    // but never receives a valid same-presence SESSION for B.
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    // Fresh TEXT from B's departed source is NOT admitted after the replacement commit.
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-local-commit'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
  })

  it('keeps a grace-retained binding untrusted when the release cleanup write rejects', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const rejectStore: PresenceStore = {
      load: async () => ({
        domain: DOMAIN,
        lastJoinedAt: 0,
        local: { presenceId: 'presence-a', userId: USER.id, joinedAt: 1, status: 'active' as const },
        observers: []
      }),
      save: async (record) => {
        if (!record.local && record.observers.length === 0) {
          throw new Error('release cleanup rejected')
        }
      }
    }
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore: rejectStore })
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    const joined = await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    if (!joined) throw new Error('Join was cancelled')
    const roomId = getChatRoomId(DOMAIN)
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained only by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // The release cleanup rejects: the fence and physical membership are retained, and the
    // fenced pending leave still closes live/History authority for B's departed source.
    await expect(server.leaveChatRoom({ domain: DOMAIN })).rejects.toThrow('release cleanup rejected')
    await settle()
    expect(fake.joined.has(roomId)).toBe(true)
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-cleanup-failure'), userId: 'user-b' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    disposeServer(server)
  })

  it('treats a repeated public leave of an already-released domain as idempotent', async () => {
    const { server } = await setup()
    await server.leaveChatRoom({ domain: DOMAIN })
    await settle()
    // A second public leave of the absent domain settles immediately (no leaked subscription).
    await expect(server.leaveChatRoom({ domain: DOMAIN })).resolves.toBeUndefined()
    await settle()
  })

  it('drops live messages from a source retained only by the leave grace without a new physical incarnation', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    // A fresh TEXT from the departed source is not admitted before a valid same-presence rebind.
    fake.receive(roomId, 'peer-0', { ...text('after-peer-leave'), userId: 'user-0' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
    // A plain source callback is not a physical rejoin. It must not revive the grace binding.
    fake.receive(roomId, 'peer-0', {
      ...session({ id: 'user-0', name: 'User 0', avatar: '' }),
      sessionId: 'session-user-0-rejoined'
    })
    await settle()
    fake.receive(roomId, 'peer-0', { ...text('after-rebind'), userId: 'user-0' })
    await settle()
    expect(await projectedInboundIds(server)).toEqual([])
  })

  it('ignores a delayed same-sync page after cleanup without a parallel token or supply', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelled.push(request.syncId)
            setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
          })
        })
      }
    )
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a']))
    // Cleanup removes the peer and cancels the in-flight supply; the active entry stays unsettled.
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    expect(cancelled).toEqual(['old-a'])
    // A delayed page carrying the SAME syncId arrives after cleanup (fresh session): it must be
    // idempotently ignored against the unsettled old owner, never admitted as a parallel token.
    fake.receive(roomId, 'peer-0', session({ id: 'user-0b', name: 'User 0b', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 1,
      messageIds: ['late'],
      done: true
    })
    await settle()
    expect(started).toEqual(['old-a'])
    // After the old supply settles, still no parallel supply or job for the delayed page exists.
    await vi.waitFor(() => expect(cancelled.length).toBe(1))
    await settle()
    await settle()
    expect(started).toEqual(['old-a'])
  })

  it('cancels the live second-page supply after a genuine first-page failure (per-attempt owner)', async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })
    // Page-a genuinely fails; page-b holds the provider snapshot until its AbortSignal fires.
    const pageAStarted: string[] = []
    const pageBHeld: string[] = []
    const pageBCancelled: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      pageAStarted.push(request.supplyId)
      throw new Error('page-a broken')
    })
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 2, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        pageBHeld.push(request.supplyId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            pageBCancelled.push(request.supplyId)
            setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
          })
        })
      }
    )
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'two-a',
      page: 0,
      messageIds: [],
      done: true
    })
    // The selection loop fails page-a and moves to page-b with a NEW supplyId (:1).
    await vi.waitFor(() => expect(pageAStarted.length).toBe(1))
    await vi.waitFor(() => expect(pageBHeld.length).toBe(1))
    expect(pageBHeld[0]).toMatch(/^supply:.*:1$/)
    // Cleanup cancels the LIVE second-page supplyId (the recorded owner), not the stale first one.
    fake.peerLeave(roomId, 'peer-0')
    await vi.waitFor(() => expect(pageBCancelled).toEqual([pageBHeld[0]]))
    // The old selection loop terminates: no further page is selected for the torn-down attempt.
    await vi.waitFor(() => expect(pageBHeld.length).toBe(1))
  })

  it('never starts the next page of an old attempt after cleanup cancellation', async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })
    // Both pages hold the provider snapshot; page-a is the first selection.
    const held: string[] = []
    const cancelled: string[] = []
    const pageBStarted: string[] = []
    const holder =
      (onStart: (supplyId: string) => void) =>
      (request: HistorySupplyRequest, signal: AbortSignal): Promise<HistorySupplyResult> => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        onStart(request.supplyId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelled.push(request.supplyId)
            setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
          })
        })
      }
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      holder((id) => held.push(id))
    )
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 2, url: '' } } },
      holder((id) => pageBStarted.push(id))
    )
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'two-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(held.length).toBe(1))
    // Cleanup cancels the held page-a supply; the old selection loop must terminate so page-b
    // never starts for the torn-down attempt.
    fake.peerLeave(roomId, 'peer-0')
    await vi.waitFor(() => expect(cancelled).toEqual([held[0]]))
    await vi.waitFor(() => expect(cancelled.length).toBe(1))
    await settle()
    await settle()
    expect(pageBStarted).toEqual([])
  })

  it('transfers a partial successor after cleanup settlement and completes it with one supply', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const cancelled: string[] = []
    const settled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        // The old supply settles only through its AbortSignal; any later supply resolves at once so
        // its response is delivered.
        if (request.syncId !== 'old-a') return Promise.resolve({ records: [], done: true })
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelled.push(request.syncId)
            setTimeout(() => {
              settled.push(request.syncId)
              reject(signal.reason ?? new Error('aborted'))
            }, 30)
          })
        })
      }
    )
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a']))
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    expect(cancelled).toEqual(['old-a'])
    // A PARTIAL replacement (page zero, done:false) becomes a dormant successor.
    fake.peerJoin(roomId, 'peer-0')
    fake.receive(roomId, 'peer-0', session({ id: 'user-0b', name: 'User 0b', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 0,
      messageIds: ['b-0'],
      done: false
    })
    await settle()
    expect(started).toEqual(['old-a'])
    // The old supply settles: the partial successor is transferred (installed as provider with
    // its canonical job) but NOT scheduled — still no supply for new-b.
    await vi.waitFor(() => expect(settled).toEqual(['old-a']))
    await settle()
    expect(started).toEqual(['old-a'])
    // The transferred attempt continues on the next page and completes: exactly ONE new-b supply.
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 1,
      messageIds: ['b-1'],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a', 'new-b']))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'new-b')).toBe(true)
    })
  })

  it('terminates the provider attempt on cumulative overflow; the connection cannot resync until reset', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    const bigIds = Array.from({ length: 137 }, (_, i) => `b-${String(i).padStart(4, '0')}-${'x'.repeat(48)}`)
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-a',
      page: 0,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // An unrelated admitted job stays live across the overflow (peer-b partial).
    fake.receive(roomId, 'peer-b', session({ id: 'sat-user-b', name: 'Sat B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'peer-b',
      page: 0,
      messageIds: ['b'],
      done: false
    })
    await settle()
    // peer-a's next page crosses the 8KiB cumulative budget: the synchronization terminates and
    // its connection direction becomes terminal.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-a',
      page: 1,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // Neither the same id nor a different id can start History again on this connection.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-a',
      page: 0,
      messageIds: ['small'],
      done: true
    })
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'different-a',
      page: 0,
      messageIds: ['small'],
      done: true
    })
    await settle()
    expect(started).toEqual([])
    // The unrelated peer-b job survives and completes normally.
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'peer-b',
      page: 1,
      messageIds: ['b-1'],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['peer-b']))
    // A source replacement ends the terminal binding: the next connection starts an independent
    // synchronization with a fresh id.
    fake.peerLeave(roomId, 'peer-a')
    fake.peerJoin(roomId, 'peer-a')
    fake.receive(roomId, 'peer-a', session({ id: 'sat-user-a-b', name: 'Sat A2', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'fresh-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['peer-b', 'fresh-a']))
  })

  it('terminates a dormant successor on cumulative overflow; smaller pages cannot revive it', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const settled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        started.push(request.syncId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              settled.push(request.syncId)
              reject(signal.reason ?? new Error('aborted'))
            }, 30)
          })
        })
      }
    )
    const bigIds = Array.from({ length: 137 }, (_, i) => `b-${String(i).padStart(4, '0')}-${'x'.repeat(48)}`)
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a']))
    // A replacement successor with a large page zero is admitted (dormant).
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 0,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // Its next page crosses the 8KiB cumulative budget: the successor is terminated.
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 1,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // A smaller payload at the same page number cannot revive the terminated successor (gap).
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 1,
      messageIds: ['small'],
      done: true
    })
    await settle()
    await settle()
    // The terminated syncId is fenced: even a fresh page zero with the same id is inert.
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 0,
      messageIds: ['b-0'],
      done: true
    })
    await settle()
    await settle()
    // Cleanup cancels the old supply and removes any dormant state; a fresh session with a
    // FRESH syncId is the positive re-admission case (the overflowed capacity was released).
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    fake.peerJoin(roomId, 'peer-0')
    fake.receive(roomId, 'peer-0', session({ id: 'user-0b', name: 'User 0b', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-c',
      page: 0,
      messageIds: ['b-0'],
      done: true
    })
    await settle()
    // On the old supply's settlement the complete successor is transferred and exactly ONE
    // supply starts.
    await vi.waitFor(() => expect(settled).toEqual(['old-a']))
    await vi.waitFor(() => expect(started).toEqual(['old-a', 'new-c']))
  })

  it('terminates an attempt immediately when no page candidates exist (exhaustion)', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    // No provider page is registered for the domain: the candidate list is empty.
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-a',
      page: 0,
      messageIds: [],
      done: true
    })
    // The exhausted attempt terminates without any supplier start and without a response, and
    // its connection direction becomes terminal.
    await settle()
    await settle()
    expect(started).toEqual([])
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(0)
    // Registering a page afterwards cannot restart History on the same connection.
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual([])
    // A source replacement ends the terminal binding: the next connection starts fresh.
    fake.peerLeave(roomId, 'peer-a')
    fake.peerJoin(roomId, 'peer-a')
    fake.receive(roomId, 'peer-a', session({ id: 'remote-user-b', name: 'Remote B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-c',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['ex-c']))
  })

  it('terminates an attempt whose every page candidate genuinely fails (exhaustion with dead pages)', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      throw new Error('page-a broken')
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-a',
      page: 0,
      messageIds: [],
      done: true
    })
    // The single candidate fails genuinely: the attempt terminates immediately (no response, no
    // waiting for the 10s attempt timer) and the connection direction becomes terminal.
    await vi.waitFor(() => expect(started).toEqual(['ex-a']))
    await settle()
    await settle()
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(0)
    // A fresh page registration cannot restart History on the same connection.
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['ex-a'])
    // A source replacement ends the terminal binding: the next connection starts fresh.
    fake.peerLeave(roomId, 'peer-a')
    fake.peerJoin(roomId, 'peer-a')
    fake.receive(roomId, 'peer-a', session({ id: 'remote-user-b', name: 'Remote B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-c',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['ex-a', 'ex-c']))
  })

  it('fails over to the next page after a per-page timeout once the held query settles (provider)', async () => {
    const { fake, server, roomId, clock } = await setup()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })
    const pageAStarted: string[] = []
    const pageBStarted: string[] = []
    const pageASettled: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        pageAStarted.push(request.supplyId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              pageASettled.push(request.supplyId)
              reject(signal.reason ?? new Error('aborted'))
            }, 200)
          })
        })
      }
    )
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 2, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      pageBStarted.push(request.supplyId)
      return { records: [textRecord('page-b-record')], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'to-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(pageAStarted.length).toBe(1))
    // The healthy page-a hits its per-page boundary: the timeout aborts the supply but the
    // attempt is still current, so the selection fails over — page-b starts only after the
    // delayed physical settlement.
    clock.advance(HISTORY_REQUEST_TIMEOUT_MS / 2 + 1)
    await settle()
    // The per-page boundary fired and the supply is aborted, but the physical query has not
    // settled yet: the next page must NOT start before settlement.
    expect(pageBStarted).toEqual([])
    expect(pageASettled).toEqual([])
    clock.advance(201)
    await vi.waitFor(() => expect(pageASettled.length).toBe(1))
    await vi.waitFor(() => expect(pageBStarted.length).toBe(1))
    // The successful page-b supply produces the response for the same attempt.
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'to-a')).toBe(true)
    })
  })

  it('fails over to the next page after a per-page timeout once the held query settles (requester)', async () => {
    const { fake, server, roomId, clock } = await setup()
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 2, url: '' } } })
    const inventoryStarts: string[] = []
    const pageAInventoryHeld: string[] = []
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } },
      (request, signal) => {
        if (request.mode !== 'inventory') return Promise.resolve({ records: [], done: true })
        pageAInventoryHeld.push(request.supplyId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => reject(signal.reason ?? new Error('aborted')), 200)
          })
        })
      }
    )
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 2, url: '' } } }, async (request) => {
      if (request.mode !== 'inventory') return Promise.resolve({ records: [], done: true })
      inventoryStarts.push(request.supplyId)
      return { records: [], done: true }
    })
    // A remote session starts the local requester's inventory sync.
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    await vi.waitFor(() => expect(pageAInventoryHeld.length).toBe(1))
    clock.advance(HISTORY_REQUEST_TIMEOUT_MS / 2 + 1)
    await settle()
    // The per-page boundary fired but the held inventory query has not settled: no failover yet.
    expect(inventoryStarts).toEqual([])
    clock.advance(201)
    // The requester fails over to page-b only after the held inventory query settles, then the
    // inventory request is sent to the peer.
    await vi.waitFor(() => expect(inventoryStarts.length).toBe(1))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
      expect(sent.length).toBeGreaterThan(0)
    })
  })

  it('never exceeds four active suppliers when canceling partial or waiting work', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const gates = new Map<string, () => void>()
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      await new Promise<void>((resolve) => {
        gates.set(request.syncId, resolve)
      })
      return { records: [], done: true }
    })
    for (let peer = 0; peer < 4; peer += 1) {
      fake.receive(roomId, `peer-${peer}`, session({ id: `user-${peer}`, name: `User ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, `peer-${peer}`, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `sat-${peer}`,
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
    }
    // peer-4 is a ready waiter; peer-5 is a partial (never scheduled) job.
    fake.receive(roomId, 'peer-4', session({ id: 'user-4', name: 'User 4', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-4', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'wait-4',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    fake.receive(roomId, 'peer-5', session({ id: 'user-5', name: 'User 5', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-5', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'partial-5',
      page: 0,
      messageIds: ['p'],
      done: false
    })
    await settle()
    expect(started.length).toBe(4)
    // Cancel the ready waiter (gap): its waiting projection is removed; no slot is released.
    fake.receive(roomId, 'peer-4', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'wait-4',
      page: 2,
      messageIds: [],
      done: true
    })
    await settle()
    // Cancel the partial provider (gap): it held no slot, so no waiter may be promoted.
    fake.receive(roomId, 'peer-5', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'partial-5',
      page: 2,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started.length).toBe(4)
    // A NEW waiter replaces the canceled one; releasing one active slot promotes exactly one and
    // the canceled waiter never starts.
    fake.receive(roomId, 'peer-6', session({ id: 'user-6', name: 'User 6', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-6', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'wait-6',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    const firstGate = [...gates.keys()][0]
    gates.get(firstGate)?.()
    gates.delete(firstGate)
    await vi.waitFor(() => expect(started.length).toBe(5))
    expect(started).toContain('wait-6')
    expect(started).not.toContain('wait-4')
  })

  it('releases non-active canonical jobs on lifecycle cleanup while a held active job stays counted', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      await new Promise<void>(() => {})
      return { records: [], done: true }
    })
    // One genuinely active held job first, then 31 partial jobs fill the pool to its 32-job cap.
    fake.receive(roomId, 'peer-32', session({ id: 'lc-user-32', name: 'LC 32', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-32', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'lc-active',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['lc-active']))
    for (let peer = 0; peer < 31; peer += 1) {
      const peerId = `peer-${peer}`
      fake.receive(roomId, peerId, session({ id: `lc-user-${peer}`, name: `LC ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `lc-partial-${peer}`,
        page: 0,
        messageIds: [`p-${peer}`],
        done: false
      })
      await settle()
    }
    // All 31 partial peers leave: cleanup must remove their canonical jobs IMMEDIATELY (no
    // physical settlement callback exists for them), so fresh unrelated work is admitted at once.
    Array.from({ length: 31 }, (_, peer) => `peer-${peer}`).forEach((peerId) => fake.peerLeave(roomId, peerId))
    await settle()
    // A fresh peer at the (now released) cap is admitted and its ready job starts immediately.
    fake.receive(roomId, 'peer-33', session({ id: 'lc-user-33', name: 'LC 33', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-33', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'lc-fresh',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['lc-active', 'lc-fresh']))
  })

  it('keeps the slot through a held response send on lifecycle cleanup and releases exactly once', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    // The snapshot supplies resolve immediately; the RESPONSE SEND is what hangs.
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.hangHistoryResponseSends()
    for (let peer = 0; peer < 4; peer += 1) {
      fake.peerJoin(roomId, `peer-${peer}`)
      fake.receive(roomId, `peer-${peer}`, session({ id: `hs-user-${peer}`, name: `HS ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, `peer-${peer}`, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `hs-${peer}`,
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
    }
    await vi.waitFor(() => expect(started.length).toBe(2))
    // The shared supplier-to-send pool counts every admitted job through its final send
    // settlement: peer-0/1's provider jobs hold two slots behind their held response sends, and
    // peer-1/2's requester inventory sends stay queued behind those held sends on the serial room
    // queue, retaining the remaining slots. A fifth peer is therefore a ready waiter.
    fake.receive(roomId, 'peer-4', session({ id: 'hs-user-4', name: 'HS 4', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-4', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'hs-4',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    // Lifecycle cleanup while the sends are invoked: the slots stay retained (no fifth stage).
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    await settle()
    expect(started.length).toBe(2)
    // The held sends settle: slots release exactly once and every queued waiter promotes in order.
    fake.releaseHistoryResponseSends()
    await vi.waitFor(() => expect(started.length).toBe(5))
    await settle()
    await settle()
    expect(started.length).toBe(5)
  })

  it('keeps the slot through a held response send on cancellation and releases exactly once', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    // The snapshot supplies resolve immediately; the RESPONSE SEND is what hangs.
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.hangHistoryResponseSends()
    for (let peer = 0; peer < 4; peer += 1) {
      fake.peerJoin(roomId, `peer-${peer}`)
      fake.receive(roomId, `peer-${peer}`, session({ id: `tc-user-${peer}`, name: `TC ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, `peer-${peer}`, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `tc-${peer}`,
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
    }
    await vi.waitFor(() => expect(started.length).toBe(2))
    // As above: two provider jobs hold their slots behind held response sends while the
    // queue-blocked requester sends retain the remaining shared slots; the fifth peer waits.
    fake.receive(roomId, 'peer-4', session({ id: 'tc-user-4', name: 'TC 4', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-4', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'tc-4',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    // A logical cancellation (out-of-order page) while peer-0's response send is still invoked:
    // the send-stage marker keeps the slot live, so no waiter may start before the send settles.
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'tc-0',
      page: 2,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started.length).toBe(2)
    // The sends settle in order: slots release exactly once and the queued waiters promote.
    fake.releaseHistoryResponseSends()
    await vi.waitFor(() => expect(started.length).toBe(5))
  })

  it('starts exactly one synchronization per connection; terminal same/different-ID replays are inert', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // One synchronization completes and its connection direction becomes terminal.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'conn-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['conn-a']))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'conn-a')).toBe(true)
    })
    // Replays of the same id and a different id are inert on the same connection.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'conn-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'conn-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['conn-a'])
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(1)
    // A physical leave followed by a fresh peer admission ends the terminal binding: the next
    // connection starts one independent synchronization with a fresh id.
    fake.peerLeave(roomId, 'peer-a')
    fake.peerJoin(roomId, 'peer-a')
    fake.receive(roomId, 'peer-a', session({ id: 'remote-user-b', name: 'Remote B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'conn-c',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['conn-a', 'conn-c']))
  })

  it('drops a page-one-first request without binding and lets the first valid page zero bind', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // A page-one-first request is invalid and never binds the direction.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-first',
      page: 1,
      messageIds: [],
      done: true
    })
    await settle()
    expect(started).toEqual([])
    // The first valid page zero (same or different id) binds the sole synchronization.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-first',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['gap-first']))
    // After completion the direction is terminal: replays are inert.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-first',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['gap-first'])
  })

  it('keeps terminal syncs inert until binding reset; the next connection starts independently', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    // One completed synchronization (peer-a) and one canceled (gap) synchronization (peer-b):
    // each connection direction is terminal after its synchronization ends.
    fake.receive(roomId, 'peer-a', session({ id: 'user-a', name: 'User A', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'done-sync',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['done-sync']))
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-sync',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['done-sync', 'gap-sync']))
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-sync',
      page: 2,
      messageIds: [],
      done: true
    })
    await settle()
    // Replays of both terminal ids on their connections are inert (same and different ids).
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'done-sync',
      page: 0,
      messageIds: [],
      done: true
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'another-id',
      page: 0,
      messageIds: [],
      done: true
    })
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-sync',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['done-sync', 'gap-sync'])
    // A physical leave followed by a fresh peer admission clears the old connection's terminal
    // bindings and starts one independent synchronization.
    fake.peerLeave(roomId, 'peer-a')
    fake.peerJoin(roomId, 'peer-a')
    fake.receive(roomId, 'peer-a', session({ id: 'user-a-b', name: 'User A2', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'fresh-after-reset',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['done-sync', 'gap-sync', 'fresh-after-reset']))
  })

  it('keeps provider and requester directions independent when syncId strings collide', async () => {
    const { fake, server, roomId } = await setup()
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      return { records: [], done: true }
    })
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // The local requester's own syncId is visible in its outgoing inventory request.
    const inventoryRequest = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const requesterSyncId = (inventoryRequest as { syncId: string }).syncId
    // The peer uses the SAME string for its own provider request: it completes and fences the
    // PROVIDER direction only.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: requesterSyncId,
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    // The requester's opposite-direction response with the same string must NOT be dropped by
    // the provider fence: it is applied normally.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: requesterSyncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('direction-kept')],
      done: true
    })
    await vi.waitFor(async () => expect(await projectedInboundIds(server)).toEqual(['direction-kept']))
  })

  it('clears both directional bindings on domain grace release and reconnects independently', async () => {
    const { clock, fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // The connection runs its one synchronization in both directions.
    const firstInventory = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const firstRequesterSyncId = (firstInventory[0] as { syncId: string }).syncId
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'prov-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['prov-a']))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'prov-a')).toBe(true)
    })
    // The requester completes: its terminal binding is retained on this connection.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: firstRequesterSyncId,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await settle()
    await settle()
    // Terminal connection: a replayed provider request is inert.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'prov-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['prov-a'])
    // Domain grace release through the production lifecycle: the room leaves after the grace.
    await removeServerTab(server, 1)
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    // A later room connection re-attaches the page and starts exactly one independent
    // synchronization per direction with no retained old progress.
    await server.attachPage({ domain: DOMAIN, caller: { tab: { id: 1, url: '' } } })
    // The page re-registers its history provider for the later connection.
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    // The later connection re-establishes its local room join, then the remote source reconnects.
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: { ...SITE, origin: DOMAIN } })
    await settle()
    await settle()
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(true))
    fake.receive(roomId, 'peer-a', session({ id: 'remote-user-b', name: 'Remote B', avatar: '' }))
    await settle()
    await settle()
    // The fresh requester uses a NEW syncId and sends its inventory again.
    await vi.waitFor(() => {
      const requests = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
      expect(requests.some((m) => (m as { syncId: string }).syncId !== firstRequesterSyncId)).toBe(true)
    })
    // The fresh provider synchronization completes with its own id.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'prov-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['prov-a', 'prov-b']))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'prov-b')).toBe(true)
    })
  })

  it('observes job acceptance at exactly 32 jobs and rejection of a new identity', async () => {
    const { fake, server, roomId } = await setup()
    // Every started supplier pipeline is held; the response is delivered only when released.
    const started: string[] = []
    const gates = new Map<string, () => void>()
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      await new Promise<void>((resolve) => {
        gates.set(request.syncId, resolve)
      })
      return { records: [], done: true }
    })
    // 32 peers submit partial inventories: exactly 32 canonical jobs are admitted but none are
    // ready, so no supplier pipeline starts (observable: no starts, no responses).
    for (let peer = 0; peer < 32; peer += 1) {
      const peerId = `peer-${peer}`
      fake.receive(roomId, peerId, session({ id: `sat-user-${peer}`, name: `Sat ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `sat-${peer}`,
        page: 0,
        messageIds: [`s-${peer}`],
        done: false
      })
      await settle()
    }
    expect(started).toEqual([])
    // An update to an existing job at exactly 32 is accepted: its final page makes the job ready,
    // so one supplier pipeline observably starts (positive outcome control).
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'sat-0',
      page: 1,
      messageIds: ['s-0-more'],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['sat-0']))
    // A NEW identity at exactly 32 jobs is rejected: its ready page is dropped, so no second
    // supplier pipeline ever starts even though a slot is free (negative outcome control).
    fake.receive(roomId, 'peer-32', session({ id: 'sat-user-32', name: 'Sat 32', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-32', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'sat-32',
      page: 0,
      messageIds: ['s-32'],
      done: true
    })
    await settle()
    expect(started).toEqual(['sat-0'])
    // Releasing the accepted pipeline delivers its response; the rejected identity never responds.
    gates.get('sat-0')?.()
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'sat-0')).toBe(true)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'sat-32')).toBe(false)
    })
  })

  it('rejects a new identity when the cumulative queue budget reaches 8KiB', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const gates = new Map<string, () => void>()
    await registerHistoryProvider(server, { domain: DOMAIN, caller: { tab: { id: 1, url: '' } } }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      await new Promise<void>((resolve) => {
        gates.set(request.syncId, resolve)
      })
      return { records: [], done: true }
    })
    // The first inventory page encodes to 8035 bytes (137 long ids): under the 8192 cumulative
    // budget. Its small completion page (1 id, ~94 bytes) still fits at ~8129 total.
    const bigIds = Array.from({ length: 137 }, (_, i) => `b-${String(i).padStart(4, '0')}-${'x'.repeat(48)}`)
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-0',
      page: 0,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // Complete big-0: the upsert keeps its cumulative bytes and the small final page still fits,
    // making the job ready so its supplier observably starts.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-0',
      page: 1,
      messageIds: ['b-0-final'],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['big-0']))
    // A NEW identity whose cumulative bytes would cross 8192 is rejected: it never starts a
    // supplier pipeline even though a slot is free (negative outcome control).
    fake.receive(roomId, 'peer-b', session({ id: 'sat-user-b', name: 'Sat B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-1',
      page: 0,
      messageIds: ['b-1'],
      done: true
    })
    await settle()
    expect(started).toEqual(['big-0'])
    // Releasing the accepted pipeline delivers its response; the rejected identity never responds.
    gates.get('big-0')?.()
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'big-0')).toBe(true)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'big-1')).toBe(false)
    })
  })

  it('keeps one peer in two domains as independent attempts without suppression', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    // The same source joins the first domain; its requester sends its own inventory request.
    fake.peerJoin(roomId, 'peer-a')
    await settle()
    fake.receive(roomId, 'peer-a', session())
    await vi.waitFor(() => {
      expect(fake.messages(roomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(true)
    })
    // The same source joins a second domain: a second independent requester must start.
    const OTHER_DOMAIN_2 = 'https://other-2.example'
    await server.attachPage({ domain: OTHER_DOMAIN_2, caller: { tab: { id: 2, url: '' } } })
    await server.joinChatRoom({ domain: OTHER_DOMAIN_2, user: USER, site: { ...SITE, origin: OTHER_DOMAIN_2 } })
    await registerHistoryProvider(
      server,
      { domain: OTHER_DOMAIN_2, caller: { tab: { id: 2, url: '' } } },
      async (): Promise<HistorySupplyResult> => ({ records: [], done: true })
    )
    await settle()
    const otherRoomId = getChatRoomId(OTHER_DOMAIN_2)
    fake.peerJoin(otherRoomId, 'peer-a')
    await settle()
    fake.receive(otherRoomId, 'peer-a', session())
    await vi.waitFor(() => {
      expect(fake.messages(otherRoomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(true)
    })
    // Completing the first domain's requester must not finish the second domain's attempt.
    const firstSync = (
      fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL) as {
        syncId: string
      }
    ).syncId
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: firstSync,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await settle()
    expect(fake.messages(otherRoomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(true)
  })
})
