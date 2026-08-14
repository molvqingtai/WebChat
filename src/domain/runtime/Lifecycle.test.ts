import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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
  it('makes host creation single-flight and automatically requests rebuild with online pages', () => {
    const { store, runtime } = setup()
    let createRequests = 0
    store.subscribeEvent(runtime.event.HostCreateRequestedEvent, () => {
      createRequests += 1
    })

    store.send(runtime.command.AttachPageCommand({ domain: 'https://example.com', pageId: 'page-a' }))
    store.send(runtime.command.RequestHostCommand())
    store.send(runtime.command.RequestHostCommand())
    expect(store.query(runtime.query.HostPhaseQuery())).toBe('connecting')
    expect(createRequests).toBe(1)

    store.send(runtime.command.HostReadyCommand())
    store.send(runtime.command.HostDestroyedCommand())
    expect(store.query(runtime.query.HostPhaseQuery())).toBe('connecting')
    expect(createRequests).toBe(2)
  })

  it('uses one idempotent lease per page and one grace generation for real two-tab cleanup', () => {
    const { clock, store, runtime } = setup()
    const domain = 'https://example.com'
    store.send(runtime.command.AttachPageCommand({ domain, pageId: 'page-a' }))
    store.send(runtime.command.AttachPageCommand({ domain, pageId: 'page-a' }))
    store.send(runtime.command.AttachPageCommand({ domain, pageId: 'page-b' }))
    expect(store.query(runtime.query.DomainLeaseQuery(domain))?.pageIds).toEqual(['page-a', 'page-b'])

    store.send(runtime.command.DetachPageCommand({ domain, pageId: 'page-a' }))
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    expect(store.query(runtime.query.DomainLeaseQuery(domain))?.phase).toBe('active')

    store.send(runtime.command.DetachPageCommand({ domain, pageId: 'page-b' }))
    expect(store.query(runtime.query.DomainLeaseQuery(domain))?.phase).toBe('grace')
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    expect(store.query(runtime.query.DomainLeaseQuery(domain))).toBeNull()
  })

  it('rebuilds coordinator lease truth idempotently from persisted page facts', () => {
    const persisted = [
      { domain: 'https://example.com', pageId: 'page-a' },
      { domain: 'https://example.com', pageId: 'page-b' }
    ]
    const restarted = setup()
    persisted.forEach((lease) => {
      restarted.store.send(restarted.runtime.command.AttachPageCommand(lease))
    })
    persisted.forEach((lease) => {
      restarted.store.send(restarted.runtime.command.AttachPageCommand(lease))
    })
    const leases = restarted.store.query(restarted.runtime.query.DomainLeasesQuery())
    expect(leases).toHaveLength(1)
    expect(leases[0].pageIds).toEqual(['page-a', 'page-b'])
  })

  it('has no timestamp expiry authority for physical page lifetime', () => {
    const { store, runtime } = setup()
    const domain = 'https://example.com'
    store.send(runtime.command.AttachPageCommand({ domain, pageId: 'page-a' }))

    expect(store.query(runtime.query.DomainLeaseQuery(domain))).not.toHaveProperty('pageLastSeenAt')
    expect(runtime.command).not.toHaveProperty('ExpirePagesCommand')
    expect(runtime.event).not.toHaveProperty('PageExpiredEvent')
    expect(readFileSync(path.resolve(process.cwd(), 'src/domain/runtime/Lifecycle.ts'), 'utf8')).not.toMatch(
      /pageLastSeenAt|seenAt|ExpirePagesCommand|PageExpiredEvent/
    )
  })
})
