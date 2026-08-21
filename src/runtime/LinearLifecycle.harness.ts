/**
 * task #1539 Phase B — seeded generated lifecycle harness (test-only).
 *
 * Deterministic seeded generator + gate scheduler + identity/effect log + shrinker over the real
 * Runtime stack: real `createServer`, real `ClientLease`, real `ChatRoom`, real `WorldRoom`, wired
 * exactly like the production Page facade (`src/domain/impls/runtime/Client.ts` composition),
 * minus the comctx transport. Every asynchronous boundary that can reorder lifecycle outcomes is
 * an explicit gate the scheduler releases; wall time only advances as a scheduled step.
 *
 * This module never edits runtime source and never uses sleeps or microtask-order assumptions:
 * every execution choice comes from the seeded schedule.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ChatUser, ChatSite, TextMessage } from '@/protocol'
import { MESSAGE_TYPE } from '@/protocol'
import type { PresenceDomainRecord } from '@/domain/runtime/externs/PresenceStore'
import { createMessageStore, type InsertMessageResult, type MessageStore } from '@/domain/MessageStore'
import type { MessageRecord } from '@/domain/Message'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { WorldRoom } from '@/domain/impls/runtime/WorldRoom'
import { createConnectionLifecycle } from '@/domain/impls/ConnectionLifecycle'
import type { ConnectionLifecycleResult } from '@/domain/externs/ConnectionLifecycle'
import { ClientLease } from '@/runtime/ClientLease'
import type { RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { createServer, disposeServer, removeServerTab } from '@/runtime/Server'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { WireCodec } from '@/protocol'
import type { RuntimeCoordinator, RuntimePageCall } from '@/runtime/Contract'

export const HARNESS_DOMAIN = 'https://harness.example'
export const HARNESS_SITE: ChatSite = { origin: HARNESS_DOMAIN, title: 'Harness' }
export const harnessUser = (index: number): ChatUser => ({
  id: `harness-user-${index}`,
  name: `Harness ${index}`,
  avatar: ''
})

const jsonCodec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload)
}

/* ---------------------------------------------------------------- PRNG --- */

export const mulberry32 = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------- Logging --- */

export type LogEntry = {
  seq: number
  kind:
    | 'call.start'
    | 'call.settle'
    | 'page.terminal'
    | 'ready.publish'
    | 'world.attach.start'
    | 'world.attach.end'
    | 'transport.join.start'
    | 'transport.join.settle'
    | 'transport.leave'
    | 'presence.load.start'
    | 'presence.load.settle'
    | 'presence.save'
    | 'binding.invalidate'
    | 'binding.attach'
    | 'messagestore.insert.fail'
    | 'time.advance'
    | 'gate.release'
  detail: Record<string, unknown>
}

export class HarnessLog {
  private sequence = 0
  readonly entries: LogEntry[] = []
  record(kind: LogEntry['kind'], detail: Record<string, unknown> = {}) {
    this.entries.push({ seq: this.sequence++, kind, detail })
  }
  /** Normalized one-line trace used in failure reports and minimal counterexamples. */
  trace(): string[] {
    return this.entries.map((entry) => `${entry.seq}:${entry.kind}:${JSON.stringify(entry.detail)}`)
  }
}

/* -------------------------------------------------------------- Gates --- */

export interface HarnessGate<T = unknown> {
  id: number
  label: string
  meta: Record<string, unknown>
  readonly promise: Promise<T>
  readonly settled: boolean
  release(value: T): void
  fail(error: Error): void
}

/** Async context carrying the exact owning call identity through every continuation. */
export const callContext = new AsyncLocalStorage<{ a: number }>()

export class GateHub {
  private nextId = 0
  private readonly gates = new Map<
    number,
    HarnessGate & { resolve: (value: never) => void; reject: (e: Error) => void }
  >()
  /** Optional attribution hook: invoked synchronously when a gate is created. */
  onCreate: ((gate: HarnessGate) => void) | null = null
  /** Optional hook: invoked synchronously when a gate settles. */
  onSettle: ((gate: HarnessGate) => void) | null = null

  constructor(private readonly log: HarnessLog) {}

