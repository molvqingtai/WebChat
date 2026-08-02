import { Remesh } from 'remesh'
import { concatMap, fromEventPattern, map } from 'rxjs'
import { WorldRoomExtern, type WorldState } from '@/domain/externs/WorldRoom'
import StatusModule from '@/domain/modules/Status'

const WorldRoomDomain = Remesh.domain({
  name: 'WorldRoomDomain',
  impl: (domain) => {
    const worldRoom = domain.getExtern(WorldRoomExtern)
    const JoinStatus = StatusModule(domain, { name: 'WorldRoom.JoinStatusModule' })
    const State = domain.state<WorldState>({ name: 'WorldRoom.State', default: [] })

    const UserListQuery = domain.query({ name: 'WorldRoom.UserListQuery', impl: ({ get }) => get(State()) })
    const JoinIsFinishedQuery = JoinStatus.query.IsFinishedQuery

    const JoinRequestedEvent = domain.event({ name: 'WorldRoom.JoinRequestedEvent' })
    const JoinRoomCommand = domain.command({
      name: 'WorldRoom.JoinRoomCommand',
      impl: ({ get }) =>
        get(JoinStatus.query.IsInitialQuery()) ? [JoinStatus.command.SetLoadingCommand(), JoinRequestedEvent()] : null
    })

    const SetStateCommand = domain.command({
      name: 'WorldRoom.SetStateCommand',
      impl: (_, state: WorldState) => State().new(state)
    })
    const OnErrorEvent = domain.event<Error>({ name: 'WorldRoom.OnErrorEvent' })
    const FailJoinCommand = domain.command({
      name: 'WorldRoom.FailJoinCommand',
      impl: (_, error: Error) => [JoinStatus.command.SetInitialCommand(), OnErrorEvent(error)]
    })
    const CompleteJoinCommand = domain.command({
      name: 'WorldRoom.CompleteJoinCommand',
      impl: (_, state: WorldState) => [State().new(state), JoinStatus.command.SetFinishedCommand()]
    })

    domain.effect({
      name: 'WorldRoom.JoinEffect',
      impl: ({ fromEvent }) =>
        fromEvent(JoinRequestedEvent).pipe(
          concatMap(async () => {
            try {
              return CompleteJoinCommand(await worldRoom.getState())
            } catch (error) {
              return FailJoinCommand(error as Error)
            }
          })
        )
    })

    domain.effect({
      name: 'WorldRoom.OnStateEffect',
      impl: () =>
        fromEventPattern<WorldState>(worldRoom.onState.bind(worldRoom), (_handler, dispose) => dispose()).pipe(
          map(SetStateCommand)
        )
    })

    domain.effect({
      name: 'WorldRoom.OnErrorEffect',
      impl: () =>
        fromEventPattern<Error>(worldRoom.onError.bind(worldRoom), (_handler, dispose) => dispose()).pipe(
          map(OnErrorEvent)
        )
    })

    return {
      query: { UserListQuery, JoinIsFinishedQuery },
      command: { JoinRoomCommand },
      event: { OnErrorEvent }
    }
  }
})

export default WorldRoomDomain
