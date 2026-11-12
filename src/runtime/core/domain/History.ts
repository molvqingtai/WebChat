import { Remesh } from 'remesh'
import { concatMap, filter, map, mergeMap, timer } from 'rxjs'
import { MESSAGE_RECORD_TYPE, compareEventPosition, type ChatMessageRecord } from '@/domain/Message'
import {
  MAX_HISTORY_RESPONSE_MESSAGES,
  MESSAGE_TYPE,
  type ChatRoomMessage,
  type ChatUser,
  type HistoryMessagesPull,
  type HistoryMessagesPush
} from '@/protocol'
import {
  HISTORY_IDLE_TIMEOUT_MS,
  HISTORY_INVENTORY_PAGE_IDS,
  HISTORY_WINDOW_MS,
  MAX_HISTORY_INVENTORY_IDS
} from '../Config'
import { ClockExtern, IdentityExtern, PageGatewayExtern, RoomTransportExtern, WireCodecExtern } from '../Externs'
import RoomDomain, { chatRoomId } from './Room'
import WireDomain, { errorMessage } from './Wire'

/** We asked `peerId` for what we are missing. */
interface Request {
  syncId: string
  domain: string
  peerId: string
  cutoff: number
  nextPage: number
  /** Bumped on every accepted page; an idle timer only fires for the value it was started with. */
  activity: number
  /** Something new was stored, so the pages show the loading toast. */
  visible: boolean
}

/** `peerId` is telling us what it already has. */
interface Inventory {
  syncId: string
  domain: string
  peerId: string
  cutoff: number
  nextPage: number
  ids: string[]
  done: boolean
}

type Source = { domain: string; peerId: string }

