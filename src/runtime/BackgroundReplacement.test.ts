import { describe, expect, it, vi } from 'vitest'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { createMessageStore } from '@/domain/MessageStore'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { DocumentClient } from '@/runtime/DocumentClient'
import { createServer, disposeServer, notifyServerTabs, type RuntimeAdmission } from '@/runtime/Server'
import type { RuntimeServer } from '@/runtime/Contract'

const DOMAIN = 'https://example.com'

const transport: RoomTransport = {
  peerIdOf: () => 'local-peer',
  join: async () => {},
  leave: () => {},
  send: async () => {},
  onMessage: () => () => {},
  onPeerJoin: () => () => {},
  onPeerLeave: () => () => {},
  onRoomClose: () => () => {},
  onError: () => () => {},
  dispose: () => {}
}

const caller = { tab: { id: 1, url: `${DOMAIN}/` } }

/**
 * One real DocumentClient survives a logical Background replacement through the same proxies:
 * the fake tab listener is the only notification path, exactly like the browser message bus.
 */
describe('DocumentClient across a logical Background replacement', () => {
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

    let current = createServer({ transport, admission })
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
    client.registerApplier('persistence', (projection) => chat.applyPersistence(projection))

    await client.init()
    const firstHostId = (await current.getSnapshot()).hostId
    expect((await current.getSnapshot()).domains[0]?.tabIds).toEqual([1])
    expect(provideHistory).toHaveBeenCalledTimes(1)

    // The logical Background is replaced (service-worker restart): the new Runtime has no lease
    // and no History provider. Its best-effort hint reaches the surviving document's listener.
    disposeServer(current)
    current = createServer({ transport, admission })
    expect((await current.getSnapshot()).domains).toEqual([])
    notifyServerTabs(current)

    // The same document drain reads the host change, re-registers through the existing
    // register-and-read surface, and the persistence stage re-provides History — no Page
    // identity, generation, ACK, replay, or delivery ownership is involved.
    await vi.waitFor(async () => {
      expect((await current.getSnapshot()).domains[0]?.tabIds).toEqual([1])
    })
    expect((await current.getSnapshot()).hostId).not.toBe(firstHostId)
    await vi.waitFor(() => expect(provideHistory).toHaveBeenCalledTimes(2))
    expect(hints.some((message) => (message as { type?: string }).type === 'runtime:state-changed')).toBe(true)

    disposeServer(current)
  })
})
