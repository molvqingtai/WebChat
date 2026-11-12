import { Remesh } from 'remesh'
import { map, mergeMap, timer } from 'rxjs'
import { DOMAIN_GRACE_MS } from '../Config'

interface Lease {
  domain: string
  pages: number
  /** Bumped whenever the last page leaves, so an older grace timer cannot release a resumed site. */
  grace: number
}

/** Sole owner of "does this site still have a page". */
const LifecycleDomain = Remesh.domain({
  name: 'LifecycleDomain',
  impl: (domain) => {
    const LeasesState = domain.state<Lease[]>({ name: 'Lifecycle.LeasesState', default: [] })

    const GraceStartedEvent = domain.event<{ domain: string; grace: number }>({ name: 'Lifecycle.GraceStartedEvent' })
    const ReleasedEvent = domain.event<string>({ name: 'Lifecycle.ReleasedEvent' })

    const AttachCommand = domain.command({
      name: 'Lifecycle.AttachCommand',
      impl: ({ get }, site: string) => {
        const leases = get(LeasesState())
        const exist = leases.find((lease) => lease.domain === site)
        if (!exist) return LeasesState().new([...leases, { domain: site, pages: 1, grace: 0 }])
        return LeasesState().new(
          leases.map((lease) => (lease === exist ? { ...exist, pages: exist.pages + 1 } : lease))
        )
      }
    })

    const DetachCommand = domain.command({
      name: 'Lifecycle.DetachCommand',
      impl: ({ get }, site: string) => {
        const leases = get(LeasesState())
        const exist = leases.find((lease) => lease.domain === site)
        if (!exist || exist.pages === 0) return null
        const next = { ...exist, pages: exist.pages - 1, grace: exist.grace + (exist.pages === 1 ? 1 : 0) }
        return [
          LeasesState().new(leases.map((lease) => (lease === exist ? next : lease))),
          ...(next.pages === 0 ? [GraceStartedEvent({ domain: site, grace: next.grace })] : [])
        ]
      }
    })

    const ExpireCommand = domain.command({
      name: 'Lifecycle.ExpireCommand',
      impl: ({ get }, expired: { domain: string; grace: number }) => {
        const leases = get(LeasesState())
        const exist = leases.find((lease) => lease.domain === expired.domain)
        if (!exist || exist.pages > 0 || exist.grace !== expired.grace) return null
        return [LeasesState().new(leases.filter((lease) => lease !== exist)), ReleasedEvent(expired.domain)]
      }
    })

    domain.effect({
      name: 'Lifecycle.GraceEffect',
      impl: ({ fromEvent }) =>
        fromEvent(GraceStartedEvent).pipe(
          mergeMap((started) => timer(DOMAIN_GRACE_MS).pipe(map(() => ExpireCommand(started))))
        )
    })

    return { command: { AttachCommand, DetachCommand }, event: { ReleasedEvent } }
  }
})

export default LifecycleDomain
