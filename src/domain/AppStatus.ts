import { Remesh } from 'remesh'
import { fromEvent, map } from 'rxjs'
import { APP_OPEN_STORAGE_KEY, APP_POSITION_STORAGE_KEY, APP_UNREAD_STORAGE_KEY } from '@/constants/storage'
import { EVENT } from '@/constants/event'
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

const STATUS_FIELD = {
  OPEN: 0b001,
  POSITION: 0b010,
  UNREAD: 0b100,
  ALL: 0b111
} as const

const AppStatusDomain = Remesh.domain({
  name: 'AppStatusDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const StatusState = domain.state<AppStatus>({ name: 'AppStatus.StatusState', default: defaultStatus })
    const HydrationState = domain.state({
      name: 'AppStatus.HydrationState',
      default: { loaded: 0, updated: 0 }
    })
    const PhaseState = domain.state<InitializationPhase>({
      name: 'AppStatus.PhaseState',
      default: 'connecting'
    })

    const StatusLoadIsFinishedQuery = domain.query({
      name: 'AppStatus.StatusLoadIsFinishedQuery',
      impl: ({ get }) => get(HydrationState()).loaded === STATUS_FIELD.ALL
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
      impl: ({ get }) => {
        const status = get(StatusState())
        return !status.open && status.unread
      }
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
      impl: ({ get }) => get(StatusState()).open
    })

    const SyncPositionToStorageEvent = domain.event({
      name: 'AppStatus.SyncPositionToStorageEvent',
      impl: ({ get }) => get(StatusState()).position
    })

    const SyncUnreadToStorageEvent = domain.event({
      name: 'AppStatus.SyncUnreadToStorageEvent',
      impl: ({ get }) => get(StatusState()).unread
    })

    const UpdateUnreadCommand = domain.command({
      name: 'AppStatus.UpdateUnreadCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        if ((value && status.open) || status.unread === value) return null
        const hydration = get(HydrationState())
        return [
          HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.UNREAD }),
          StatusState().new({ ...status, unread: value }),
          SyncUnreadToStorageEvent()
        ]
      }
    })

    const UpdateOpenCommand = domain.command({
      name: 'AppStatus.UpdateOpenCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const updated = hydration.updated | STATUS_FIELD.OPEN | (value ? STATUS_FIELD.UNREAD : 0)
        if (status.open === value) return HydrationState().new({ ...hydration, updated })
        const nextStatus = value ? { ...status, open: true, unread: false } : { ...status, open: false }
        return value
          ? [
              HydrationState().new({ ...hydration, updated }),
              StatusState().new(nextStatus),
              SyncOpenToStorageEvent(),
              SyncUnreadToStorageEvent()
            ]
          : [HydrationState().new({ ...hydration, updated }), StatusState().new(nextStatus), SyncOpenToStorageEvent()]
      }
    })

    const UpdatePositionCommand = domain.command({
      name: 'AppStatus.UpdatePositionCommand',
      impl: ({ get }, value: AppButtonPosition) => {
        const status = get(StatusState())
        if (status.position.x === value.x && status.position.y === value.y) return null
        const hydration = get(HydrationState())
        return [
          HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.POSITION }),
          StatusState().new({ ...status, position: value }),
          SyncPositionToStorageEvent()
        ]
      }
    })

    const HydrateOpenCommand = domain.command({
      name: 'AppStatus.HydrateOpenCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const apply = (hydration.updated & STATUS_FIELD.OPEN) === 0
        return [
          ...(apply
            ? [StatusState().new(value ? { ...status, open: true, unread: false } : { ...status, open: false })]
            : []),
          HydrationState().new({ ...hydration, loaded: hydration.loaded | STATUS_FIELD.OPEN })
        ]
      }
    })

    const SynchronizeOpenCommand = domain.command({
      name: 'AppStatus.SynchronizeOpenCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const clearUnread = value && status.unread
        return [
          HydrationState().new({
            ...hydration,
            updated: hydration.updated | STATUS_FIELD.OPEN | (value ? STATUS_FIELD.UNREAD : 0)
          }),
          StatusState().new(value ? { ...status, open: true, unread: false } : { ...status, open: false }),
          ...(clearUnread ? [SyncUnreadToStorageEvent()] : [])
        ]
      }
    })

    const HydratePositionCommand = domain.command({
      name: 'AppStatus.HydratePositionCommand',
      impl: ({ get }, value: AppButtonPosition) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const apply = (hydration.updated & STATUS_FIELD.POSITION) === 0
        return [
          ...(apply ? [StatusState().new({ ...status, position: value })] : []),
          HydrationState().new({ ...hydration, loaded: hydration.loaded | STATUS_FIELD.POSITION })
        ]
      }
    })

    const SynchronizePositionCommand = domain.command({
      name: 'AppStatus.SynchronizePositionCommand',
      impl: ({ get }, value: AppButtonPosition) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        return [
          HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.POSITION }),
          StatusState().new({ ...status, position: value })
        ]
      }
    })

    const HydrateUnreadCommand = domain.command({
      name: 'AppStatus.HydrateUnreadCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const apply = (hydration.updated & STATUS_FIELD.UNREAD) === 0
        return [
          ...(apply ? [StatusState().new({ ...status, unread: status.open ? false : value })] : []),
          HydrationState().new({ ...hydration, loaded: hydration.loaded | STATUS_FIELD.UNREAD })
        ]
      }
    })

    const SynchronizeUnreadCommand = domain.command({
      name: 'AppStatus.SynchronizeUnreadCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        return [
          HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.UNREAD }),
          StatusState().new({ ...status, unread: status.open ? false : value }),
          ...(status.open && value ? [SyncUnreadToStorageEvent()] : [])
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
      name: 'AppStatus.OnOpenIntentEffect',
      impl: () => fromEvent(window, EVENT.APP_OPEN).pipe(map(() => UpdateOpenCommand(true)))
    })

    domain.effect({
      name: 'AppStatus.OnTextMessageEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.OnTextMessageEvent).pipe(
          map((message) => {
            const selfId = get(userInfoDomain.query.UserInfoQuery())?.id
            return get(StatusState()).open || message.author.id === selfId ? null : UpdateUnreadCommand(true)
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