const HistoryDomain = Remesh.domain({
  name: 'HistoryDomain',
  impl: (domain) => {
    const transport = domain.getExtern(RoomTransportExtern)
    const codec = domain.getExtern(WireCodecExtern)
    const clock = domain.getExtern(ClockExtern)
    const identity = domain.getExtern(IdentityExtern)
    const pages = domain.getExtern(PageGatewayExtern)
    const wire = domain.getDomain(WireDomain())
    const room = domain.getDomain(RoomDomain())

    const RequestsState = domain.state<Request[]>({ name: 'History.RequestsState', default: [] })
    const InventoriesState = domain.state<Inventory[]>({ name: 'History.InventoriesState', default: [] })

    const LoadingQuery = domain.query({
      name: 'History.LoadingQuery',
      impl: ({ get }, site: string) =>
        get(RequestsState())
          .filter((request) => request.domain === site && request.visible)
          .map((request) => request.syncId)
    })

    const RequestStartedEvent = domain.event<Request>({ name: 'History.RequestStartedEvent' })
    const RequestActiveEvent = domain.event<{ syncId: string; activity: number }>({
      name: 'History.RequestActiveEvent'
    })
    const InventoryCompletedEvent = domain.event<Inventory>({ name: 'History.InventoryCompletedEvent' })
    const LoadingChangedEvent = domain.event<string>({ name: 'History.LoadingChangedEvent' })
    const ErrorEvent = domain.event<{ domain: string; message: string }>({ name: 'History.ErrorEvent' })

    const StartRequestCommand = domain.command({
      name: 'History.StartRequestCommand',
      impl: ({ get }, source: Source) => {
        const request: Request = {
          ...source,
          syncId: identity.nextId(),
          cutoff: clock.now() - HISTORY_WINDOW_MS,
          nextPage: 0,
          activity: 0,
          visible: false
        }
        return [
          RequestsState().new([...get(RequestsState()), request]),
          RequestStartedEvent(request),
          RequestActiveEvent({ syncId: request.syncId, activity: 0 })
        ]
      }
    })

    const AdvanceRequestCommand = domain.command({
      name: 'History.AdvanceRequestCommand',
      impl: ({ get }, input: { syncId: string; inserted: number; done: boolean }) => {
        const requests = get(RequestsState())
        const request = requests.find((item) => item.syncId === input.syncId)
        if (!request) return null
        const next = {
          ...request,
          nextPage: request.nextPage + 1,
          activity: request.activity + 1,
          visible: request.visible || input.inserted > 0
        }
        return [
          RequestsState().new(
            input.done
              ? requests.filter((item) => item !== request)
              : requests.map((item) => (item === request ? next : item))
          ),
          ...(input.done ? [] : [RequestActiveEvent({ syncId: next.syncId, activity: next.activity })]),
          ...((input.done ? request.visible : next.visible !== request.visible)
            ? [LoadingChangedEvent(request.domain)]
            : [])
        ]
      }
    })

    const EndRequestCommand = domain.command({
      name: 'History.EndRequestCommand',
      impl: ({ get }, input: { syncId: string; activity?: number; error?: string }) => {
        const requests = get(RequestsState())
        const request = requests.find((item) => item.syncId === input.syncId)
        if (!request || (input.activity !== undefined && input.activity !== request.activity)) return null
        return [
          RequestsState().new(requests.filter((item) => item !== request)),
          ...(request.visible ? [LoadingChangedEvent(request.domain)] : []),
          ...(input.error === undefined ? [] : [ErrorEvent({ domain: request.domain, message: input.error })])
        ]
      }
    })

    const ApplyPullCommand = domain.command({
      name: 'History.ApplyPullCommand',
      impl: ({ get }, { domain: site, peerId, message }: Source & { message: HistoryMessagesPull }) => {
        const inventories = get(InventoriesState())
        const exist = inventories.find((item) => item.domain === site && item.peerId === peerId)
        // One attempt per peer connection; a finished or broken one stays as a tombstone.
        if (exist ? exist.done || exist.syncId !== message.syncId : message.page !== 0) return null
        const current: Inventory = exist ?? {
          syncId: message.syncId,
          domain: site,
          peerId,
          cutoff: clock.now() - HISTORY_WINDOW_MS,
          nextPage: 0,
          ids: [],
          done: false
        }
        const valid =
          message.page === current.nextPage &&
          (message.done || message.messageIds.length > 0) &&
          current.ids.length + message.messageIds.length <= MAX_HISTORY_INVENTORY_IDS
        const next: Inventory = valid
          ? {
              ...current,
              nextPage: current.nextPage + 1,
              ids: [...current.ids, ...message.messageIds],
              done: message.done
            }
          : { ...current, ids: [], done: true }
        return [
          InventoriesState().new([...inventories.filter((item) => item !== exist), next]),
          ...(valid && next.done ? [InventoryCompletedEvent(next)] : [])
        ]
      }
    })

    const ForgetPeerCommand = domain.command({
      name: 'History.ForgetPeerCommand',
      impl: ({ get }, { domain: site, peerId }: Source) => {
        const involved = (item: Source) => item.domain === site && item.peerId === peerId
        const requests = get(RequestsState())
        return [
          RequestsState().new(requests.filter((item) => !involved(item))),
          InventoriesState().new(get(InventoriesState()).filter((item) => !involved(item))),
          ...(requests.some((item) => involved(item) && item.visible) ? [LoadingChangedEvent(site)] : [])
        ]
      }
    })

    /** Sends `items` as consecutive pages, shrinking a page until it fits one wire frame. */
    const sendPaged = async <Item>(
      target: Source,
      items: Item[],
      pageSize: number,
      build: (chunk: Item[], page: number, done: boolean) => ChatRoomMessage
    ) => {
      let rest = items
      let page = 0
      do {
        let chunk = rest.slice(0, pageSize)
        let payload: string | undefined
        while (payload === undefined) {
          try {
            payload = await codec.encode(build(chunk, page, chunk.length === rest.length))
          } catch (error) {
            if (chunk.length <= 1) throw error
            chunk = chunk.slice(0, Math.ceil(chunk.length / 2))
          }
        }
        await transport.send(chatRoomId(target.domain), payload, target.peerId)
        rest = rest.slice(chunk.length)
        page += 1
      } while (rest.length > 0)
    }

    const readChatRecords = async (site: string, cutoff: number) =>
      (await pages.readHistory(site, cutoff)).filter(
        (record) => record.type === MESSAGE_RECORD_TYPE.CHAT_MESSAGE && record.message.hlc.timestamp >= cutoff
      )

    domain.effect({
      name: 'History.StartEffect',
      impl: ({ fromEvent }) =>
        fromEvent(room.event.PeerConnectedEvent).pipe(
          map(({ domain: site, peerId }) => StartRequestCommand({ domain: site, peerId }))
        )
    })

    domain.effect({
      name: 'History.RequestEffect',
      impl: ({ fromEvent }) =>
        fromEvent(RequestStartedEvent).pipe(
          mergeMap(async (request) => {
            try {
              const records = await readChatRecords(request.domain, request.cutoff)
              const ids = records
                .toSorted((left, right) => compareEventPosition(right.message, left.message))
                .map((record) => record.id)
              await sendPaged(request, ids, HISTORY_INVENTORY_PAGE_IDS, (messageIds, page, done) => ({
                type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
                syncId: request.syncId,
                page,
                messageIds,
                done
              }))
              return null
            } catch {
              // The peer left or no page could be read; a later peer join starts a new sync.
              return EndRequestCommand({ syncId: request.syncId })
            }
          })
        )
    })

    domain.effect({
      name: 'History.IdleEffect',
      impl: ({ fromEvent }) =>
        fromEvent(RequestActiveEvent).pipe(
          mergeMap((active) => timer(HISTORY_IDLE_TIMEOUT_MS).pipe(map(() => EndRequestCommand(active))))
        )
    })

    domain.effect({
      name: 'History.RespondEffect',
      impl: ({ fromEvent }) =>
        fromEvent(InventoryCompletedEvent).pipe(
          mergeMap(async (inventory) => {
            try {
              const known = new Set(inventory.ids)
              const missing = (await readChatRecords(inventory.domain, inventory.cutoff))
                .filter((record) => !known.has(record.id))
                .toSorted((left, right) => compareEventPosition(left.message, right.message))
              await sendPaged(inventory, missing, MAX_HISTORY_RESPONSE_MESSAGES, (chunk, page, done) => {
                // Later records win, so each author appears with their most recent profile.
                const users = new Map<string, ChatUser>(chunk.map((record) => [record.user.id, record.user]))
                return {
                  type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
                  syncId: inventory.syncId,
                  page,
                  users: [...users.values()],
                  messages: chunk.map((record) => record.message),
                  done
                }
              })
              return null
            } catch (error) {
              return ErrorEvent({ domain: inventory.domain, message: errorMessage(error) })
            }
          })
        )
    })

    const mergePush = async (request: Request, message: HistoryMessagesPush) => {
      if (message.page !== request.nextPage) return EndRequestCommand({ syncId: request.syncId })
      if (message.messages.some((item) => item.hlc.timestamp < request.cutoff)) {
        return EndRequestCommand({ syncId: request.syncId })
      }
      const users = new Map(message.users.map((user) => [user.id, user]))
      const now = clock.now()
      const records = message.messages.map((item): ChatMessageRecord => ({
        type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
        id: item.id,
        message: item,
        user: users.get(item.userId) ?? { id: item.userId, name: item.userId, avatar: '' },
        receivedAt: now
      }))
      try {
        const inserted = records.length > 0 ? await pages.persist(request.domain, records, false) : 0
        const latest = message.messages.toSorted(compareEventPosition).at(-1)
        return [
          ...(latest ? [room.command.ObserveClockCommand(latest.hlc)] : []),
          AdvanceRequestCommand({ syncId: request.syncId, inserted, done: message.done })
        ]
      } catch (error) {
        return EndRequestCommand({ syncId: request.syncId, error: errorMessage(error) })
      }
    }

    // Pages are applied one at a time: the next one waits until the previous batch is stored.
    domain.effect({
      name: 'History.WireEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(wire.event.ChatFrameEvent).pipe(
          concatMap(async ({ roomId, peerId, message }) => {
            const site = get(room.query.RoomsQuery()).find((item) => item.roomId === roomId)?.domain
            if (site === undefined) return null
            if (message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL) {
              return ApplyPullCommand({ domain: site, peerId, message })
            }
            if (message.type !== MESSAGE_TYPE.HISTORY_MESSAGES_PUSH) return null
            const request = get(RequestsState()).find(
              (item) => item.syncId === message.syncId && item.domain === site && item.peerId === peerId
            )
            return request ? mergePush(request, message) : null
          }),
          filter((action) => action !== null)
        )
    })

    domain.effect({
      name: 'History.PeerDisconnectedEffect',
      impl: ({ fromEvent }) => fromEvent(room.event.PeerDisconnectedEvent).pipe(map(ForgetPeerCommand))
    })

    return { query: { LoadingQuery }, event: { LoadingChangedEvent, ErrorEvent } }
  }
})

export default HistoryDomain
