import { Remesh } from 'remesh'
import { map } from 'rxjs'
import StatusModule from './modules/Status'
import { APP_OPEN_STORAGE_KEY, APP_POSITION_STORAGE_KEY, APP_UNREAD_STORAGE_KEY } from '@/constants/storage'
import { LocalStorageExtern } from '@/domain/externs/Storage'
import StorageEffect from '@/domain/modules/StorageEffect'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'

export interface AppButtonPosition {
  /** Negative values are left-edge distances; non-negative values are right-edge distances. */
  x: number
  /** Distance from the viewport bottom to the launcher bottom edge. */
  y: number
}

export interface AppStatus {
  open: boolean
  unread: boolean
  position: AppButtonPosition
}

type InitializationPhase = 'connecting' | 'unavailable' | 'ready'

const defaultStatus: AppStatus = {
  open: false,
  unread: false,
  position: { x: 50, y: 22 }
}

const AppStatusDomain = Remesh.domain({
  name: 'AppStatusDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const LoadOpen = StatusModule(domain, { name: 'AppStatus.OpenLoadStatusModule' })
    const LoadPosition = StatusModule(domain, { name: 'AppStatus.PositionLoadStatusModule' })
    const LoadUnread = StatusModule(domain, { name: 'AppStatus.UnreadLoadStatusModule' })

    const StatusLoadIsFinishedQuery = domain.query({
      name: 'AppStatus.StatusLoadIsFinishedQuery',
      impl: ({ get }) =>
        get(LoadOpen.query.IsFinishedQuery()) &&
        get(LoadPosition.query.IsFinishedQuery()) &&
        get(LoadUnread.query.IsFinishedQuery())
    })

    const OpenState = domain.state({ name: 'AppStatus.OpenState', default: defaultStatus.open })
    const PositionState = domain.state({ name: 'AppStatus.PositionState', default: defaultStatus.position })
    const UnreadState = domain.state({ name: 'AppStatus.UnreadState', default: defaultStatus.unread })
    const OpenWasUpdatedState = domain.state({ name: 'AppStatus.OpenWasUpdatedState', default: false })
    const PositionWasUpdatedState = domain.state({ name: 'AppStatus.PositionWasUpdatedState', default: false })
    const UnreadWasUpdatedState = domain.state({ name: 'AppStatus.UnreadWasUpdatedState', default: false })
    const PhaseState = domain.state<InitializationPhase>({
      name: 'AppStatus.PhaseState',
      default: 'connecting'
    })

    const OpenQuery = domain.query({
      name: 'AppStatus.IsOpenQuery',
      impl: ({ get }) => get(OpenState())
    })

    const PositionQuery = domain.query({
      name: 'AppStatus.PositionQuery',
      impl: ({ get }) => get(PositionState())
    })

    const HasUnreadQuery = domain.query({
      name: 'AppStatus.HasUnreadQuery',
      impl: ({ get }) => !get(OpenState()) && get(UnreadState())
    })

    const PhaseQuery = domain.query({
      name: 'AppStatus.PhaseQuery',
      impl: ({ get }) => get(PhaseState())
    })

    const ReadyQuery = domain.query({
      name: 'AppStatus.ReadyQuery',
      impl: ({ get }) => get(PhaseQuery()) === 'ready'
    })

    const SyncOpenToStorageEvent = domain.event({
      name: 'AppStatus.SyncOpenToStorageEvent',
      impl: ({ get }) => get(OpenState())
    })

    const SyncPositionToStorageEvent = domain.event({
      name: 'AppStatus.SyncPositionToStorageEvent',
      impl: ({ get }) => get(PositionState())
    })

    const SyncUnreadToStorageEvent = domain.event({
      name: 'AppStatus.SyncUnreadToStorageEvent',
      impl: ({ get }) => get(UnreadState())
    })

    const UpdateUnreadCommand = domain.command({
      name: 'AppStatus.UpdateUnreadCommand',
      impl: ({ get }, value: boolean) => {
        if ((value && get(OpenState())) || get(UnreadState()) === value) return null
        return [UnreadWasUpdatedState().new(true), UnreadState().new(value), SyncUnreadToStorageEvent()]
      }
    })

    const UpdateOpenCommand = domain.command({
      name: 'AppStatus.UpdateOpenCommand',
      impl: ({ get }, value: boolean) => {
        if (get(OpenState()) === value) return OpenWasUpdatedState().new(true)
        return value
          ? [
              OpenWasUpdatedState().new(true),
              UnreadWasUpdatedState().new(true),
              OpenState().new(true),
              UnreadState().new(false),
              SyncOpenToStorageEvent(),
              SyncUnreadToStorageEvent()
            ]
          : [OpenWasUpdatedState().new(true), OpenState().new(false), SyncOpenToStorageEvent()]
      }
    })

    const UpdatePositionCommand = domain.command({
      name: 'AppStatus.UpdatePositionCommand',
      impl: ({ get }, value: AppButtonPosition) => {
        const current = get(PositionState())
        if (current.x === value.x && current.y === value.y) return null
        return [PositionWasUpdatedState().new(true), PositionState().new(value), SyncPositionToStorageEvent()]
      }
    })

    const HydrateOpenCommand = domain.command({
      name: 'AppStatus.HydrateOpenCommand',
      impl: ({ get }, value: boolean) => [
        ...(get(OpenWasUpdatedState()) ? [] : [OpenState().new(value), ...(value ? [UnreadState().new(false)] : [])]),
        LoadOpen.command.SetFinishedCommand()
      ]
    })

    const SynchronizeOpenCommand = domain.command({
      name: 'AppStatus.SynchronizeOpenCommand',
      impl: ({ get }, value: boolean) => {
        const clearUnread = value && get(UnreadState())
        return [
          OpenWasUpdatedState().new(true),
          OpenState().new(value),
          ...(value ? [UnreadWasUpdatedState().new(true), UnreadState().new(false)] : []),
          ...(clearUnread ? [SyncUnreadToStorageEvent()] : [])
        ]
      }
    })

    const HydratePositionCommand = domain.command({
      name: 'AppStatus.HydratePositionCommand',
      impl: ({ get }, value: AppButtonPosition) => [
        ...(get(PositionWasUpdatedState()) ? [] : [PositionState().new(value)]),
        LoadPosition.command.SetFinishedCommand()
      ]
    })

    const SynchronizePositionCommand = domain.command({
      name: 'AppStatus.SynchronizePositionCommand',
      impl: (_, value: AppButtonPosition) => [PositionWasUpdatedState().new(true), PositionState().new(value)]
    })

    const HydrateUnreadCommand = domain.command({
      name: 'AppStatus.HydrateUnreadCommand',
      impl: ({ get }, value: boolean) => [
        ...(get(UnreadWasUpdatedState()) ? [] : [UnreadState().new(get(OpenState()) ? false : value)]),
        LoadUnread.command.SetFinishedCommand()
      ]
    })

    const SynchronizeUnreadCommand = domain.command({
      name: 'AppStatus.SynchronizeUnreadCommand',
      impl: ({ get }, value: boolean) => {
        const open = get(OpenState())
        return [
          UnreadWasUpdatedState().new(true),
          UnreadState().new(open ? false : value),
          ...(open && value ? [SyncUnreadToStorageEvent()] : [])
        ]
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

    new StorageEffect({ domain, extern: LocalStorageExtern, key: APP_OPEN_STORAGE_KEY })
      .set(SyncOpenToStorageEvent)
      .get<boolean>((value) => HydrateOpenCommand(value ?? defaultStatus.open))
      .watch<boolean>((value) => SynchronizeOpenCommand(value ?? defaultStatus.open))

    new StorageEffect({ domain, extern: LocalStorageExtern, key: APP_POSITION_STORAGE_KEY })
      .set(SyncPositionToStorageEvent)
      .get<AppButtonPosition>((value) => HydratePositionCommand(value ?? defaultStatus.position))
      .watch<AppButtonPosition>((value) => SynchronizePositionCommand(value ?? defaultStatus.position))

    new StorageEffect({ domain, extern: LocalStorageExtern, key: APP_UNREAD_STORAGE_KEY })
      .set(SyncUnreadToStorageEvent)
      .get<boolean>((value) => HydrateUnreadCommand(value ?? defaultStatus.unread))
      .watch<boolean>((value) => SynchronizeUnreadCommand(value ?? defaultStatus.unread))

    domain.effect({
      name: 'AppStatus.OnTextMessageEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.OnTextMessageEvent).pipe(
          map((message) => {
            const selfId = get(userInfoDomain.query.UserInfoQuery())?.id
            return get(OpenState()) || message.author.id === selfId ? null : UpdateUnreadCommand(true)
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
