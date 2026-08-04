import { Remesh } from 'remesh'
import { EMPTY, map, switchMap, timer } from 'rxjs'
import {
  APP_MESSAGE_AUTHOR_STORAGE_KEY,
  APP_OPEN_STORAGE_KEY,
  APP_POSITION_STORAGE_KEY,
  APP_UNREAD_STORAGE_KEY
} from '@/constants/storage'
import { LocalStorageExtern } from '@/domain/externs/Storage'
import StorageEffect from '@/domain/modules/StorageEffect'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'
import type { ChatUser } from '@/protocol/Session'

export interface AppButtonPosition {
  /** Negative values are left-edge distances; non-negative values are right-edge distances. */
  x: number
  /** Distance from the viewport bottom to the launcher bottom edge. */
  y: number
}

export interface AppButtonAuthorStatus {
  revision: number
  messageId: string | null
  author: ChatUser | null
  deadline: number | null
}

export interface AppStatus {
  open: boolean
  unread: boolean
  position: AppButtonPosition
  messageAuthor: AppButtonAuthorStatus
}

type InitializationPhase = 'connecting' | 'unavailable' | 'ready'

const APP_BUTTON_AUTHOR_LIFETIME_MS = 1_000

const defaultMessageAuthor: AppButtonAuthorStatus = {
  revision: 0,
  messageId: null,
  author: null,
  deadline: null
}

const defaultStatus: AppStatus = {
  open: false,
  unread: false,
  position: { x: 50, y: 22 },
  messageAuthor: defaultMessageAuthor
}

const STATUS_FIELD = {
  OPEN: 0b0001,
  POSITION: 0b0010,
  UNREAD: 0b0100,
  MESSAGE_AUTHOR: 0b1000,
  ALL: 0b1111
} as const

// Absolute monotonic time is comparable across documents; equal stamps follow shared-storage write order.
const nextMessageAuthorRevision = (current: AppButtonAuthorStatus) =>
  Math.max(current.revision, performance.timeOrigin + performance.now())

const clearMessageAuthor = (current: AppButtonAuthorStatus): AppButtonAuthorStatus => ({
  revision: nextMessageAuthorRevision(current),
  messageId: null,
  author: null,
  deadline: null
})

