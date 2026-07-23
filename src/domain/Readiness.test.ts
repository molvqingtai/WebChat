import { expect, it } from 'vitest'
import { Remesh } from 'remesh'
import ReadinessDomain from '@/domain/Readiness'
import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'

it('immediately replays readiness and disposes the sole state subscription', () => {
  let current: ReadinessState = 'ready'
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
  const subscription = store.subscribeDomain(action)
  store.igniteDomain(action)

  expect(store.query(domain.query.StateQuery())).toBe('ready')
  current = 'unavailable'
  listeners.forEach((listener) => listener(current))
  expect(store.query(domain.query.StateQuery())).toBe('unavailable')

  subscription.unsubscribe()
  store.discardDomain(action)
  expect(listeners.size).toBe(0)
})
