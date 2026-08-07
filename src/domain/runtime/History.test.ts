import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import HistoryDomain from './History'
import SessionDomain from './Session'
import WireDomain from './Wire'
import DeliveryDomain from './Delivery'
import { PagePort } from '@/runtime/PagePort'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import { PresenceStoreExtern } from '@/domain/runtime/externs/PresenceStore'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import { PagePortExtern } from '@/domain/runtime/externs/PagePort'
import { MESSAGE_TYPE } from '@/protocol'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { HistoryMessagesRequest, WireCodec, ChatRoomMessage } from '@/protocol'
import { getChatRoomId } from '@/runtime/Server'

const DOMAIN = 'https://example.com'
const ROOM_ID = getChatRoomId(DOMAIN)
const USER = { id: 'user-1', name: 'User', avatar: '' }

const jsonCodec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload)
}

const fakeTransport = () => {
  let messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | null = null
  const transport: RoomTransport = {
    peerId: 'local-peer',
    join: async () => {},
    leave: () => {},
    peers: () => [],
    send: async () => {},
    onMessage: (callback) => {
      messageListener = callback
      return () => {
        messageListener = null
      }
    },
    onPeerJoin: () => () => {},
    onPeerLeave: () => () => {},
    onRoomClose: () => () => {},
    onError: () => () => {},
    dispose: () => {}
  }
  return {
    transport,
    receive: (roomId: string, sourcePeerId: string, message: unknown) => {
      messageListener?.(roomId, sourcePeerId, JSON.stringify(message))
    }
  }
}

const setup = async () => {
  const pagePort = new PagePort()
  const { transport, receive } = fakeTransport()
  const store = Remesh.store({
    externs: [
      ClockExtern.impl({ now: () => 1_000_000 }),
      IdentityExtern.impl({ nextId: () => `id-${Math.random().toString(36).slice(2)}` }),
      PresenceStoreExtern.impl({
        load: async () => null,
        save: async () => {}
      }),
      RoomTransportExtern.impl(transport),
      WireCodecExtern.impl(jsonCodec),
      PagePortExtern.impl(pagePort)
    ]
  })
  const wireAction = WireDomain()
  const deliveryAction = DeliveryDomain()
  const sessionAction = SessionDomain()
  const historyAction = HistoryDomain()
  const wire = store.getDomain(wireAction)
  const delivery = store.getDomain(deliveryAction)
  const session = store.getDomain(sessionAction)
  const history = store.getDomain(historyAction)
  store.subscribeDomain(wireAction)
  store.subscribeDomain(deliveryAction)
  store.subscribeDomain(sessionAction)
  store.subscribeDomain(historyAction)
  store.igniteDomain(wireAction)
  store.igniteDomain(deliveryAction)
  store.igniteDomain(sessionAction)
  store.igniteDomain(historyAction)
  // Logical presence + committed runtime + a session binding driven through the real wire path.
  store.send(
    session.command.HydratePresenceCommand({
      domain: DOMAIN,
      lastJoinedAt: 1,
      local: { presenceId: 'presence-1', userId: USER.id, joinedAt: 1, status: 'active' },
      observers: []
    })
  )
  store.send(
    session.command.PrepareDomainCommand({
      attemptId: 'attempt-1',
      mode: 'join',
      domain: DOMAIN,
      user: USER,
      site: { origin: DOMAIN }
    })
  )
  store.send(session.command.CommitPreparedCommand('attempt-1'))
  store.send(wire.command.JoinRoomsCommand({ requestId: 'join-1', roomIds: [ROOM_ID] }))
  const sessionMessage: ChatRoomMessage = {
    type: MESSAGE_TYPE.SESSION,
    sessionId: 'session-1',
    presenceId: 'presence-1',
    joinedAt: 2,
    user: USER
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  receive(ROOM_ID, 'peer-a', sessionMessage)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { store, session, history, wire, delivery, pagePort, receive }
}

const providerRequest = (syncId: string, page: number, done: boolean): HistoryMessagesRequest => ({
  type: MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST,
  syncId,
  page,
  messageIds: [],
  done
})

type Fixture = Awaited<ReturnType<typeof setup>>
const sendProviderRequest = (
  store: Fixture['store'],
  history: Fixture['history'],
  syncId: string,
  page: number,
  done: boolean
) => {
  store.send(
    history.command.HandleInventoryPageCommand({
      roomId: ROOM_ID,
      sourcePeerId: 'peer-a',
      message: providerRequest(syncId, page, done)
    })
  )
}

describe('HistoryDomain dead-page projection', () => {
  it('publishes DeadPagesEvent exactly once for an all-genuine-failure selection', async () => {
    const { store, history, pagePort } = await setup()
    const deadPages = vi.fn()
    store.subscribeEvent(history.event.DeadPagesEvent, deadPages)
    // The page's provider throws synchronously when a snapshot supply is requested: the real
    // PagePort lifecycle removes the page and rejects the supply, and the domain publishes the
    // dead page exactly once.
    pagePort.provideHistory('page-a', DOMAIN, (event) => {
      if (event.type === 'request') throw new Error('page-a broken')
    })
    sendProviderRequest(store, history, 'dead-a', 0, true)
    await vi.waitFor(() => expect(deadPages).toHaveBeenCalledWith(['page-a']))
    expect(deadPages).toHaveBeenCalledOnce()
  })

  it('never reports healthy detached (null) candidates as dead pages', async () => {
    const { store, history, pagePort } = await setup()
    const deadPages = vi.fn()
    store.subscribeEvent(history.event.DeadPagesEvent, deadPages)
    // A real detached result: the page's provider is replaced while its snapshot supply is
    // pending, so the PagePort settles the old supply with null through the replacement
    // lifecycle. The selection exhausts without any dead-page report (the page stays healthy).
    const pendingSupplyIds: string[] = []
    pagePort.provideHistory('page-a', DOMAIN, (event) => {
      if (event.type === 'request') pendingSupplyIds.push(event.request.supplyId)
      if (event.type === 'cancel') {
        void pagePort.resolveHistorySupply('page-a', event.supplyId, { records: [], done: true })
      }
    })
    sendProviderRequest(store, history, 'null-sync', 0, true)
    await vi.waitFor(() => expect(pendingSupplyIds.length).toBe(1))
    // Replacing the page provider settles the pending snapshot with null (replacement mode).
    pagePort.provideHistory('page-a', DOMAIN, (event) => {
      if (event.type === 'request') pendingSupplyIds.push(event.request.supplyId)
    })
    await vi.waitFor(() => expect(deadPages).not.toHaveBeenCalled())
    expect(deadPages).not.toHaveBeenCalled()
    expect(pagePort.historyPageIds(DOMAIN)).toEqual(['page-a'])
  })
})
