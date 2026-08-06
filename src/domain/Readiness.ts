import { Remesh } from 'remesh'
import { fromEventPattern, map } from 'rxjs'
import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'

const ReadinessDomain = Remesh.domain({
  name: 'ReadinessDomain',
  impl: (domain) => {
    const readiness = domain.getExtern(ReadinessExtern)
    const Status = domain.state<ReadinessState>({
      name: 'Readiness.StatusState',
      default: 'connecting'
    })
    const StateQuery = domain.query({ name: 'Readiness.StateQuery', impl: ({ get }) => get(Status()) })
    const StateChangedEvent = domain.event<ReadinessState>({ name: 'Readiness.StateChangedEvent' })
    const SetStateCommand = domain.command({
      name: 'Readiness.SetStateCommand',
      impl: ({ get }, state: ReadinessState) => {
        const current = get(Status())
        if (current === state) return null
        return [Status().new(state), StateChangedEvent(state)]
      }
    })

    domain.effect({
      name: 'Readiness.OnStateEffect',
      impl: () =>
        fromEventPattern<ReadinessState>(
          (handler) => readiness.onState((state) => handler(state)),
          (_handler, dispose) => dispose()
        ).pipe(map(SetStateCommand))
    })

    return { query: { StateQuery }, event: { StateChangedEvent } }
  }
})

export default ReadinessDomain
