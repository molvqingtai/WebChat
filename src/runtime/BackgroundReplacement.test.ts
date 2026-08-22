import { describe, expect, it, vi } from 'vitest'
import { MESSAGE_TYPE } from '@/protocol'
import { getChatRoomId } from '@/runtime/Server'
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
import type { RuntimeServer } from '@/runtime/Contract'

const DOMAIN = 'https://example.com'

const createTransport = () => {
  const joined = new Set<string>()
  const messageListeners = new Set<(roomId: string, sourcePeerId: string, payload: string) => void>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  const errorListeners = new Set<(error: Error, roomId: string) => void>()
  const transport: RoomTransport = {
    peerIdOf: (roomId) => (roomId.startsWith('WEB_CHAT_WORLD') ? 'local-peer' : `local-peer:${roomId}`),
    join: async (roomId) => {
      joined.add(roomId)
    },
    leave: (roomId) => {
      joined.delete(roomId)
    },
    send: async () => {},
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
    peerJoin: (roomId: string, peerId: string) => joinListeners.forEach((listener) => listener(roomId, peerId)),
    receive: (roomId: string, sourcePeerId: string, message: unknown) =>
      messageListeners.forEach((listener) => listener(roomId, sourcePeerId, JSON.stringify(message)))
  }
}

const caller = { tab: { id: 1, url: `${DOMAIN}/` } }

/**
 * One real DocumentClient survives a logical Background replacement through the same proxies:
 * the fake tab listener is the only notification path, exactly like the browser message bus.
 */
describe('DocumentClient across a logical Background replacement', () => {
  it('retires a physically pending B1 History supply on replacement without touching B2', async () => {
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
    let current = createServer({ transport: fake.transport, admission })
    const provideHistory = vi.fn()
    const resolveHistorySupply = vi.fn()
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
        provideHistory(payload)
        return current.provideHistory({ ...payload, caller }, callback)
      },
      ackInbound: (payload: { domain: string; sequence: number; inserted: boolean }) =>
        current.ackInbound({ ...payload, caller }),
      resolveHistorySupply: (payload: { supplyId: string; result: { records: never[]; done: boolean } }) => {
        resolveHistorySupply(payload)
        return current.resolveHistorySupply({ ...payload, caller })
      },
      rejectHistorySupply: (payload: { supplyId: string; reason: string }) =>
        current.rejectHistorySupply({ ...payload, caller })
    } as unknown as RuntimeServer

    const client = new DocumentClient({ coordinator, server: facade, domain: DOMAIN })
    listeners.add((message) => {
      if ((message as { type?: string }).type === 'runtime:state-changed') client.invalidate()
    })
    const messageStore = createMessageStore(createMemoryMessageDatabase('history-retirement'))
    const chat = new ChatRoom({ server: facade, messageStore, pageDomain: DOMAIN })
    client.registerApplier('chat', (projection) => chat.applyChat(projection))
    client.registerApplier('persistence', (projection, context) => chat.applyPersistence(projection, context))

    await client.init()
    // Join the room so the History domain admits a real peer requester pull.
    await facade.joinChatRoom({
      domain: DOMAIN,
      user: { id: 'local-user', name: 'Local', avatar: '' } as never,
      site: { origin: DOMAIN, title: 'Example' } as never
    })
    expect(provideHistory).toHaveBeenCalledTimes(1)

    // A real peer binds and issues a genuine History inventory pull; the ChatRoom's physical
    // MessageStore query starts and is held.
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
    fake.peerJoin(getChatRoomId(DOMAIN), 'peer-a')
    fake.receive(getChatRoomId(DOMAIN), 'peer-a', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-a',
      presenceId: 'presence-a',
      joinedAt: 1,
      user: { id: 'user-a', name: 'A', avatar: '' }
    })
    fake.receive(getChatRoomId(DOMAIN), 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'sync-1',
      page: 0,
      messageIds: [],
      done: true
    })
    const querySignal = await queryStarted.promise

    // Logical Background replacement arrives while B1's supply is still physically pending:
    // the reset owner (not a disposal path) must abort the old-host controller before the same
    // document re-registers and re-provides into the new Runtime.
    const b1 = current
    current = createServer({ transport: fake.transport, admission })
    notifyServerTabs(current)
    await vi.waitFor(async () => {
      expect((await readServerSnapshot(current)).domains[0]?.tabIds).toEqual([1])
    })
    expect(querySignal.aborted).toBe(true)
    await vi.waitFor(() => expect(provideHistory).toHaveBeenCalledTimes(2))

    // The B1 physical query now settles late (resolve branch): the old chain must not supply or
    // fail the replacement host, and must not mutate B2 provider/dedup state.
    releaseQuery.resolve([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolveHistorySupply).not.toHaveBeenCalled()
    expect((await readServerSnapshot(current)).failures).toEqual([])

    disposeServer(b1)
    disposeServer(current)
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
    let current = createServer({ transport: fake.transport, admission })
    const provideHistory = vi.fn()
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
      rejectHistorySupply: (payload: { supplyId: string; reason: string }) =>
        current.rejectHistorySupply({ ...payload, caller })
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
    current = createServer({ transport: fake.transport, admission })
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
