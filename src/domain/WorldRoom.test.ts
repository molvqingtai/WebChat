import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import WorldRoomDomain from '@/domain/WorldRoom'
import { WorldRoomExtern, type WorldRoom, type WorldState } from '@/domain/externs/WorldRoom'

const ALPHA = { id: 'alpha', name: 'Alpha', avatar: '' }
const BETA = { id: 'beta', name: 'Beta', avatar: '' }

const createFixture = (initial: WorldState) => {
  const stateListeners = new Set<Parameters<WorldRoom['onState']>[0]>()
  const errorListeners = new Set<Parameters<WorldRoom['onError']>[0]>()
  const port: WorldRoom = {
    getState: vi.fn(async () => initial),
    onState: (callback) => {
      stateListeners.add(callback)
      return () => stateListeners.delete(callback)
    },
    onError: (callback) => {
      errorListeners.add(callback)
      return () => errorListeners.delete(callback)
    }
  }
  const store = Remesh.store({ externs: [WorldRoomExtern.impl(port)] })
  const action = WorldRoomDomain()
  const room = store.getDomain(action)
  store.igniteDomain(action)
  return {
    store,
    room,
    port,
    emitState: (state: WorldState) => stateListeners.forEach((listener) => listener(state)),
    emitError: (error: Error) => errorListeners.forEach((listener) => listener(error))
  }
}

describe('WorldRoomDomain projected application port', () => {
  it('joins from projected state and applies later source-free updates', async () => {
    const initial = [{ origin: 'https://alpha.test', title: 'Alpha', users: [ALPHA] }]
    const fixture = createFixture(initial)

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(true))
    expect(fixture.store.query(fixture.room.query.UserListQuery())).toEqual(initial)

    const next = [
      { origin: 'https://alpha.test', title: 'Alpha', users: [ALPHA, ALPHA] },
      { origin: 'https://beta.test', users: [BETA] }
    ]
    fixture.emitState(next)
    expect(fixture.store.query(fixture.room.query.UserListQuery())).toEqual(next)
    fixture.store.discard()
  })

  it('routes projected errors without exposing presence events', () => {
    const fixture = createFixture([])
    const errors: Error[] = []
    const subscription = fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => errors.push(error))
    const error = new Error('world unavailable')

    fixture.emitError(error)

    expect(errors).toEqual([error])
    subscription.unsubscribe()
    fixture.store.discard()
  })
})
