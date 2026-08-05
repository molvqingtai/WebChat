import { Remesh } from 'remesh'
import { fromEventPattern, map } from 'rxjs'
import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'

interface ReadinessStatus {
  state: ReadinessState
  terminalError?: string
}

const ReadinessDomain = Remesh.domain({
  name: 'ReadinessDomain',
  impl: (domain) => {
    const readiness = domain.getExtern(ReadinessExtern)
    const Status = domain.state<ReadinessStatus>({
      name: 'Readiness.StatusState',
      default: { state: 'connecting' }
    })
    const StateQuery = domain.query({ name: 'Readiness.StateQuery', impl: ({ get }) => get(Status()).state })
    const TerminalErrorQuery = domain.query({
      name: 'Readiness.TerminalErrorQuery',
      impl: ({ get }) => get(Status()).terminalError
    })
    const StateChangedEvent = domain.event<ReadinessState>({ name: 'Readiness.StateChangedEvent' })
    const SetStateCommand = domain.command({
      name: 'Readiness.SetStateCommand',
      impl: ({ get }, status: ReadinessStatus) => {
        const current = get(Status())
        if (current.state === status.state && current.terminalError === status.terminalError) return null
        return current.state === status.state
          ? Status().new(status)
          : [Status().new(status), StateChangedEvent(status.state)]
      }
    })

    domain.effect({
      name: 'Readiness.OnStateEffect',
      impl: () =>
        fromEventPattern<ReadinessStatus>(
          (handler) =>
            readiness.onState((state, terminalError) => {
              handler({ state, terminalError })
            }),
          (_handler, dispose) => dispose()
        ).pipe(map(SetStateCommand))
    })

    return { query: { StateQuery, TerminalErrorQuery }, event: { StateChangedEvent } }
  }
})

export default ReadinessDomain
