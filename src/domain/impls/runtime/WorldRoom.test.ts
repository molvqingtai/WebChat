import { describe, expect, it, vi } from 'vitest'
import { WorldRoom } from '@/domain/impls/runtime/WorldRoom'
import type { RuntimeSnapshot } from '@/runtime/Contract'
import type { ChatUser, ChatSite, WorldRoomMessage } from '@/protocol'

const ALPHA = { id: 'alpha', name: 'Alpha', avatar: '' }
const BETA = { id: 'beta', name: 'Beta', avatar: '' }

const presence = (user: ChatUser, sites: ChatSite[], sessionId = user.id): WorldRoomMessage => ({
  sessionId,
  user,
  sites
})

const snapshot = (
  presences: RuntimeSnapshot['world']['presences'],
  localPresence?: WorldRoomMessage
): RuntimeSnapshot => ({
  hostId: 'host-1',
  hostPhase: 'ready',
  peerId: 'local-peer',
  domains: [],
  world: { joined: true, peerId: 'local-peer', localPresence, presences },
  failures: []
})

describe('WorldRoom current-projection application', () => {
  it('applies a full projection idempotently and removes contributions absent from the next pull', async () => {
    const room = new WorldRoom()
    const states: Awaited<ReturnType<WorldRoom['getState']>>[] = []
    room.onState((state) => states.push(state))

    const first = snapshot([
      { sourcePeerId: 'source-a', presence: presence(ALPHA, [{ origin: 'https://alpha.test', title: 'Alpha' }]) },
      { sourcePeerId: 'source-b', presence: presence(BETA, [{ origin: 'https://beta.test', title: 'Beta' }]) }
    ])
    room.applyWorld(first)
    expect((await room.getState()).map((group) => group.origin)).toEqual(['https://alpha.test', 'https://beta.test'])

    // Re-applying the identical projection changes nothing (no duplicate contributions).
    room.applyWorld(first)
    expect(await room.getState()).toHaveLength(2)

    // A later projection replaces the full contribution set.
    room.applyWorld(
      snapshot([{ sourcePeerId: 'source-c', presence: presence(BETA, [{ origin: 'https://gamma.test' }]) }])
    )
    const next = await room.getState()
    expect(next.map((group) => group.origin)).toEqual(['https://gamma.test'])
    expect(next[0]?.users).toEqual([BETA])
  })

  it('preserves exact-origin multiset order and updates first-contribution metadata in place', async () => {
    const room = new WorldRoom()
    room.applyWorld(
      snapshot([
        { sourcePeerId: 'source-a', presence: presence(ALPHA, [{ origin: 'https://shared.test', title: 'Shared A' }]) },
        { sourcePeerId: 'source-b', presence: presence(BETA, [{ origin: 'https://shared.test', title: 'Shared B' }]) }
      ])
    )
    // Same origin from two sources forms one ordered group in first-contribution order.
    expect((await room.getState())[0]?.users.map((user) => user.id)).toEqual(['alpha', 'beta'])

    // A metadata refresh on the earlier source updates in place without changing group order.
    room.applyWorld(
      snapshot([
        {
          sourcePeerId: 'source-a',
          presence: presence({ ...ALPHA, name: 'Alpha 2' }, [{ origin: 'https://shared.test', title: 'Shared A2' }])
        },
        { sourcePeerId: 'source-b', presence: presence(BETA, [{ origin: 'https://shared.test', title: 'Shared B' }]) }
      ])
    )
    const group = (await room.getState())[0]
    expect(group?.title).toBe('Shared A2')
    expect(group?.users.map((user) => user.name)).toEqual(['Alpha 2', 'Beta'])
  })

  it('includes the local presence in the projected groups and groups repeated sites by origin', async () => {
    const room = new WorldRoom()
    room.applyWorld(
      snapshot(
        [{ sourcePeerId: 'source-a', presence: presence(ALPHA, [{ origin: 'https://alpha.test' }]) }],
        presence(BETA, [
          { origin: 'https://alpha.test', title: 'Alpha local' },
          { origin: 'https://beta.test', title: 'Beta local' }
        ])
      )
    )
    const state = await room.getState()
    expect(state.map((group) => group.origin)).toEqual(['https://alpha.test', 'https://beta.test'])
    expect(state[0]?.users.map((user) => user.id)).toEqual(['alpha', 'beta'])
  })

  it('emits state to listeners on every application and isolates listener errors via the hub contract', async () => {
    const room = new WorldRoom()
    const states: number[] = []
    room.onState((state) => states.push(state.length))
    room.applyWorld(snapshot([]))
    room.applyWorld(snapshot([]))
    expect(states).toEqual([0, 0])
    const listener = vi.fn()
    room.onError(listener)
    expect(listener).not.toHaveBeenCalled()
  })
})
