import { expect, it } from 'vitest'
import { Remesh } from 'remesh'
import ReadinessDomain from '@/domain/Readiness'
import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'

const createFixture = (initial: ReadinessState) => {
  let current = initial
  const listeners = new Set<(state: ReadinessState) => void>()
  const store = Remesh.store({
    externs: [
      ReadinessExtern.impl({
        onState: (callback) => {
          listeners.add(callback)
          callback(current)
          return () => listeners.delete(callback)
        }
      })
    ]
  })
  const action = ReadinessDomain()
  const domain = store.getDomain(action)
  const transitions: ReadinessState[] = []
  const observedStates: ReadinessState[] = []
  const domainSubscription = store.subscribeDomain(action)
  const eventSubscription = store.subscribeEvent(domain.event.StateChangedEvent, (state) => transitions.push(state))
  const querySubscription = store.subscribeQuery(domain.query.StateQuery(), (state) => observedStates.push(state))
  store.igniteDomain(action)

  return {
    store,
    domain,
    transitions,
    observedStates,
    emit: (state: ReadinessState) => {
      current = state
      listeners.forEach((listener) => listener(state))
    },
    discard: () => {
      querySubscription.unsubscribe()
      eventSubscription.unsubscribe()
      domainSubscription.unsubscribe()
      store.discardDomain(action)
      expect(listeners.size).toBe(0)
    }
  }
}

;(['connecting', 'ready', 'unavailable'] as const).forEach((initial) => {
  it(`immediately replays ${initial} without treating an equal input as another transition`, () => {
    const fixture = createFixture(initial)
    const initialTransitions: ReadinessState[] = initial === 'connecting' ? [] : [initial]
    const initialObservations: ReadinessState[] = initial === 'connecting' ? [] : [initial]

    expect(fixture.store.query(fixture.domain.query.StateQuery())).toBe(initial)
    expect(fixture.transitions).toEqual(initialTransitions)
    expect(fixture.observedStates).toEqual(initialObservations)

    fixture.emit(initial)
    expect(fixture.store.query(fixture.domain.query.StateQuery())).toBe(initial)
    expect(fixture.transitions).toEqual(initialTransitions)
    expect(fixture.observedStates).toEqual(initialObservations)

    fixture.discard()
  })
})

it('updates and emits exactly once for each actual readiness transition', () => {
  const fixture = createFixture('connecting')

  fixture.emit('ready')
  fixture.emit('ready')
  fixture.emit('unavailable')
  fixture.emit('unavailable')
  fixture.emit('connecting')
  fixture.emit('connecting')

  expect(fixture.store.query(fixture.domain.query.StateQuery())).toBe('connecting')
  expect(fixture.transitions).toEqual(['ready', 'unavailable', 'connecting'])
  expect(fixture.observedStates).toEqual(['ready', 'unavailable', 'connecting'])

  fixture.discard()
})