const sameMessageAuthor = (left: AppButtonAuthorStatus, right: AppButtonAuthorStatus) =>
  left.revision === right.revision &&
  left.messageId === right.messageId &&
  left.deadline === right.deadline &&
  left.author?.id === right.author?.id &&
  left.author?.name === right.author?.name &&
  left.author?.avatar === right.author?.avatar

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

    const AppButtonAuthorQuery = domain.query({
      name: 'AppStatus.AppButtonAuthorQuery',
      impl: ({ get }) => {
        if (get(HydrationState()).loaded !== STATUS_FIELD.ALL) return null
        const status = get(StatusState())
        const selection = status.messageAuthor
        if (!selection.author) return null
        if (status.open) {
          return selection.deadline !== null && selection.deadline > Date.now() ? selection.author : null
        }
        return status.unread && selection.deadline === null ? selection.author : null
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

    const SyncMessageAuthorToStorageEvent = domain.event({
      name: 'AppStatus.SyncMessageAuthorToStorageEvent',
      impl: ({ get }) => get(StatusState()).messageAuthor
    })

    const MessageAuthorDeadlineChangedEvent = domain.event<AppButtonAuthorStatus>({
      name: 'AppStatus.MessageAuthorDeadlineChangedEvent'
    })

    const ReconcileHydratedStatusCommand = domain.command({
      name: 'AppStatus.ReconcileHydratedStatusCommand',
      impl: ({ get }) => {
        if (get(HydrationState()).loaded !== STATUS_FIELD.ALL) return null
        const status = get(StatusState())
        const selection = status.messageAuthor
        const valid = status.open
          ? selection.author !== null && selection.deadline !== null && selection.deadline > Date.now()
          : status.unread && selection.author !== null && selection.deadline === null
        if (valid || (selection.author === null && selection.deadline === null)) {
          return MessageAuthorDeadlineChangedEvent(selection)
        }
        const cleared = clearMessageAuthor(selection)
        const hydration = get(HydrationState())
        return [
          HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.MESSAGE_AUTHOR }),
          StatusState().new({ ...status, messageAuthor: cleared }),
          SyncMessageAuthorToStorageEvent(),
          MessageAuthorDeadlineChangedEvent(cleared)
        ]
      }
    })

    const UpdateOpenCommand = domain.command({
      name: 'AppStatus.UpdateOpenCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const changed = status.open !== value
        const updated =
          hydration.updated |
          STATUS_FIELD.OPEN |
          (value ? STATUS_FIELD.UNREAD : 0) |
          (changed ? STATUS_FIELD.MESSAGE_AUTHOR : 0)
        if (!changed) return HydrationState().new({ ...hydration, updated })
        const messageAuthor = clearMessageAuthor(status.messageAuthor)
        const nextStatus = value
          ? { ...status, open: true, unread: false, messageAuthor }
          : { ...status, open: false, messageAuthor }
        return [
          HydrationState().new({ ...hydration, updated }),
          StatusState().new(nextStatus),
          SyncOpenToStorageEvent(),
          ...(value ? [SyncUnreadToStorageEvent()] : []),
          SyncMessageAuthorToStorageEvent(),
          MessageAuthorDeadlineChangedEvent(messageAuthor)
        ]
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

    const SelectMessageAuthorCommand = domain.command({
      name: 'AppStatus.SelectMessageAuthorCommand',
      impl: ({ get }, message: { id: string; author: ChatUser }) => {
        const status = get(StatusState())
        const now = Date.now()
        const messageAuthor: AppButtonAuthorStatus = {
          revision: nextMessageAuthorRevision(status.messageAuthor),
          messageId: message.id,
          author: message.author,
          deadline: status.open ? now + APP_BUTTON_AUTHOR_LIFETIME_MS : null
        }
        const unread = status.open ? false : true
        const hydration = get(HydrationState())
        return [
          HydrationState().new({
            ...hydration,
            updated: hydration.updated | STATUS_FIELD.MESSAGE_AUTHOR | (status.open ? 0 : STATUS_FIELD.UNREAD)
          }),
          StatusState().new({ ...status, unread, messageAuthor }),
          ...(unread !== status.unread ? [SyncUnreadToStorageEvent()] : []),
          SyncMessageAuthorToStorageEvent(),
          MessageAuthorDeadlineChangedEvent(messageAuthor)
        ]
      }
    })

    const ExpireMessageAuthorCommand = domain.command({
      name: 'AppStatus.ExpireMessageAuthorCommand',
      impl: ({ get }, expired: Pick<AppButtonAuthorStatus, 'revision' | 'messageId' | 'deadline'>) => {
        const status = get(StatusState())
        const current = status.messageAuthor
        if (
          current.revision !== expired.revision ||
          current.messageId !== expired.messageId ||
          current.deadline !== expired.deadline
        ) {
          return null
        }
        const cleared = clearMessageAuthor(current)
        const hydration = get(HydrationState())
        return [
          HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.MESSAGE_AUTHOR }),
          StatusState().new({ ...status, messageAuthor: cleared }),
          SyncMessageAuthorToStorageEvent(),
          MessageAuthorDeadlineChangedEvent(cleared)
        ]
      }
    })

    const HydrateOpenCommand = domain.command({
      name: 'AppStatus.HydrateOpenCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const apply = (hydration.updated & STATUS_FIELD.OPEN) === 0
        const nextHydration = { ...hydration, loaded: hydration.loaded | STATUS_FIELD.OPEN }
        return [
          ...(apply
            ? [StatusState().new(value ? { ...status, open: true, unread: false } : { ...status, open: false })]
            : []),
          HydrationState().new(nextHydration),
          ...(nextHydration.loaded === STATUS_FIELD.ALL ? [ReconcileHydratedStatusCommand()] : [])
        ]
      }
    })

    const SynchronizeOpenCommand = domain.command({
      name: 'AppStatus.SynchronizeOpenCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const clearUnread = value && status.unread
        const clearAuthor =
          status.messageAuthor.author !== null &&
          (value ? status.messageAuthor.deadline === null : status.messageAuthor.deadline !== null)
        const messageAuthor = clearAuthor ? clearMessageAuthor(status.messageAuthor) : status.messageAuthor
        return [
          HydrationState().new({
            ...hydration,
            updated:
              hydration.updated |
              STATUS_FIELD.OPEN |
              (value ? STATUS_FIELD.UNREAD : 0) |
              (clearAuthor ? STATUS_FIELD.MESSAGE_AUTHOR : 0)
          }),
          StatusState().new({
            ...status,
            open: value,
            unread: value ? false : status.unread,
            messageAuthor
          }),
          ...(clearUnread ? [SyncUnreadToStorageEvent()] : []),
          ...(clearAuthor ? [SyncMessageAuthorToStorageEvent(), MessageAuthorDeadlineChangedEvent(messageAuthor)] : [])
        ]
      }
    })

    const HydratePositionCommand = domain.command({
      name: 'AppStatus.HydratePositionCommand',
      impl: ({ get }, value: AppButtonPosition) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const apply = (hydration.updated & STATUS_FIELD.POSITION) === 0
        const nextHydration = { ...hydration, loaded: hydration.loaded | STATUS_FIELD.POSITION }
        return [
          ...(apply ? [StatusState().new({ ...status, position: value })] : []),
          HydrationState().new(nextHydration),
          ...(nextHydration.loaded === STATUS_FIELD.ALL ? [ReconcileHydratedStatusCommand()] : [])
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
        const nextHydration = { ...hydration, loaded: hydration.loaded | STATUS_FIELD.UNREAD }
        return [
          ...(apply ? [StatusState().new({ ...status, unread: status.open ? false : value })] : []),
          HydrationState().new(nextHydration),
          ...(nextHydration.loaded === STATUS_FIELD.ALL ? [ReconcileHydratedStatusCommand()] : [])
        ]
      }
    })

    const SynchronizeUnreadCommand = domain.command({
      name: 'AppStatus.SynchronizeUnreadCommand',
      impl: ({ get }, value: boolean) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const unread = status.open ? false : value
        const clearAuthor =
          status.unread !== unread &&
          !unread &&
          status.messageAuthor.author !== null &&
          status.messageAuthor.deadline === null
        const messageAuthor = clearAuthor ? clearMessageAuthor(status.messageAuthor) : status.messageAuthor
        return [
          HydrationState().new({
            ...hydration,
            updated: hydration.updated | STATUS_FIELD.UNREAD | (clearAuthor ? STATUS_FIELD.MESSAGE_AUTHOR : 0)
          }),
          StatusState().new({ ...status, unread, messageAuthor }),
          ...(status.open && value ? [SyncUnreadToStorageEvent()] : []),
          ...(clearAuthor ? [SyncMessageAuthorToStorageEvent(), MessageAuthorDeadlineChangedEvent(messageAuthor)] : [])
        ]
      }
    })

    const HydrateMessageAuthorCommand = domain.command({
      name: 'AppStatus.HydrateMessageAuthorCommand',
      impl: ({ get }, value: AppButtonAuthorStatus) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        const apply = (hydration.updated & STATUS_FIELD.MESSAGE_AUTHOR) === 0
        const nextHydration = { ...hydration, loaded: hydration.loaded | STATUS_FIELD.MESSAGE_AUTHOR }
        return [
          ...(apply ? [StatusState().new({ ...status, messageAuthor: value })] : []),
          HydrationState().new(nextHydration),
          ...(nextHydration.loaded === STATUS_FIELD.ALL ? [ReconcileHydratedStatusCommand()] : [])
        ]
      }
    })

    const SynchronizeMessageAuthorCommand = domain.command({
      name: 'AppStatus.SynchronizeMessageAuthorCommand',
      impl: ({ get }, value: AppButtonAuthorStatus) => {
        const status = get(StatusState())
        const hydration = get(HydrationState())
        if (value.revision < status.messageAuthor.revision) {
          return [
            HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.MESSAGE_AUTHOR }),
            SyncMessageAuthorToStorageEvent()
          ]
        }
        if (sameMessageAuthor(value, status.messageAuthor)) {
          return HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.MESSAGE_AUTHOR })
        }
        const expired = value.author !== null && value.deadline !== null && value.deadline <= Date.now()
        const messageAuthor = expired ? clearMessageAuthor(value) : value
        return [
          HydrationState().new({ ...hydration, updated: hydration.updated | STATUS_FIELD.MESSAGE_AUTHOR }),
          StatusState().new({ ...status, messageAuthor }),
          ...(expired ? [SyncMessageAuthorToStorageEvent()] : []),
          MessageAuthorDeadlineChangedEvent(messageAuthor)
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

    new StorageEffect({ domain, extern: LocalStorageExtern, key: APP_MESSAGE_AUTHOR_STORAGE_KEY })
      .set(SyncMessageAuthorToStorageEvent)
      .get<AppButtonAuthorStatus>((value) => HydrateMessageAuthorCommand(value ?? defaultMessageAuthor))
      .watch<AppButtonAuthorStatus>((value) => SynchronizeMessageAuthorCommand(value ?? defaultMessageAuthor))

    domain.effect({
      name: 'AppStatus.OnTextMessageEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.OnTextMessageEvent).pipe(
          map((message) => {
            const selfId = get(userInfoDomain.query.UserInfoQuery())?.id
            return message.author.id === selfId ? null : SelectMessageAuthorCommand(message)
          })
        )
    })

    domain.effect({
      name: 'AppStatus.MessageAuthorDeadlineEffect',
      impl: ({ fromEvent }) =>
        fromEvent(MessageAuthorDeadlineChangedEvent).pipe(
          switchMap((selection) =>
            selection.author === null || selection.deadline === null
              ? EMPTY
              : timer(Math.max(0, selection.deadline - Date.now())).pipe(
                  map(() =>
                    ExpireMessageAuthorCommand({
                      revision: selection.revision,
                      messageId: selection.messageId,
                      deadline: selection.deadline
                    })
                  )
                )
          )
        )
    })

    return {
      query: {
        OpenQuery,
        HasUnreadQuery,
        AppButtonAuthorQuery,
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
