import { Remesh } from 'remesh'
import { filter, map, merge, mergeMap, Observable } from 'rxjs'
import { RUNTIME_DOMAIN_GRACE_MS } from '@/constants/config'
import type { HostPhase } from '@/runtime/Contract'

/**
 * LifecycleDomain
 *
 * Owns the shared Runtime lifecycle contracts:
 * - host singleton with single-flight creation (background is the only coordinator)
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
  pageIds: string[]
  reconnecting: boolean
  /** Increments on every grace start so stale timers can be ignored. */
  graceGeneration: number
}

const LifecycleDomain = Remesh.domain({
  name: 'LifecycleDomain',
  impl: (domain) => {
    const HostPhaseState = domain.state<HostPhase>({
      name: 'Lifecycle.HostPhaseState',
      default: 'none'
    })

    const HostPhaseQuery = domain.query({
      name: 'Lifecycle.HostPhaseQuery',
      impl: ({ get }) => get(HostPhaseState())
    })

    const HostGenerationState = domain.state<number>({
      name: 'Lifecycle.HostGenerationState',
      default: 0
    })

    const HostGenerationQuery = domain.query({
      name: 'Lifecycle.HostGenerationQuery',
      impl: ({ get }) => get(HostGenerationState())
    })

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
      impl: ({ get }) => get(DomainLeasesState()).some((lease) => lease.pageIds.length > 0)
    })

    // ============ Host single-flight ============

    const RequestHostCommand = domain.command({
      name: 'Lifecycle.RequestHostCommand',
      impl: ({ get }) => {
        const phase = get(HostPhaseState())
        // Single-flight: only the first request while missing/unavailable starts creation.
        if (phase === 'connecting' || phase === 'ready') {
          return null
        }
        return [HostPhaseState().new('connecting'), HostCreateRequestedEvent()]
      }
    })

    const HostEnsuredCommand = domain.command({
      name: 'Lifecycle.HostEnsuredCommand',
      impl: ({ get }, payload: { created: boolean }) => {
        const current = get(HostGenerationState())
        const generation = payload.created ? current + 1 : Math.max(1, current)
        if (!Number.isSafeInteger(generation)) return HostFailedCommand('host generation exhausted')
        return [HostPhaseState().new('ready'), HostGenerationState().new(generation), HostReadyEvent()]
      }
    })

    const HostReadyCommand = domain.command({
      name: 'Lifecycle.HostReadyCommand',
      impl: () => HostEnsuredCommand({ created: false })
    })

    const RestoreHostGenerationCommand = domain.command({
      name: 'Lifecycle.RestoreHostGenerationCommand',
      impl: (_, generation: number) =>
        Number.isSafeInteger(generation) && generation >= 0 ? HostGenerationState().new(generation) : null
    })

    const HostFailedCommand = domain.command({
      name: 'Lifecycle.HostFailedCommand',
      impl: (_, reason: string) => {
        return [HostPhaseState().new('unavailable'), HostUnavailableEvent(reason)]
      }
    })

    const HostDestroyedCommand = domain.command({
      name: 'Lifecycle.HostDestroyedCommand',
      impl: ({ get }) => {
        const shouldRebuild = get(HasOnlinePagesQuery())
        return [
          HostPhaseState().new('none'),
          HostDestroyedEvent(),
          // Automatic rebuild while at least one domain page is online.
          ...(shouldRebuild ? [RequestHostCommand()] : [])
        ]
      }
    })

    // ============ Domain lease / grace ============

    const AttachPageCommand = domain.command({
      name: 'Lifecycle.AttachPageCommand',
      impl: ({ get }, payload: { domain: string; pageId: string }) => {
        const leases = get(DomainLeasesState())
        const exist = leases.find((lease) => lease.domain === payload.domain)

        if (!exist) {
          const lease: DomainLease = {
            domain: payload.domain,
            phase: 'active',
            pageIds: [payload.pageId],
            reconnecting: false,
            graceGeneration: 0
          }
          return [DomainLeasesState().new([...leases, lease]), DomainActivatedEvent(payload.domain)]
        }

        const resumedFromGrace = exist.phase === 'grace'
        const nextLease: DomainLease = {
          ...exist,
          phase: 'active',
          pageIds: [...new Set([...exist.pageIds, payload.pageId])]
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
      impl: ({ get }, payload: { domain: string; pageId: string }) => {
        const leases = get(DomainLeasesState())
        const exist = leases.find((lease) => lease.domain === payload.domain)
        if (!exist) {
          return null
        }

        const pageIds = exist.pageIds.filter((pageId) => pageId !== payload.pageId)
        if (pageIds.length > 0) {
          return [
            DomainLeasesState().new(
              leases.map((lease) => (lease.domain === payload.domain ? { ...lease, pageIds } : lease))
            ),
            PageDetachedEvent(payload)
          ]
        }

        // Last page gone: enter the unified grace window instead of releasing now.
        const nextLease: DomainLease = {
          ...exist,
          phase: 'grace',
          pageIds: [],
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

    const HostCreateRequestedEvent = domain.event({ name: 'Lifecycle.HostCreateRequestedEvent' })
    const HostReadyEvent = domain.event({ name: 'Lifecycle.HostReadyEvent' })
    const HostUnavailableEvent = domain.event<string>({ name: 'Lifecycle.HostUnavailableEvent' })
    const HostDestroyedEvent = domain.event({ name: 'Lifecycle.HostDestroyedEvent' })

    const DomainActivatedEvent = domain.event<string>({ name: 'Lifecycle.DomainActivatedEvent' })
    const DomainResumedEvent = domain.event<string>({ name: 'Lifecycle.DomainResumedEvent' })
    const DomainGraceStartedEvent = domain.event<{ domain: string; generation: number }>({
      name: 'Lifecycle.DomainGraceStartedEvent'
    })
    const DomainReleasedEvent = domain.event<string>({ name: 'Lifecycle.DomainReleasedEvent' })

    const PageAttachedEvent = domain.event<{ domain: string; pageId: string }>({
      name: 'Lifecycle.PageAttachedEvent'
    })
    const PageDetachedEvent = domain.event<{ domain: string; pageId: string }>({
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

    domain.effect({
      name: 'Lifecycle.EnsureHostEffect',
      impl: ({ fromEvent, get }) => {
        // Any page attach while the host is missing triggers single-flight creation.
        return merge(fromEvent(PageAttachedEvent), fromEvent(DomainActivatedEvent)).pipe(
          filter(() => get(HostPhaseState()) === 'none'),
          map(() => RequestHostCommand())
        )
      }
    })

    return {
      query: {
        HostPhaseQuery,
        HostGenerationQuery,
        DomainLeasesQuery,
        DomainLeaseQuery,
        RetainedDomainsQuery,
        HasOnlinePagesQuery
      },
      command: {
        RequestHostCommand,
        HostEnsuredCommand,
        HostReadyCommand,
        RestoreHostGenerationCommand,
        HostFailedCommand,
        HostDestroyedCommand,
        AttachPageCommand,
        DetachPageCommand,
        GraceExpiredCommand,
        BeginReconnectCommand,
        FinishReconnectCommand
      },
      event: {
        HostCreateRequestedEvent,
        HostReadyEvent,
        HostUnavailableEvent,
        HostDestroyedEvent,
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
