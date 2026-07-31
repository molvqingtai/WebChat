import { Remesh } from 'remesh'
import StatusModule from './modules/Status'

export interface AppStatus {
  open: boolean
  unread: number
  position: { x: number; y: number }
}

// Position is stored as offset from bottom-right corner
export const defaultStatusState: AppStatus = {
  open: false,
  unread: 0,
  position: { x: 50, y: 22 }
}

const AppStatusDomain = Remesh.domain({
  name: 'AppStatusDomain',
  impl: (domain) => {
    const LoadStatus = StatusModule(domain, {
      name: 'AppStatus.LoadStatusModule'
    })

    const StatusLoadIsFinishedQuery = domain.query({
      name: 'AppStatus.StatusLoadIsFinishedQuery',
      impl: ({ get }) => {
        return get(LoadStatus.query.IsFinishedQuery())
      }
    })

    const StatusState = domain.state<AppStatus>({
      name: 'AppStatus.StatusState',
      default: defaultStatusState
    })

    const OpenWasUpdatedState = domain.state({
      name: 'AppStatus.OpenWasUpdatedState',
      default: false
    })

    const OpenQuery = domain.query({
      name: 'AppStatus.IsOpenQuery',
      impl: ({ get }) => {
        return get(StatusState()).open
      }
    })

    const UnreadQuery = domain.query({
      name: 'AppStatus.UnreadQuery',
      impl: ({ get }) => {
        return get(StatusState()).unread
      }
    })

    const PositionQuery = domain.query({
      name: 'AppStatus.PositionQuery',
      impl: ({ get }) => {
        return get(StatusState()).position
      }
    })

    const HasUnreadQuery = domain.query({
      name: 'AppStatus.HasUnreadQuery',
      impl: ({ get }) => {
        return get(StatusState()).unread > 0
      }
    })

    const UpdateOpenCommand = domain.command({
      name: 'AppStatus.UpdateOpenCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        return [
          OpenWasUpdatedState().new(true),
          UpdateStatusCommand({
            ...status,
            unread: value ? 0 : status.unread,
            open: value
          })
        ]
      }
    })

    const UpdateUnreadCommand = domain.command({
      name: 'AppStatus.UpdateUnreadCommand',
      impl: ({ get }, value: number) => {
        const status = get(StatusState())
        return UpdateStatusCommand({
          ...status,
          unread: value
        })
      }
    })

    const UpdatePositionCommand = domain.command({
      name: 'AppStatus.UpdatePositionCommand',
      impl: ({ get }, value: { x: number; y: number }) => {
        const status = get(StatusState())
        return UpdateStatusCommand({
          ...status,
          position: value
        })
      }
    })

    const UpdateStatusCommand = domain.command({
      name: 'AppStatus.UpdateStatusCommand',
      impl: (_, value: AppStatus) => {
        return [StatusState().new(value), SyncToStorageEvent()]
      }
    })

    const SyncToStorageEvent = domain.event({
      name: 'UserInfo.SyncToStorageEvent',
      impl: ({ get }) => {
        return get(StatusState())
      }
    })

    const HydrateStatusCommand = domain.command({
      name: 'AppStatus.HydrateStatusCommand',
      impl: ({ get }, value: AppStatus) => {
        const current = get(StatusState())
        const next = get(OpenWasUpdatedState()) ? { ...value, open: current.open, unread: current.unread } : value
        return [UpdateStatusCommand(next), LoadStatus.command.SetFinishedCommand()]
      }
    })

    return {
      query: {
        OpenQuery,
        UnreadQuery,
        HasUnreadQuery,
        PositionQuery,
        StatusLoadIsFinishedQuery
      },
      command: {
        UpdateOpenCommand,
        UpdateUnreadCommand,
        UpdatePositionCommand,
        UpdateStatusCommand,
        HydrateStatusCommand
      },
      event: {
        SyncToStorageEvent
      }
    }
  }
})

export default AppStatusDomain
