import { Remesh } from 'remesh'
import StatusModule from './modules/Status'
import { LocalStorageExtern } from './externs/Storage'
import { APP_STATUS_STORAGE_KEY } from '@/constants/config'
import StorageEffect from './modules/StorageEffect'
import RoomDomain, { SendType } from './Room'
import { map } from 'rxjs'

export interface AppStatus {
  open: boolean
  unread: number
  position: { x: number; y: number }
}

export const defaultStatusState = {
  open: false,
  unread: 0,
  position: { x: window.innerWidth - 50, y: window.innerHeight - 22 }
}

const AppStatusDomain = Remesh.domain({
  name: 'AppStatusDomain',
  impl: (domain) => {
    const storageEffect = new StorageEffect({
      domain,
      extern: LocalStorageExtern,
      key: APP_STATUS_STORAGE_KEY
    })
    const roomDomain = domain.getDomain(RoomDomain())

    const StatusLoadModule = StatusModule(domain, {
      name: 'AppStatus.LoadStatusModule'
    })

    const StatusLoadIsFinishedQuery = domain.query({
      name: 'AppStatus.StatusLoadIsFinishedQuery',
      impl: ({ get }) => {
        return get(StatusLoadModule.query.IsFinishedQuery())
      }
    })

    const StatusState = domain.state<AppStatus>({
      name: 'AppStatus.StatusState',
      default: defaultStatusState
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
        return UpdateStatusCommand({
          ...status,
          unread: value ? 0 : status.unread,
          open: value
        })
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

    storageEffect
      .set(SyncToStorageEvent)
      .get<AppStatus>((value) => [
        UpdateStatusCommand(value ?? defaultStatusState),
        StatusLoadModule.command.SetFinishedCommand()
      ])
      .watch<AppStatus>((value) => [UpdateStatusCommand(value ?? defaultStatusState)])

    domain.effect({
      name: 'OnMessageEffect',
      impl: ({ fromEvent, get }) => {
        const onMessage$ = fromEvent(roomDomain.event.OnMessageEvent).pipe(
          map((message) => {
            const status = get(StatusState())
            if (!status.open && message.type === SendType.Text) {
              return UpdateUnreadCommand(status.unread + 1)
            }
            return null
          })
        )
        return onMessage$
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
        UpdatePositionCommand
      },
      event: {
        SyncToStorageEvent
      }
    }
  }
})

export default AppStatusDomain
