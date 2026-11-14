import { Remesh } from 'remesh'
import * as v from 'valibot'
import type { ChatMessageRecord } from '@/domain/Message'
import { ChatMessageSchema, NativeWireCodec } from '@/protocol'
import { HOST_SILENCE_MS, HOST_SILENCE_WITH_PEERS_MS, MAX_BACKLOG_MESSAGES } from './Config'
import type { Channel, PageService, RuntimeEvent, RuntimeService, RuntimeSession } from './Contract'
import { ClockExtern, IdentityExtern, PageGatewayExtern, RoomTransportExtern, type PageGateway } from './Externs'
import type { RoomTransport } from './RoomTransport'
import { connectServices, PAGE_NAMESPACE, RUNTIME_NAMESPACE } from './Rpc'
import HistoryDomain from './domain/History'
import LifecycleDomain from './domain/Lifecycle'
import RoomDomain, { type Room } from './domain/Room'
import WorldDomain from './domain/World'
import { sendWire } from './domain/Wire'

export interface RuntimeDeps {
  transport: RoomTransport
  nextId: () => string
  now?: () => number
  /** Returns a reason when this host can no longer serve pages; the host is asked to replace itself. */
  unhealthyReason?: () => string | null
  onUnhealthy?: (reason: string) => void
  /**
   * The single way a host is replaced: used both when a page presses refresh and when the host
   * reports it can no longer serve pages. Each host owns what "replace" means.
   */
  resetHost?: () => void
}

const toSession = (session: RuntimeSession): RuntimeSession => ({
  sessionId: session.sessionId,
  user: session.user,
  joinedAt: session.joinedAt
})

const sessionsEvent = (room: Room): RuntimeEvent => ({
  type: 'sessions',
  local: toSession(room),
  remote: room.peers.map(toSession)
})

