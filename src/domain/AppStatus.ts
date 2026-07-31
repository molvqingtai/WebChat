import { Remesh } from 'remesh'
import { map } from 'rxjs'
import StatusModule from './modules/Status'
import { APP_STATUS_STORAGE_KEY } from '@/constants/storage'
import { LocalStorageExtern } from '@/domain/externs/Storage'
import StorageEffect from '@/domain/modules/StorageEffect'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'

export interface AppStatus {
  open: boolean
  unread: number
  position: { x: number; y: number }
}

type InitializationPhase = 'connecting' | 'unavailable' | 'ready'

// Position is stored as offset from bottom-right corner
const defaultStatusState: AppStatus = {
  open: false,
  unread: 0,
  position: { x: 50, y: 22 }
}

const AppStatusDomain = Remesh.domain({
  name: 'AppStatusDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const LoadStatus = StatusModule(domain, {
      name: 'AppStatus.LoadStatusModule'
    })

    const StatusLoadIsFinishedQuery = domain.query({
      name: 'AppStatus.StatusLoadIsFinishedQuery',
      impl: ({ get }) => get(LoadStatus.query.IsFinishedQuery())
    })

    const StatusState = domain.state<AppStatus>({
      name: 'AppStatus.StatusState',
      default: defaultStatusState
    })

    const OpenWasUpdatedState = domain.state({
      name: 'AppStatus.OpenWasUpdatedState',
      default: false
    })

    const PhaseState = domain.state<InitializationPhase>({
      name: 'AppStatus.PhaseState',
      default: 'connecting'
    })

    const OpenQuery = domain.query({
      name: 'AppStatus.IsOpenQuery',
      impl: ({ get }) => get(StatusState()).open
    })

    const PositionQuery = domain.query({
      name: 'AppStatus.PositionQuery',
      impl: ({ get }) => get(StatusState()).position
    })

    const HasUnreadQuery = domain.query({
      name: 'AppStatus.HasUnreadQuery',
      impl: ({ get }) => get(StatusState()).unread > 0
    })

    const PhaseQuery = domain.query({
      name: 'AppStatus.PhaseQuery',
      impl: ({ get }) => get(PhaseState())
    })

    const ReadyQuery = domain.query({
      name: 'AppStatus.ReadyQuery',
      impl: ({ get }) => get(PhaseQuery()) === 'ready'
    })

    const SyncToStorageEvent = domain.event({
      name: 'AppStatus.SyncToStorageEvent',
      impl: ({ get }) => get(StatusState())
    })

    const UpdateStatusCommand = domain.command({
      name: 'AppStatus.UpdateStatusCommand',
      impl: (_, value: AppStatus) => [StatusState().new(value), SyncToStorageEvent()]
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
      impl: ({ get }, value: number) => UpdateStatusCommand({ ...get(StatusState()), unread: value })
    })

    const UpdatePositionCommand = domain.command({
      name: 'AppStatus.UpdatePositionCommand',
      impl: ({ get }, value: { x: number; y: number }) =>
        UpdateStatusCommand({ ...get(StatusState()), position: value })
    })

    const HydrateStatusCommand = domain.command({
      name: 'AppStatus.HydrateStatusCommand',
      impl: ({ get }, value: AppStatus) => {
        const current = get(StatusState())
        const next = get(OpenWasUpdatedState()) ? { ...value, open: current.open, unread: current.unread } : value
        return [UpdateStatusCommand(next), LoadStatus.command.SetFinishedCommand()]
      }
    })

    const RetryRequestedEvent = domain.event({ name: 'AppStatus.RetryRequestedEvent' })

    const RetryCommand = domain.command({
      name: 'AppStatus.RetryCommand',
      impl: ({ get }) =>
        get(PhaseQuery()) === 'unavailable' ? [PhaseState().new('connecting'), RetryRequestedEvent()] : null
    })

    const MarkReadyCommand = domain.command({
      name: 'AppStatus.MarkReadyCommand',
      impl: ({ get }) => (get(PhaseQuery()) === 'connecting' ? PhaseState().new('ready') : null)
    })

    const MarkUnavailableCommand = domain.command({
      name: 'AppStatus.MarkUnavailableCommand',
      impl: ({ get }) => (get(PhaseQuery()) === 'connecting' ? PhaseState().new('unavailable') : null)
    })

    const storageEffect = new StorageEffect({
      domain,
      extern: LocalStorageExtern,
      key: APP_STATUS_STORAGE_KEY
    })

    storageEffect
      .set(SyncToStorageEvent)
      .get<AppStatus>((value) => HydrateStatusCommand(value ?? defaultStatusState))
      .watch<AppStatus>((value) => UpdateStatusCommand(value ?? defaultStatusState))

    domain.effect({
      name: 'AppStatus.OnTextMessageEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.OnTextMessageEvent).pipe(
          map((message) => {
            const selfId = get(userInfoDomain.query.UserInfoQuery())?.id
            if (get(OpenQuery()) || message.author.id === selfId) return null
            return UpdateUnreadCommand(get(StatusState()).unread + 1)
          })
        )
    })

    return {
      query: {
        OpenQuery,
        HasUnreadQuery,
        PositionQuery,
        StatusLoadIsFinishedQuery,
        PhaseQuery,
        ReadyQuery
      },
      command: {
        UpdateOpenCommand,
        UpdatePositionCommand,
        RetryCommand,
        MarkReadyCommand,
        MarkUnavailableCommand
      },
      event: {
        RetryRequestedEvent
      }
    }
  }
})

export default AppStatusDomain
