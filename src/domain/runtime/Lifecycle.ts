import { Remesh } from 'remesh'
import { map, mergeMap, Observable } from 'rxjs'
import { RUNTIME_DOMAIN_GRACE_MS } from '@/constants/config'

/**
 * LifecycleDomain
 *
 * Owns the shared Runtime lifecycle contracts:
 * - per-domain page lease/ref-count
 * - the unified grace window after the last page of a domain detaches
 * - per-domain serial reconnect state machine
 *
 * Headless by contract: no DOM/browser API access.
 */

export type DomainPhase = 'active' | 'grace'

export interface DomainLease {
  domain: string
  phase: DomainPhase
  tabIds: number[]
  reconnecting: boolean
  /** Increments on every grace start so stale timers can be ignored. */
  graceGeneration: number
}

const LifecycleDomain = Remesh.domain({
  name: 'LifecycleDomain',
  impl: (domain) => {
    const DomainLeasesState = domain.state<DomainLease[]>({
      name: 'Lifecycle.DomainLeasesState',
      default: []
    })

    const DomainLeasesQuery = domain.query({
      name: 'Lifecycle.DomainLeasesQuery',
      impl: ({ get }) => get(DomainLeasesState())
    })

    const DomainLeaseQuery = domain.query({
      name: 'Lifecycle.DomainLeaseQuery',
      impl: ({ get }, leaseDomain: string) => {
        return get(DomainLeasesState()).find((lease) => lease.domain === leaseDomain) ?? null
      }
    })

    /** Domains currently retained by the Runtime (active pages or inside grace). */
    const RetainedDomainsQuery = domain.query({
      name: 'Lifecycle.RetainedDomainsQuery',
      impl: ({ get }) => get(DomainLeasesState()).map((lease) => lease.domain)
    })

    const HasOnlinePagesQuery = domain.query({
      name: 'Lifecycle.HasOnlinePagesQuery',
      impl: ({ get }) => get(DomainLeasesState()).some((lease) => lease.tabIds.length > 0)
    })

    // ============ Domain lease / grace ============

    const AttachPageCommand = domain.command({
      name: 'Lifecycle.AttachPageCommand',
      impl: ({ get }, payload: { domain: string; tabId: number }) => {
        const leases = get(DomainLeasesState())
        const exist = leases.find((lease) => lease.domain === payload.domain)

        if (!exist) {
          const lease: DomainLease = {
            domain: payload.domain,
            phase: 'active',
            tabIds: [payload.tabId],
            reconnecting: false,
            graceGeneration: 0
          }
          return [DomainLeasesState().new([...leases, lease]), DomainActivatedEvent(payload.domain)]
        }

        const resumedFromGrace = exist.phase === 'grace'
        // A same-tab attach on an already active membership changes nothing: no state rewrite,
        // no event, and therefore no downstream notification.
        if (!resumedFromGrace && exist.tabIds.includes(payload.tabId)) return null
        const nextLease: DomainLease = {
          ...exist,
          phase: 'active',
          tabIds: [...new Set([...exist.tabIds, payload.tabId])]
        }
        return [
          DomainLeasesState().new(leases.map((lease) => (lease.domain === payload.domain ? nextLease : lease))),
          ...(resumedFromGrace ? [DomainResumedEvent(payload.domain)] : []),
          PageAttachedEvent(payload)
        ]
      }
    })

    const DetachPageCommand = domain.command({
      name: 'Lifecycle.DetachPageCommand',
      impl: ({ get }, payload: { domain: string; tabId: number }) => {
        const leases = get(DomainLeasesState())
        const exist = leases.find((lease) => lease.domain === payload.domain)
        if (!exist) {
          return null
        }

        const tabIds = exist.tabIds.filter((tabId) => tabId !== payload.tabId)
        if (tabIds.length > 0) {
          return [
            DomainLeasesState().new(
              leases.map((lease) => (lease.domain === payload.domain ? { ...lease, tabIds } : lease))
            ),
            PageDetachedEvent(payload)
          ]
        }

        // Last page gone: enter the unified grace window instead of releasing now.
        const nextLease: DomainLease = {
          ...exist,
          phase: 'grace',
          tabIds: [],
          graceGeneration: exist.graceGeneration + 1
        }
        return [
          DomainLeasesState().new(leases.map((lease) => (lease.domain === payload.domain ? nextLease : lease))),
          PageDetachedEvent(payload),
          DomainGraceStartedEvent({ domain: payload.domain, generation: nextLease.graceGeneration })
        ]
      }
    })

    const GraceExpiredCommand = domain.command({
      name: 'Lifecycle.GraceExpiredCommand',
      impl: ({ get }, payload: { domain: string; generation: number }) => {
        const leases = get(DomainLeasesState())
        const exist = leases.find((lease) => lease.domain === payload.domain)
        // Ignore stale timers: the domain resumed or already released.
        if (!exist || exist.phase !== 'grace' || exist.graceGeneration !== payload.generation) {
          return null
        }
        return [
          DomainLeasesState().new(leases.filter((lease) => lease.domain !== payload.domain)),
          DomainReleasedEvent(payload.domain)
        ]
      }
    })

    // ============ Per-domain serial reconnect ============

    const BeginReconnectCommand = domain.command({
      name: 'Lifecycle.BeginReconnectCommand',
      impl: ({ get }, leaseDomain: string) => {
        const leases = get(DomainLeasesState())
        const exist = leases.find((lease) => lease.domain === leaseDomain)
        // Serial: one reconnect per domain at a time; unknown domains cannot reconnect.
        if (!exist || exist.reconnecting) {
          return null
        }
        return [
          DomainLeasesState().new(
            leases.map((lease) => (lease.domain === leaseDomain ? { ...lease, reconnecting: true } : lease))
          ),
          ReconnectRequestedEvent(leaseDomain)
        ]
      }
    })

    const FinishReconnectCommand = domain.command({
      name: 'Lifecycle.FinishReconnectCommand',
      impl: ({ get }, leaseDomain: string) => {
        const leases = get(DomainLeasesState())
        const exist = leases.find((lease) => lease.domain === leaseDomain)
        if (!exist || !exist.reconnecting) {
          return null
        }
        return [
          DomainLeasesState().new(
            leases.map((lease) => (lease.domain === leaseDomain ? { ...lease, reconnecting: false } : lease))
          ),
          ReconnectFinishedEvent(leaseDomain)
        ]
      }
    })

    // ============ Events ============

    const DomainActivatedEvent = domain.event<string>({ name: 'Lifecycle.DomainActivatedEvent' })
    const DomainResumedEvent = domain.event<string>({ name: 'Lifecycle.DomainResumedEvent' })
    const DomainGraceStartedEvent = domain.event<{ domain: string; generation: number }>({
      name: 'Lifecycle.DomainGraceStartedEvent'
    })
    const DomainReleasedEvent = domain.event<string>({ name: 'Lifecycle.DomainReleasedEvent' })

    const PageAttachedEvent = domain.event<{ domain: string; tabId: number }>({
      name: 'Lifecycle.PageAttachedEvent'
    })
    const PageDetachedEvent = domain.event<{ domain: string; tabId: number }>({
      name: 'Lifecycle.PageDetachedEvent'
    })
    const ReconnectRequestedEvent = domain.event<string>({ name: 'Lifecycle.ReconnectRequestedEvent' })
    const ReconnectFinishedEvent = domain.event<string>({ name: 'Lifecycle.ReconnectFinishedEvent' })

    // ============ Effects ============

    domain.effect({
      name: 'Lifecycle.GraceTimerEffect',
      impl: ({ fromEvent }) => {
        return fromEvent(DomainGraceStartedEvent).pipe(
          mergeMap((payload) => {
            return new Observable<{ domain: string; generation: number }>((observer) => {
              const timerId = globalThis.setTimeout(() => {
                observer.next(payload)
                observer.complete()
              }, RUNTIME_DOMAIN_GRACE_MS)
              return () => globalThis.clearTimeout(timerId)
            })
          }),
          map(GraceExpiredCommand)
        )
      }
    })

    return {
      query: {
        DomainLeasesQuery,
        DomainLeaseQuery,
        RetainedDomainsQuery,
        HasOnlinePagesQuery
      },
      command: {
        AttachPageCommand,
        DetachPageCommand,
        GraceExpiredCommand,
        BeginReconnectCommand,
        FinishReconnectCommand
      },
      event: {
        DomainActivatedEvent,
        DomainResumedEvent,
        DomainGraceStartedEvent,
        DomainReleasedEvent,
        PageAttachedEvent,
        PageDetachedEvent,
        ReconnectRequestedEvent,
        ReconnectFinishedEvent
      }
    }
  }
})

export default LifecycleDomain