/** The whole Runtime. Nothing here knows which kind of host it runs in. */
export const createRuntime = ({
  transport,
  nextId,
  now = () => Date.now(),
  unhealthyReason,
  onUnhealthy,
  resetHost
}: RuntimeDeps) => {
  const pages = new Map<string, Set<PageService>>()
  const backlog = new Map<string, ChatMessageRecord[]>()
  const pagesOf = (site: string) => [...(pages.get(site) ?? [])]

  /** Asks one page of the site, moving on to the next when that page has gone away. */
  const askPage = async <Result>(site: string, ask: (page: PageService) => Promise<Result>): Promise<Result> => {
    let failure = new Error('No page is available for this site')
    for (const page of pagesOf(site)) {
      try {
        return await ask(page)
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error))
      }
    }
    throw failure
  }

  const gateway: PageGateway = {
    persist: (site, records, live) => askPage(site, (page) => page.persist(records, live)),
    readHistory: (site, cutoff) => askPage(site, (page) => page.readHistory(cutoff)),
    publish: (site, event) =>
      (site === null ? [...pages.values()].flatMap((set) => [...set]) : pagesOf(site)).forEach((page) => {
        void Promise.resolve(page.publish(event)).catch(() => {})
      })
  }

  const store = Remesh.store({
    externs: [
      RoomTransportExtern.impl(transport),
      ClockExtern.impl({ now }),
      IdentityExtern.impl({ nextId }),
      PageGatewayExtern.impl(gateway)
    ]
  })
  const lifecycle = store.getDomain(LifecycleDomain())
  const room = store.getDomain(RoomDomain())
  const world = store.getDomain(WorldDomain())
  const history = store.getDomain(HistoryDomain())
  store.igniteDomain(LifecycleDomain())
  store.igniteDomain(RoomDomain())
  store.igniteDomain(WorldDomain())
  store.igniteDomain(HistoryDomain())

  const roomOf = (site: string) => store.query(room.query.RoomQuery(site))

  // Projection: every change is pushed as the full current value.
  store.subscribeEvent(room.event.SessionsChangedEvent, (site) => {
    const current = roomOf(site)
    if (current?.joined) gateway.publish(site, sessionsEvent(current))
  })
  store.subscribeEvent(world.event.SitesChangedEvent, () =>
    gateway.publish(null, { type: 'world', sites: store.query(world.query.SitesQuery()) })
  )
  store.subscribeEvent(history.event.LoadingChangedEvent, (site) =>
    gateway.publish(site, { type: 'history', syncIds: store.query(history.query.LoadingQuery(site)) })
  )
  store.subscribeEvent(room.event.ErrorEvent, ({ domain, message }) =>
    gateway.publish(domain, { type: 'error', message })
  )
  store.subscribeEvent(history.event.ErrorEvent, ({ domain, message }) =>
    gateway.publish(domain, { type: 'error', message })
  )
  store.subscribeEvent(world.event.ErrorEvent, (message) => gateway.publish(null, { type: 'error', message }))
  store.subscribeEvent(room.event.ClosedEvent, ({ domain }) => backlog.delete(domain))
  // A room can believe it is joined while the host can no longer build peers, and then no join is
  // ever attempted. Probing costs a real RTCPeerConnection, so it waits for silence, and the wait
  // is a deadline re-armed by traffic rather than a timer that wakes up to look for silence.
  let silenceDeadline: ReturnType<typeof setTimeout> | null = null
  const probeAfterSilence = () => {
    silenceDeadline = null
    if (store.query(room.query.RoomsQuery()).every((item) => !item.joined)) return
    const reason = unhealthyReason?.() ?? null
    if (reason === null) armSilenceProbe()
    else onUnhealthy?.(reason)
  }
  /** With someone in the room, silence is a symptom; alone, it is just an empty room. */
  const silenceWait = () =>
    store.query(room.query.RoomsQuery()).some((item) => item.joined && item.peers.length > 0)
      ? HOST_SILENCE_WITH_PEERS_MS
      : HOST_SILENCE_MS
  const armSilenceProbe = () => {
    if (silenceDeadline !== null) clearTimeout(silenceDeadline)
    silenceDeadline = setTimeout(probeAfterSilence, silenceWait())
  }
  store.subscribeEvent(room.event.FrameSeenEvent, () => armSilenceProbe())
  store.subscribeEvent(room.event.JoinedEvent, () => armSilenceProbe())
  store.subscribeEvent(room.event.PeerConnectedEvent, () => armSilenceProbe())
  // Retries happen inside the Runtime, so the capability probe must run here and not only when a
  // page calls join: a host that cannot build peers would otherwise retry forever.
  store.subscribeEvent(room.event.JoinFailedEvent, () => {
    const reason = unhealthyReason?.() ?? null
    if (reason !== null) onUnhealthy?.(reason)
  })

  // Live messages are stored one at a time per site, so pages see them in arrival order.
  const deliveries = new Map<string, Promise<void>>()
  const deliver = (site: string, records: ChatMessageRecord[]) => {
    const next = (deliveries.get(site) ?? Promise.resolve()).then(async () => {
      try {
        await gateway.persist(site, records, true)
      } catch {
        // No page right now (grace period): keep them for the next page that connects.
        backlog.set(site, [...(backlog.get(site) ?? []), ...records].slice(-MAX_BACKLOG_MESSAGES))
      }
    })
    deliveries.set(site, next)
  }
  store.subscribeEvent(room.event.MessageReceivedEvent, ({ domain, record }) => deliver(domain, [record]))

  const whenJoined = (site: string) =>
    new Promise<Room>((resolve, reject) => {
      const current = roomOf(site)
      if (current?.joined) return resolve(current)
      const settle = (finish: () => void) => {
        subscriptions.forEach((subscription) => subscription.unsubscribe())
        finish()
      }
      const subscriptions = [
        store.subscribeEvent(room.event.JoinedEvent, (joined) => {
          if (joined === site) settle(() => resolve(roomOf(site)!))
        }),
        store.subscribeEvent(room.event.ClosedEvent, (closed) => {
          if (closed.domain === site) settle(() => reject(new Error('Room was closed')))
        })
      ]
    })

  const serviceFor = (site: string, page: PageService): RuntimeService => ({
    join: async (input) => {
      if (input.site.origin !== site) throw new Error('Site does not match the page origin')
      const unhealthy = unhealthyReason?.() ?? null
      if (unhealthy !== null) {
        onUnhealthy?.(unhealthy)
        throw new Error(unhealthy)
      }
      store.send(room.command.OpenCommand({ domain: site, ...input }))
      const joined = await whenJoined(site)
      void Promise.resolve(page.publish(sessionsEvent(joined))).catch(() => {})
      void Promise.resolve(page.publish({ type: 'world', sites: store.query(world.query.SitesQuery()) })).catch(
        () => {}
      )
      void Promise.resolve(
        page.publish({ type: 'history', syncIds: store.query(history.query.LoadingQuery(site)) })
      ).catch(() => {})
      return { ...toSession(joined), presenceId: joined.presenceId }
    },
    /** Refresh and recovery are the same operation: replace the host. */
    reconnect: async () => {
      resetHost?.()
    },
    send: async (command) => {
      let record: ChatMessageRecord | undefined
      const requestId = nextId()
      const subscription = store.subscribeEvent(room.event.MessageAllocatedEvent, (allocated) => {
        if (allocated.requestId === requestId) record = allocated.record
      })
      store.send(room.command.AllocateMessageCommand({ domain: site, requestId, command }))
      subscription.unsubscribe()
      if (!record) throw new Error('Runtime is not ready for this site')
      if (!v.is(ChatMessageSchema, record.message)) throw new Error('Invalid message.')
      await sendWire(transport, NativeWireCodec, roomOf(site)!.roomId, record.message)
      return record
    }
  })

  return {
    attach: (channel: Channel) => {
      const site = channel.domain
      let page!: PageService
      const service: RuntimeService = {
        join: (input) => serviceFor(site, page).join(input),
        reconnect: () => serviceFor(site, page).reconnect(),
        send: (command) => serviceFor(site, page).send(command)
      }
      page = connectServices<RuntimeService, PageService>(
        channel,
        { namespace: RUNTIME_NAMESPACE, service },
        PAGE_NAMESPACE
      )
      pages.set(site, (pages.get(site) ?? new Set()).add(page))
      store.send(lifecycle.command.AttachCommand(site))
      channel.onClose(() => {
        pages.get(site)?.delete(page)
        store.send(lifecycle.command.DetachCommand(site))
      })
      const pending = backlog.get(site)
      if (pending?.length) {
        backlog.delete(site)
        deliver(site, pending)
      }
    },
    dispose: () => {
      if (silenceDeadline !== null) clearTimeout(silenceDeadline)
      store.discard()
      transport.dispose()
    }
  }
}

export type Runtime = ReturnType<typeof createRuntime>
