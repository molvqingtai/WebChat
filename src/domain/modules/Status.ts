import { Remesh, type DomainConceptName, type RemeshDomainContext } from 'remesh'

export enum Status {
  Initial = 0b001,
  Loading = 0b010,
  Finished = 0b100
}

export interface StatusOptions {
  name: DomainConceptName<'StatusModule'>
  default?: Status
}

const StatusModule = (domain: RemeshDomainContext, options: StatusOptions) => {
  const StatusState = domain.state({
    name: `${options.name}.StatusState`,
    default: options.default ?? Status.Initial
  })

  const StatusQuery = domain.query({
    name: `${options.name}.StatusQuery`,
    impl: ({ get }) => get(StatusState())
  })

  const IsInitialQuery = domain.query({
    name: `${options.name}.IsInitialQuery`,
    impl: ({ get }) => (get(StatusState()) & Status.Initial) !== 0
  })

  const IsLoadingQuery = domain.query({
    name: `${options.name}.IsLoadingQuery`,
    impl: ({ get }) => (get(StatusState()) & Status.Loading) !== 0
  })

  const IsFinishedQuery = domain.query({
    name: `${options.name}.IsFinishedQuery`,
    impl: ({ get }) => (get(StatusState()) & Status.Finished) !== 0
  })

  const UpdateStatusEvent = domain.event<Status>({ name: `${options.name}.UpdateStatusEvent` })

  const SetInitialCommand = domain.command({
    name: `${options.name}.SetInitialCommand`,
    impl: () => [StatusState().new(Status.Initial), UpdateStatusEvent(Status.Initial)]
  })

  const SetLoadingCommand = domain.command({
    name: `${options.name}.SetLoadingCommand`,
    impl: () => [StatusState().new(Status.Loading), UpdateStatusEvent(Status.Loading)]
  })

  const SetFinishedCommand = domain.command({
    name: `${options.name}.SetFinishedCommand`,
    impl: () => [StatusState().new(Status.Finished), UpdateStatusEvent(Status.Finished)]
  })

  const UpdateStatusCommand = domain.command({
    name: `${options.name}.UpdateStatusCommand`,
    impl: (_, status: Status) => [StatusState().new(status), UpdateStatusEvent(status)]
  })

  return Remesh.module({
    query: { StatusQuery, IsInitialQuery, IsLoadingQuery, IsFinishedQuery },
    command: { SetInitialCommand, SetLoadingCommand, SetFinishedCommand, UpdateStatusCommand },
    event: { UpdateStatusEvent }
  })
}

export default StatusModule
