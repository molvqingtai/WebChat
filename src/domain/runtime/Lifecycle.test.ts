import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import LifecycleDomain from './Lifecycle'
import type { Clock } from '@/domain/runtime/externs/Clock'
import { RUNTIME_DOMAIN_GRACE_MS } from '@/constants/config'

class FakeClock implements Clock {
  private current = 0

  now = () => this.current

  advance(ms: number) {
    this.current += ms
    vi.advanceTimersByTime(ms)
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const setup = () => {
  const clock = new FakeClock()
  const store = Remesh.store()
  const runtime = store.getDomain(LifecycleDomain())
  store.igniteDomain(LifecycleDomain())
  return { clock, store, runtime }
}

describe('LifecycleDomain', () => {
  it('tracks an attached page lease', () => {
    const { store, runtime } = setup()
    store.send(runtime.command.AttachPageCommand({ domain: 'https://example.com', tabId: 1 }))
    expect(store.query(runtime.query.DomainLeaseQuery('https://example.com'))?.tabIds).toEqual([1])
  })

  it('uses one idempotent lease per page and one grace generation for real two-tab cleanup', () => {
    const { clock, store, runtime } = setup()
    const domain = 'https://example.com'
    store.send(runtime.command.AttachPageCommand({ domain, tabId: 1 }))
    store.send(runtime.command.AttachPageCommand({ domain, tabId: 1 }))
    store.send(runtime.command.AttachPageCommand({ domain, tabId: 2 }))
    expect(store.query(runtime.query.DomainLeaseQuery(domain))?.tabIds).toEqual([1, 2])

    store.send(runtime.command.DetachPageCommand({ domain, tabId: 1 }))
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    expect(store.query(runtime.query.DomainLeaseQuery(domain))?.phase).toBe('active')

    store.send(runtime.command.DetachPageCommand({ domain, tabId: 2 }))
    expect(store.query(runtime.query.DomainLeaseQuery(domain))?.phase).toBe('grace')
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    expect(store.query(runtime.query.DomainLeaseQuery(domain))).toBeNull()
  })

  it('rebuilds coordinator lease truth idempotently from persisted page facts', () => {
    const persisted = [
      { domain: 'https://example.com', tabId: 1 },
      { domain: 'https://example.com', tabId: 2 }
    ]
    const restarted = setup()
    persisted.forEach((lease) => restarted.store.send(restarted.runtime.command.AttachPageCommand(lease)))
    persisted.forEach((lease) => restarted.store.send(restarted.runtime.command.AttachPageCommand(lease)))
    const leases = restarted.store.query(restarted.runtime.query.DomainLeasesQuery())
    expect(leases).toHaveLength(1)
    expect(leases[0].tabIds).toEqual([1, 2])
  })
})
