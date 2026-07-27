import { Remesh } from 'remesh'
import { fromEventPattern, map } from 'rxjs'
import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'

const ReadinessDomain = Remesh.domain({
  name: 'ReadinessDomain',
  impl: (domain) => {
    const readiness = domain.getExtern(ReadinessExtern)
    const State = domain.state<ReadinessState>({ name: 'Readiness.State', default: 'connecting' })
    const StateQuery = domain.query({ name: 'Readiness.StateQuery', impl: ({ get }) => get(State()) })
    const StateChangedEvent = domain.event<ReadinessState>({ name: 'Readiness.StateChangedEvent' })
    const SetStateCommand = domain.command({
      name: 'Readiness.SetStateCommand',
      impl: ({ get }, state: ReadinessState) =>
        get(StateQuery()) === state ? null : [State().new(state), StateChangedEvent(state)]
    })

    domain.effect({
      name: 'Readiness.OnStateEffect',
      impl: () =>
        fromEventPattern<ReadinessState>(readiness.onState.bind(readiness), (_handler, dispose) => dispose()).pipe(
          map(SetStateCommand)
        )
    })

    return { query: { StateQuery }, event: { StateChangedEvent } }
  }
})

export default ReadinessDomain
