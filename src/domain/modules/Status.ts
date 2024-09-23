import { DomainConceptName, RemeshDomainContext } from 'remesh'

export enum Status {
  Initial = 0b001, // 1
  Loading = 0b010, // 2
  Finished = 0b100 // 4
}

export interface StatusOptions {
  name: DomainConceptName<'StatusModule'>
  default?: Status
}

const StatusModule = (domain: RemeshDomainContext, options: StatusOptions) => {
  const RoomStatusModule = domain.state({
    name: `${options.name}.StatusState`,
    default: options.default ?? Status.Initial
  })

  const StatusQuery = domain.query({
    name: `${options.name}.StatusQuery`,
    impl: ({ get }) => {
      return get(RoomStatusModule())
    }
  })

  const IsInitialQuery = domain.query({
    name: `${options.name}.IsInitialQuery`,
    impl: ({ get }) => {
      const state = get(RoomStatusModule())
      return (state & Status.Initial) !== 0
    }
  })

  const IsLoadingQuery = domain.query({
    name: `${options.name}.IsLoadingQuery`,
    impl: ({ get }) => {
      const state = get(RoomStatusModule())
      return (state & Status.Loading) !== 0
    }
  })

  const IsFinishedQuery = domain.query({
    name: `${options.name}.IsFinishedQuery`,
    impl: ({ get }) => {
      const state = get(RoomStatusModule())
      return (state & Status.Finished) !== 0
    }
  })

  const UpdateStatusEvent = domain.event<Status>({
    name: `${options.name}.UpdateStatusEvent`
  })

  const SetInitialCommand = domain.command({
    name: `${options.name}.SetInitialCommand`,
    impl: () => {
      return [RoomStatusModule().new(Status.Initial), UpdateStatusEvent(Status.Initial)]
    }
  })

  const SetLoadingCommand = domain.command({
    name: `${options.name}.SetLoadingCommand`,
    impl: () => {
      return [RoomStatusModule().new(Status.Loading), UpdateStatusEvent(Status.Loading)]
    }
  })

  const SetFinishedCommand = domain.command({
    name: `${options.name}.SetFinishedCommand`,
    impl: () => {
      return [RoomStatusModule().new(Status.Finished), UpdateStatusEvent(Status.Finished)]
    }
  })

  const UpdateStatusCommand = domain.command({
    name: `${options.name}.UpdateStatusCommand`,
    impl: (_, status: Status) => {
      return [RoomStatusModule().new(status), UpdateStatusEvent(status)]
    }
  })

  return {
    query: {
      StatusQuery,
      IsInitialQuery,
      IsLoadingQuery,
      IsFinishedQuery
    },
    command: {
      SetInitialCommand,
      SetLoadingCommand,
      SetFinishedCommand,
      UpdateStatusCommand
    },
    event: {
      UpdateStatusEvent
    }
  }
}

export default StatusModule
