import { describe, expect, it, vi } from 'vitest'
import { WorldRoom } from '@/domain/impls/runtime/WorldRoom'
import type { RuntimeServer, RuntimeSnapshot, WorldPresenceEvent } from '@/runtime/Contract'
import type { ChatUser, ChatSite, WorldRoomMessage } from '@/protocol'

const ALPHA = { id: 'alpha', name: 'Alpha', avatar: '' }
const BETA = { id: 'beta', name: 'Beta', avatar: '' }

const presence = (user: ChatUser, sites: ChatSite[], sessionId = user.id): WorldRoomMessage => ({
  sessionId,
  user,
  sites
})

const event = (sourcePeerId: string, value: WorldRoomMessage | null): WorldPresenceEvent => ({
  sourcePeerId,
  presence: value ? { sourcePeerId, presence: value } : null
})

const snapshot = (presences: RuntimeSnapshot['world']['presences']): RuntimeSnapshot => ({
  hostId: 'host-1',
  hostPhase: 'ready',
  peerId: 'local-peer',
  domains: [],
  world: { joined: true, peerId: 'local-peer', presences }
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const createFixture = (
  initial: RuntimeSnapshot,
  onSubscribe?: (callback: (event: WorldPresenceEvent) => void) => void,
  getRuntimeSnapshot: () => Promise<RuntimeSnapshot> = async () => initial
) => {
  const order: string[] = []
  let callback: ((event: WorldPresenceEvent) => void) | null = null
  const server = {
    onWorldPresence: async (_payload: unknown, listener: (event: WorldPresenceEvent) => void) => {
      order.push('subscribe')
      callback = listener
      onSubscribe?.(listener)
    },
    getSnapshot: async () => {
      order.push('snapshot')
      return getRuntimeSnapshot()
    }
  } as unknown as RuntimeServer
  const room = new WorldRoom({
    server,
    pageId: 'page-1',
    getSnapshot: () => initial,
    whenReady: (ready) => {
      ready()
      return () => {}
    }
  })
  const states: Awaited<ReturnType<WorldRoom['getState']>>[] = []
  room.onState((state) => states.push(state))
  return {
    room,
    order,
    states,
    emit: (value: WorldPresenceEvent) => {
      if (!callback) throw new Error('World callback is not registered')
      callback(value)
    }
  }
}

describe('WorldRoom Runtime adapter', () => {
  it('isolates a throwing error listener and settles the shared attachment tail', async () => {
    const initial = snapshot([])
    const attachment = Promise.withResolvers<RuntimeSnapshot>()
    const getSnapshot = vi.fn(() => attachment.promise)
    let ready = () => {}
    const room = new WorldRoom({
      server: {
        onWorldPresence: async () => {},
        getSnapshot
      } as unknown as RuntimeServer,
      pageId: 'page-1',
      getSnapshot: () => initial,
      whenReady: (listener) => {
        ready = listener
        return () => {}
      }
    })
    const attachmentFailure = new Error('World attachment failed')
    const deliveryFailure = new Error('World error listener failed')
    const listener = vi.fn(() => {
      throw deliveryFailure
    })
    room.onError(listener)
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    ready()
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledOnce())
    attachment.reject(attachmentFailure)

    await expect(room.getState()).resolves.toEqual([])
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(attachmentFailure)
    expect(diagnostic).toHaveBeenCalledOnce()
    expect(diagnostic).toHaveBeenCalledWith(deliveryFailure)
    diagnostic.mockRestore()
  })

  it('replays subscribed updates after the initial snapshot baseline', async () => {
    const oldSource = presence(ALPHA, [{ origin: 'https://old.test', title: 'Old' }])
    const newSource = presence(ALPHA, [{ origin: 'https://new.test', title: 'New' }])
    const oldSnapshot = snapshot([{ sourcePeerId: 'source-a', presence: oldSource }])
    const snapshotBarrier = deferred<RuntimeSnapshot>()
    const fixture = createFixture(oldSnapshot, undefined, () => snapshotBarrier.promise)

    await vi.waitFor(() => expect(fixture.order).toEqual(['subscribe', 'snapshot']))
    fixture.emit(event('source-a', newSource))
    snapshotBarrier.resolve(oldSnapshot)

    await expect(fixture.room.getState()).resolves.toEqual([
      { origin: 'https://new.test', title: 'New', users: [ALPHA] }
    ])
  })

  it('preserves exact-origin multiset order and updates first-contribution metadata in place', async () => {
    const initial = snapshot([
      {
        sourcePeerId: 'source-a',
        presence: presence(ALPHA, [
          { origin: 'https://alpha.test', title: 'Alpha A' },
          { origin: 'https://beta.test', title: 'Beta' }
        ])
      },
      {
        sourcePeerId: 'source-b',
        presence: presence(ALPHA, [{ origin: 'https://alpha.test', title: 'Alpha B' }], 'alpha-b')
      }
    ])
    const fixture = createFixture(initial)
    await fixture.room.getState()

    expect(fixture.states.at(-1)).toEqual([
      { origin: 'https://alpha.test', title: 'Alpha A', users: [ALPHA, ALPHA] },
      { origin: 'https://beta.test', title: 'Beta', users: [ALPHA] }
    ])

    fixture.emit(
      event(
        'source-a',
        presence(ALPHA, [
          { origin: 'https://alpha.test', title: 'Alpha A2' },
          { origin: 'https://gamma.test', title: 'Gamma' }
        ])
      )
    )
    expect(fixture.states.at(-1)).toEqual([
      { origin: 'https://alpha.test', title: 'Alpha A2', users: [ALPHA, ALPHA] },
      { origin: 'https://gamma.test', title: 'Gamma', users: [ALPHA] }
    ])

    fixture.emit(event('source-c', presence(BETA, [{ origin: 'https://alpha.test', title: 'Alpha C' }])))
    fixture.emit(event('source-a', presence(ALPHA, [{ origin: 'https://delta.test', title: 'Delta' }])))
    expect(fixture.states.at(-1)).toEqual([
      { origin: 'https://alpha.test', title: 'Alpha B', users: [ALPHA, BETA] },
      { origin: 'https://delta.test', title: 'Delta', users: [ALPHA] }
    ])

    fixture.emit(event('source-b', null))
    expect(fixture.states.at(-1)).toEqual([
      { origin: 'https://alpha.test', title: 'Alpha C', users: [BETA] },
      { origin: 'https://delta.test', title: 'Delta', users: [ALPHA] }
    ])
    expect(JSON.stringify(fixture.states.at(-1))).not.toMatch(/source|peer|session/)
  })
})