  create<T>(label: string, meta: Record<string, unknown> = {}): HarnessGate<T> {
    const id = this.nextId++
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const gate = {
      id,
      label,
      meta,
      settled: false,
      promise: new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      }),
      release: (value: T) => {
        if (gate.settled) return
        gate.settled = true
        this.gates.delete(id)
        this.onSettle?.(gate as never)
        resolve(value)
      },
      fail: (error: Error) => {
        if (gate.settled) return
        gate.settled = true
        this.gates.delete(id)
        this.onSettle?.(gate as never)
        reject(error)
      },
      resolve,
      reject
    }
    this.gates.set(id, gate as never)
    this.onCreate?.(gate as never)
    return gate
  }

  /** Pending gates in creation order — the only legal release candidates. */
  pending(): HarnessGate[] {
    return [...this.gates.values()].filter((gate) => !gate.settled)
  }
}

/* ----------------------------------------------------- Gated transport --- */

const createGatedTransport = (gates: GateHub, log: HarnessLog) => {
  const joined = new Set<string>()
  const messageListeners = new Set<(roomId: string, sourcePeerId: string, rawPayload: string) => void>()
  const peerJoinListeners = new Set<(roomId: string, peerId: string) => void>()
  const peerLeaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const roomCloseListeners = new Set<(roomId: string) => void>()
  const errorListeners = new Set<(error: Error, roomId: string) => void>()
  let joinSeq = 0

  const transport: RoomTransport = {
    peerIdOf: (roomId) => (joined.has(roomId) ? `harness-peer:${roomId}` : ''),
    join: (roomId) => {
      const q = ++joinSeq
      const gate = gates.create<void>('transport.join', { roomId, q })
      log.record('transport.join.start', { roomId, q, a: gate.meta.a })
      return gate.promise.then(
        () => {
          joined.add(roomId)
          log.record('transport.join.settle', { roomId, q, result: 'success', a: gate.meta.a })
        },
        (error) => {
          log.record('transport.join.settle', { roomId, q, result: 'failure', a: gate.meta.a })
          throw error
        }
      )
    },
    leave: (roomId) => {
      joined.delete(roomId)
      log.record('transport.leave', { roomId })
      // A pending provider join is NOT settled by leave: like a real provider, it settles only
      // when the physical operation later completes (gate release/failure). This is what makes
      // the exact Q terminal observably distinct from the leave dispatch.
    },
    send: async () => undefined,
    onMessage: (callback) => {
      messageListeners.add(callback)
      return () => messageListeners.delete(callback)
    },
    onPeerJoin: (callback) => {
      peerJoinListeners.add(callback)
      return () => peerJoinListeners.delete(callback)
    },
    onPeerLeave: (callback) => {
      peerLeaveListeners.add(callback)
      return () => peerLeaveListeners.delete(callback)
    },
    onRoomClose: (callback) => {
      roomCloseListeners.add(callback)
      return () => roomCloseListeners.delete(callback)
    },
    onError: (callback) => {
      errorListeners.add(callback)
      return () => errorListeners.delete(callback)
    },
    dispose: () => undefined
  }
  return { transport }
}

/* --------------------------------------------------- Gated presence store --- */

const createGatedPresenceStore = (gates: GateHub, log: HarnessLog) => {
  const records = new Map<string, PresenceDomainRecord>()
  let seq = 0
  const store = {
    load: (domain: string) => {
      const op = ++seq
      const gate = gates.create<PresenceDomainRecord | null>('presence.load', { domain, op })
      log.record('presence.load.start', { domain, op, a: gate.meta.a })
      return gate.promise.then((value) => {
        log.record('presence.load.settle', { domain, op, a: gate.meta.a })
        return value
      })
    },
    save: (record: PresenceDomainRecord) => {
      const gate = gates.create<void>('presence.save', { domain: record.domain })
      log.record('presence.save', { domain: record.domain, a: gate.meta.a })
      return gate.promise.then(() => {
        records.set(record.domain, record)
      })
    }
  }
  return { store, records }
}

/* --------------------------------------------------------- Harness world --- */

export interface HarnessCallResult {
  a: number
  page: number
  op: CallOp
  settled: 'success' | 'null' | 'error' | 'unsettled'
  error?: string
  pageTerminal?: ConnectionLifecycleResult
}

export type CallOp = 'join' | 'leave' | 'reconnect' | 'sendText'

export interface HarnessPage {
  index: number
  pageId: string
  tabId: number
  url: string
  lease: ClientLease
  chat: ChatRoom
  worldRoom: WorldRoom
  server: RuntimeServer
  lifecycle: ReturnType<typeof createConnectionLifecycle>
  worldAttachSettled: boolean
  readyPublished: boolean
  messageStore: Omit<MessageStore, 'insert'> & {
    insert(record: MessageRecord, options?: { signal?: AbortSignal }): Promise<InsertMessageResult>
  }
  /** When armed, the Page's next messageStore insert rejects — the auxiliary-notice failure gate. */
  failNextInsert: boolean
}

export interface HarnessWorld {
  seed: number
  log: HarnessLog
  gates: GateHub
  server: RuntimeServer
  pages: HarnessPage[]
  /** Marks a Page's browser binding as navigated away (same tab, new navigation URL). */
  navigate: (pageIndex: number) => Promise<void>
  /** Releases the Page's tab entirely (browser release edge). */
  releaseTab: (pageIndex: number) => Promise<void>
  /** Arms a one-shot gate on the next admission tabs.get — used to place an invalidation exactly
   * inside a post-effect revalidation window. */
  armTabsGate: () => void
  dispose: () => void
}

interface WorldConfig {
  seed: number
  pageCount: number
}

let messageDatabaseSeq = 0

export const createHarnessWorld = (config: WorldConfig): HarnessWorld => {
  const log = new HarnessLog()
  const gates = new GateHub(log)
  const { transport } = createGatedTransport(gates, log)
  const presence = createGatedPresenceStore(gates, log)

  const tabs = new Map<number, { id: number; url: string }>()
  let tabsGateArmed = false
  const storageState: Record<string, unknown> = {}
  const admission = {
    tabs: {
      get: async (tabId: number) => {
        if (tabsGateArmed) {
          tabsGateArmed = false
          const gate = gates.create<void>('admission.tabs.get', { tabId })
          await gate.promise
        }
        const tab = tabs.get(tabId)
        if (!tab) throw new Error(`tab ${tabId} missing`)
        return tab
      },
      sendMessage: async () => undefined
    },
    storage: {
      get: async (key: string) => ({ [key]: storageState[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(storageState, items)
      }
    },
    rebindPage: async () => undefined,
    ensureTransport: async () => undefined
  }

  const server = createServer({ transport, codec: jsonCodec, presenceStore: presence.store, admission })

  const attachedPages = new Map<string, number>()
  const coordinator: RuntimeCoordinator = {
    registerPage: async (payload) => {
      const pageIndex = Number(payload.pageId!.split('-').pop())
      if (attachedPages.has(payload.pageId!)) {
        // A re-registration of the same Page tuple retires the exact prior binding object.
        log.record('binding.invalidate', { page: pageIndex, cause: 'replacement' })
      }
      const snapshot = await server.attachPage({
        domain: payload.domain,
        pageId: payload.pageId!,
        // The production comctx adapter injects trusted caller facts; the harness coordinator does
        // the same from its browser-tab table.
        caller: { tab: tabs.get(1000 + pageIndex)! }
      })
      attachedPages.set(payload.pageId!, pageIndex)
      log.record('binding.attach', { page: pageIndex })
      return { snapshot }
    }
  }

  const pages: HarnessPage[] = []
  let navigateSeq = 0
  for (let index = 0; index < config.pageCount; index += 1) {
    const pageId = `harness-page-${config.seed}-${index}`
    const tabId = 1000 + index
    const url = `${HARNESS_DOMAIN}/page-${index}`
    tabs.set(tabId, { id: tabId, url })

    const lease = new ClientLease({ coordinator, pageId, domain: HARNESS_DOMAIN })
    const page: HarnessPage = {
      index,
      pageId,
      tabId,
      url,
      lease,
      worldAttachSettled: false,
      readyPublished: false,
      failNextInsert: false
    } as HarnessPage

    // Page facade: identical to src/domain/impls/runtime/Client.ts bindPage, plus identity log taps.
    const withBinding = <Payload extends object>(payload: Payload): Payload & RuntimePageCall =>
      ({
        ...payload,
        pageId,
        runtimeHostId: lease.runtimeHostId(),
        caller: { tab: tabs.get(tabId)! }
      }) as Payload & RuntimePageCall
    const bound: RuntimeServer = {
      attachPage: (payload) => server.attachPage(withBinding(payload)),
      detachPage: (payload) => server.detachPage(withBinding(payload)),
      getSnapshot: () => server.getSnapshot(),
      joinChatRoom: (payload) => server.joinChatRoom(withBinding(payload)),
      leaveChatRoom: (payload) => server.leaveChatRoom(withBinding(payload)),
      allocateTextMessage: (payload) => server.allocateTextMessage(withBinding(payload)),
      allocateReactionMessage: (payload) => server.allocateReactionMessage(withBinding(payload)),
      sendChatMessage: (payload) => server.sendChatMessage(withBinding(payload)),
      ackInbound: (payload) => server.ackInbound(withBinding(payload)),
      replayInbound: (payload) => server.replayInbound(withBinding(payload)),
      reconnectDomain: (payload) => server.reconnectDomain(withBinding(payload)),
      onInbound: (payload, callback) => server.onInbound(withBinding(payload), callback),
      onSessionEvent: (payload, callback) => server.onSessionEvent(withBinding(payload), callback),
      onWorldPresence: (payload, callback) => server.onWorldPresence(withBinding(payload), callback),
      onError: (payload, callback) => server.onError(withBinding(payload), callback),
      onHistoryFeedback: (payload, callback) => server.onHistoryFeedback(withBinding(payload), callback),
      provideHistory: (payload, callback) => server.provideHistory(withBinding(payload), callback),
      resolveHistorySupply: (payload) => server.resolveHistorySupply(withBinding(payload)),
      rejectHistorySupply: (payload) => server.rejectHistorySupply(withBinding(payload))
    }

    const rawMessageStore = createMessageStore(
      createMemoryMessageDatabase(`harness-${config.seed}-${index}-${messageDatabaseSeq++}`)
    )
    const messageStore: HarnessPage['messageStore'] = {
      ...rawMessageStore,
      insert: (record: MessageRecord, options?: { signal?: AbortSignal }) => {
        if (page.failNextInsert) {
          page.failNextInsert = false
          log.record('messagestore.insert.fail', { page: index, id: record.id })
          return Promise.reject(new Error('harness injected notice failure'))
        }
        return (rawMessageStore as HarnessPage['messageStore']).insert(record, options)
      }
    }
    const getSnapshot = (): RuntimeSnapshot => lease.snapshot()
    const whenAttach = (callback: () => void | Promise<void>) => lease.whenAttach(callback)

    const chat = new ChatRoom({
      server: bound,
      messageStore,
      pageDomain: HARNESS_DOMAIN,
      pageId,
      getSnapshot,
      whenAttach
    })
    const lifecycle = createConnectionLifecycle()
    chat.bindConnectionResultReporter((token, result) => {
      log.record('page.terminal', { page: index, token, result })
      lifecycle.report(token, result)
    })
    chat.bindStandaloneInvocation(lifecycle.value.mint, lifecycle.value.bindTask)

    const worldRoom = new WorldRoom({ server: bound, pageId, getSnapshot, whenAttach })

    page.chat = chat
    page.worldRoom = worldRoom
    page.server = bound
    page.lifecycle = lifecycle
    page.messageStore = messageStore
    // Ready publication tap: the exact point ClientLease publishes ready to Page consumers.
    lease.whenReady(() => {
      page.readyPublished = true
      log.record('ready.publish', { page: index, worldAttachSettled: page.worldAttachSettled })
    })
    // World attach settlement tap: queued after WorldRoom's own attach hook, so `getState()`
    // resolves only after that exact attachment generation physically completed.
    lease.whenAttach(() => {
      log.record('world.attach.start', { page: index })
      page.worldAttachSettled = false
      return worldRoom.getState().then(() => {
        page.worldAttachSettled = true
        log.record('world.attach.end', { page: index })
      })
    })
    pages.push(page)
  }

  return {
    seed: config.seed,
    log,
    gates,
    server,
    pages,
    navigate: async (pageIndex) => {
      const page = pages[pageIndex]
      navigateSeq += 1
      const nextUrl = `${HARNESS_DOMAIN}/page-${pageIndex}/nav-${navigateSeq}`
      tabs.set(page.tabId, { id: page.tabId, url: nextUrl })
      log.record('binding.invalidate', { page: pageIndex, cause: 'navigation' })
      // Production navigation handling: tabs.onUpdated -> removeServerTab with the new URL retires
      // the exact binding object synchronously through the Server.
      await removeServerTab(server, page.tabId, nextUrl)
    },
    releaseTab: async (pageIndex) => {
      const page = pages[pageIndex]
      log.record('binding.invalidate', { page: pageIndex, cause: 'release' })
      await removeServerTab(server, page.tabId)
    },
    armTabsGate: () => {
      tabsGateArmed = true
    },
    dispose: () => {
      pages.forEach((page) => {
        page.chat.dispose()
        page.lease.detach()
      })
      disposeServer(server)
    }
  }
}

/* ------------------------------------------------------ Schedule model --- */

export type ScheduleStep =
  | { kind: 'init-page'; page: number }
  | { kind: 'start-call'; call: number }
  | { kind: 'release-gate'; pick: number }
  | { kind: 'fail-gate'; pick: number }
  | { kind: 'advance'; ms: number }
  | { kind: 'navigate'; page: number }
  | { kind: 'release-tab'; page: number }
  | { kind: 'arm-insert-failure'; page: number }
  | { kind: 'arm-tabs-gate' }

export interface CallSpec {
  page: number
  op: CallOp
  body?: string
}

export interface Schedule {
  seed: number
  pageCount: number
  calls: CallSpec[]
  steps: ScheduleStep[]
}

const OPS: CallOp[] = ['join', 'leave', 'reconnect', 'sendText']

/**
 * Deterministic seeded generator: 1-3 real distinguishable Pages, 1-3 calls per Page drawn from
 * the real Page facade operations, interleaved with gate releases, time advances, navigation, and
 * release edges. `pick` values are PRNG-baked; validity is decided at execution (a release with no
 * pending gate is causally invalid and rejected by the harness, never silently skipped).
 */
export const generateSchedule = (seed: number): Schedule => {
  const rng = mulberry32(seed)
  const pageCount = 1 + Math.floor(rng() * 3)
  const calls: CallSpec[] = []
  for (let page = 0; page < pageCount; page += 1) {
    const callCount = 1 + Math.floor(rng() * 3)
    for (let i = 0; i < callCount; i += 1) {
      calls.push({ page, op: OPS[Math.floor(rng() * OPS.length)], body: `seed-${seed}-call-${calls.length}` })
    }
  }
  const steps: ScheduleStep[] = []
  // Every Page boots through the real ClientLease init before its first call.
  for (let page = 0; page < pageCount; page += 1) steps.push({ kind: 'init-page', page })
  calls.forEach((_, call) => steps.push({ kind: 'start-call', call }))
  const envCount = 4 + Math.floor(rng() * 6)
  for (let i = 0; i < envCount; i += 1) {
    const roll = rng()
    if (roll < 0.45) steps.push({ kind: 'release-gate', pick: Math.floor(rng() * 4) })
    else if (roll < 0.6) steps.push({ kind: 'advance', ms: [1000, 5000, 10000][Math.floor(rng() * 3)] })
    else if (roll < 0.75 && pageCount > 1) steps.push({ kind: 'navigate', page: Math.floor(rng() * pageCount) })
    else if (roll < 0.85 && pageCount > 1) steps.push({ kind: 'release-tab', page: Math.floor(rng() * pageCount) })
    else steps.push({ kind: 'fail-gate', pick: Math.floor(rng() * 3) })
  }
  // Interleave environment steps among the call starts deterministically.
  const interleaved: ScheduleStep[] = []
  const queue = [...steps]
  const env = queue.splice(pageCount + calls.length)
  while (queue.length > 0 || env.length > 0) {
    if (queue.length > 0) interleaved.push(queue.shift()!)
    if (env.length > 0 && rng() < 0.6) interleaved.push(env.shift()!)
  }
  interleaved.push(...env)
  return { seed, pageCount, calls, steps: interleaved }
}

/* ------------------------------------------------------------ Scheduler --- */

export interface RunResult {
  schedule: Schedule
  log: HarnessLog
  results: HarnessCallResult[]
  invalidSteps: ScheduleStep[]
  error?: unknown
}

export interface SchedulerDriver {
  /** Advances fake wall time; the only legal time source. */
  advanceTime: (ms: number) => Promise<void>
  /** Lets already-settled work flush without advancing time; must not reorder gated work. */
  flush: () => Promise<void>
}

export const runSchedule = async (schedule: Schedule, driver: SchedulerDriver): Promise<RunResult> => {
  const world = createHarnessWorld({ seed: schedule.seed, pageCount: schedule.pageCount })
  const { log, gates } = world
  const results: HarnessCallResult[] = schedule.calls.map((call, index) => ({
    a: index,
    page: call.page,
    op: call.op,
    settled: 'unsettled'
  }))
  const invalidSteps: ScheduleStep[] = []

  // Exact gate->call attribution via async context: the gate is owned by the call whose
  // continuation created it — even after that call settled Page-side (the Server stack outlives
  // the Page terminal, exactly what classes 1/2 must observe). The unsettled-call list is only a
  // fallback for gates created outside any call context (e.g. during Page init).
  const gateOwner = new Map<number, number>()
  const pendingGateByCall = new Map<number, number>()
  gates.onCreate = (gate) => {
    const contextual = callContext.getStore()?.a
    const owner =
      contextual ?? results.find((result) => result.settled === 'unsettled' && !pendingGateByCall.has(result.a))?.a
    if (owner !== undefined) {
      gateOwner.set(gate.id, owner)
      pendingGateByCall.set(owner, gate.id)
      gate.meta.a = owner
    }
  }
  gates.onSettle = (gate) => {
    const owner = gateOwner.get(gate.id)
    if (owner !== undefined && pendingGateByCall.get(owner) === gate.id) pendingGateByCall.delete(owner)
  }

  const startCall = (index: number) => {
    const spec = schedule.calls[index]
    const page = world.pages[spec.page]
    const result = results[index]
    const a = index
    log.record('call.start', { a, page: spec.page, op: spec.op })
    const user = harnessUser(spec.page)
    callContext.run({ a }, () => {
      try {
        if (spec.op === 'join') {
          const task = page.chat.joinRoom({ user, site: HARNESS_SITE })
          const finalize = (settled: HarnessCallResult['settled'], error?: Error) => {
            result.settled = settled
            result.error = error ? `${error.name}: ${error.message}` : undefined
            // Exact Page-published terminal for this exact invocation task (one-shot read).
            result.pageTerminal = page.lifecycle.value.getTaskResult(task)
            log.record('call.settle', {
              a,
              result: settled,
              error: result.error,
              pageTerminal: result.pageTerminal
            })
          }
          task.then(
            () => finalize('success'),
            (error: Error) => finalize(error?.name === 'AbortError' ? 'null' : 'error', error)
          )
        } else if (spec.op === 'leave') {
          const task = page.chat.leaveRoom()
          const finalize = (settled: HarnessCallResult['settled'], error?: Error) => {
            result.settled = settled
            result.error = error ? `${error.name}: ${error.message}` : undefined
            result.pageTerminal = page.lifecycle.value.getTaskResult(task)
            log.record('call.settle', {
              a,
              result: settled,
              error: result.error,
              pageTerminal: result.pageTerminal
            })
          }
          task.then(
            () => finalize('success'),
            (error: Error) => finalize(error?.name === 'AbortError' ? 'null' : 'error', error)
          )
        } else if (spec.op === 'reconnect') {
          page.server
            .reconnectDomain({ domain: HARNESS_DOMAIN })
            .then((value) => {
              result.settled = value === null ? 'null' : 'success'
              log.record('call.settle', { a, result: result.settled })
            })
            .catch((error: Error) => {
              result.settled = 'error'
              result.error = `${error?.name}: ${error?.message}`
              log.record('call.settle', { a, result: 'error', error: result.error })
            })
        } else {
          const event: TextMessage = {
            type: MESSAGE_TYPE.TEXT,
            id: `msg-${schedule.seed}-${a}`,
            hlc: { timestamp: 1_800_000_000_000 + a, counter: 0 },
            userId: user.id,
            body: spec.body ?? `call-${a}`,
            mentions: []
          }
          page.chat
            .sendMessage({ type: 'text', body: event.body, mentions: [] })
            .then(() => {
              result.settled = 'success'
              log.record('call.settle', { a, result: 'success' })
            })
            .catch((error: Error) => {
              result.settled = error?.name === 'AbortError' ? 'null' : 'error'
              result.error = `${error?.name}: ${error?.message}`
              log.record('call.settle', { a, result: result.settled, error: result.error })
            })
        }
      } catch (error) {
        result.settled = 'error'
        result.error = String(error)
        log.record('call.settle', { a, result: 'error', error: result.error })
      }
    })
  }

  let error: unknown
  try {
    for (const step of schedule.steps) {
      if (step.kind === 'init-page') {
        if (!world.pages[step.page]) {
          invalidSteps.push(step)
          continue
        }
        await world.pages[step.page].lease.init()
        await driver.flush()
      } else if (step.kind === 'start-call') {
        if (!schedule.calls[step.call]) {
          invalidSteps.push(step)
          continue
        }
        startCall(step.call)
        await driver.flush()
      } else if (step.kind === 'release-gate' || step.kind === 'fail-gate') {
        const pending = gates.pending()
        if (pending.length === 0) {
          // No gated work can currently proceed: the step is a deterministic no-op, not a causal
          // violation (a later step may still create gates).
          log.record('gate.release', { gate: null, mode: 'noop' })
          continue
        }
        const gate = pending[step.pick % pending.length]
        log.record('gate.release', { gate: gate.label, meta: gate.meta, mode: step.kind })
        if (step.kind === 'release-gate') {
          ;(gate as HarnessGate<unknown>).release(undefined as never)
        } else {
          gate.fail(new Error(`harness injected ${gate.label} failure`))
        }
        await driver.flush()
      } else if (step.kind === 'advance') {
        log.record('time.advance', { ms: step.ms })
        await driver.advanceTime(step.ms)
        await driver.flush()
      } else if (step.kind === 'navigate') {
        if (!world.pages[step.page]) {
          invalidSteps.push(step)
          continue
        }
        await world.navigate(step.page)
        await driver.flush()
      } else if (step.kind === 'release-tab') {
        if (!world.pages[step.page]) {
          invalidSteps.push(step)
          continue
        }
        await world.releaseTab(step.page)
        await driver.flush()
      } else if (step.kind === 'arm-insert-failure') {
        if (!world.pages[step.page]) {
          invalidSteps.push(step)
          continue
        }
        world.pages[step.page].failNextInsert = true
      } else if (step.kind === 'arm-tabs-gate') {
        world.armTabsGate()
      }
    }
    // Deterministic drain: release remaining gates in creation order, advancing time only when no
    // gate can make progress, until every call settles or the drain cap trips.
    for (let round = 0; round < 200 && results.some((result) => result.settled === 'unsettled'); round += 1) {
      const pending = gates.pending()
      if (pending.length > 0) {
        const gate = pending[0]
        log.record('gate.release', { gate: gate.label, meta: gate.meta, mode: 'drain' })
        ;(gate as HarnessGate<unknown>).release(undefined as never)
        await driver.flush()
      } else {
        log.record('time.advance', { ms: 1000, drain: true })
        await driver.advanceTime(1000)
        await driver.flush()
      }
    }
  } catch (caught) {
    error = caught
  } finally {
    world.dispose()
  }
  return { schedule, log, results, invalidSteps, error }
}

/* -------------------------------------------------------------- Shrinker --- */

/**
 * Greedy deterministic shrinker: repeatedly re-run with one element removed (page, call, or step)
 * while the failure predicate still reproduces. Returns the smallest still-failing schedule.
 */
export const shrinkSchedule = async (
  failing: Schedule,
  predicate: (result: RunResult) => boolean,
  driver: SchedulerDriver
): Promise<{ schedule: Schedule; result: RunResult }> => {
  let current = failing
  let currentResult = await runSchedule(current, driver)
  if (!predicate(currentResult)) throw new Error('schedule does not reproduce the failure')

  let improved = true
  while (improved) {
    improved = false
    // Try removing each call (and its start step).
    for (let call = 0; call < current.calls.length; call += 1) {
      const candidate: Schedule = {
        ...current,
        calls: current.calls.filter((_, index) => index !== call),
        steps: current.steps.filter((step) => step.kind !== 'start-call' || step.call !== call)
      }
      const result = await runSchedule(candidate, driver)
      if (predicate(result)) {
        current = candidate
        currentResult = result
        improved = true
        break
      }
    }
    if (improved) continue
    // Try removing each environment step.
    for (let index = 0; index < current.steps.length; index += 1) {
      const step = current.steps[index]
      if (step.kind === 'init-page' || step.kind === 'start-call') continue
      const candidate: Schedule = { ...current, steps: current.steps.filter((_, i) => i !== index) }
      const result = await runSchedule(candidate, driver)
      if (predicate(result)) {
        current = candidate
        currentResult = result
        improved = true
        break
      }
    }
  }
  return { schedule: current, result: currentResult }
}

/* --------------------------------------------------------------- Oracles --- */

/**
 * O1 (class 1): no durable presence effect from an invalidated binding's continuation.
 * A `presence.save` is a violation if the only Page that could own it was invalidated before the
 * save and its call was still unsettled at invalidation time.
 */
export const oracleNoStalePresenceEffect = (result: RunResult): string[] => {
  const violations: string[] = []
  const invalidations = result.log.entries.filter((entry) => entry.kind === 'binding.invalidate')
  for (const save of result.log.entries.filter((entry) => entry.kind === 'presence.save')) {
    const owner = save.detail.a
    if (typeof owner !== 'number') continue
    const ownerCall = result.results[owner]
    if (!ownerCall) continue
    for (const invalid of invalidations) {
      if (invalid.seq >= save.seq || invalid.detail.page !== ownerCall.page) continue
      // The save is a violation only if its exact owning call started before the invalidation and
      // had not settled by then (i.e. the save comes from the stale suspended continuation).
      const started = result.log.entries.some(
        (entry) => entry.kind === 'call.start' && entry.detail.a === owner && entry.seq < invalid.seq
      )
      const settledBefore = result.log.entries.some(
        (entry) => entry.kind === 'call.settle' && entry.detail.a === owner && entry.seq < invalid.seq
      )
      if (started && !settledBefore) {
        violations.push(
          `presence.save seq=${save.seq} owned by call a=${owner} (page=${ownerCall.page}) executed after that page's binding.invalidate seq=${invalid.seq} while the call was still suspended`
        )
      }
    }
  }
  return violations
}

/**
 * O2 (class 2): one issued action has one terminal, owned by the Server. A Page-published
 * `failed`/`cancelled` terminal while the Server-side call later settled `success` (or vice
 * versa) is a violation; a Page terminal for a call the Server never issued is admission-only
 * and legal.
 */
export const oracleSingleTerminalOwner = (result: RunResult): string[] => {
  const violations: string[] = []
  for (const call of result.results) {
    if (call.op !== 'join' && call.op !== 'leave') continue
    if (call.settled === 'unsettled') continue
    const published = call.pageTerminal
    if (!published || published === 'active') continue
    const pageClaimsFailure = published === 'failed' || published === 'cancelled'
    const serverSucceeded = call.settled === 'success'
    if (pageClaimsFailure && serverSucceeded) {
      const start = result.log.entries.find((e) => e.kind === 'call.start' && e.detail.a === call.a)
      violations.push(
        `call a=${call.a} page=${call.page} op=${call.op}: Page published '${published}' but the Server-side invocation settled 'success' (call.start seq=${start?.seq})`
      )
    }
  }
  return violations
}

/**
 * O3 (class 3): ready is published only after the exact World attach settled.
 */
export const oracleReadyAfterWorldAttach = (result: RunResult): string[] => {
  const violations: string[] = []
  for (const entry of result.log.entries.filter((entry) => entry.kind === 'ready.publish')) {
    if (entry.detail.worldAttachSettled === false) {
      const attachEnd = result.log.entries.find(
        (later) => later.kind === 'world.attach.end' && later.detail.page === entry.detail.page && later.seq > entry.seq
      )
      violations.push(
        `ready.publish seq=${entry.seq} for page=${String(entry.detail.page)} fired before world.attach.end${
          attachEnd ? ` seq=${attachEnd.seq}` : ' (never settled)'
        }`
      )
    }
  }
  return violations
}

/**
 * O4 (class 4 / P2): harness validity — the schedule must have produced a genuine generated
 * execution: no invalid causal steps, an identity-bearing trace, and non-trivial coverage.
 */
export const oracleHarnessValidity = (result: RunResult): string[] => {
  const violations: string[] = []
  if (result.invalidSteps.length > 0) {
    violations.push(`schedule contains ${result.invalidSteps.length} causally invalid step(s)`)
  }
  const callStarts = result.log.entries.filter((entry) => entry.kind === 'call.start')
  if (callStarts.length !== result.schedule.calls.length) {
    violations.push(`only ${callStarts.length}/${result.schedule.calls.length} generated calls started`)
  }
  return violations
}

/**
 * O5 (mutation 6): auxiliary self-notice persistence can never rewrite a committed Server join
 * terminal. The injected notice failure marker can only surface after `joinChatRoom` returned a
 * committed snapshot, so any call settling with it is a terminal-rewrite violation.
 */
export const oracleNoticeNeverRewritesTerminal = (result: RunResult): string[] => {
  const violations: string[] = []
  for (const call of result.results) {
    if (call.error?.includes('harness injected notice failure')) {
      violations.push(
        `call a=${call.a} page=${call.page}: auxiliary self-notice failure settled the join as '${call.settled}'/pageTerminal='${call.pageTerminal}' after the Server had committed the join`
      )
    }
  }
  return violations
}

export const ALL_ORACLES = {
  O1_noStalePresenceEffect: oracleNoStalePresenceEffect,
  O2_singleTerminalOwner: oracleSingleTerminalOwner,
  O3_readyAfterWorldAttach: oracleReadyAfterWorldAttach,
  O5_noticeNeverRewritesTerminal: oracleNoticeNeverRewritesTerminal,
  O4_harnessValidity: oracleHarnessValidity
} as const
