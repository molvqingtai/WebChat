import { Remesh } from 'remesh'
import { BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import StorageEffect from '@/domain/modules/StorageEffect'
import StatusModule from './modules/Status'
import { USER_INFO_STORAGE_KEY } from '@/constants/storage'
import { isChatUserWithinBudget } from '@/protocol/Limits'

export interface UserInfo {
  id: string
  name: string
  avatar: string
  createTime: number
  themeMode: 'system' | 'light' | 'dark'
  danmakuEnabled: boolean
  notificationEnabled: boolean
  notificationType: 'all' | 'at'
}

const UserInfoDomain = Remesh.domain({
  name: 'UserInfoDomain',
  impl: (domain) => {
    const storageEffect = new StorageEffect({
      domain,
      extern: BrowserSyncStorageExtern,
      key: USER_INFO_STORAGE_KEY
    })

    const UserInfoState = domain.state<UserInfo | null>({
      name: 'UserInfo.UserInfoState',
      default: null
    })

    const LoadStatus = StatusModule(domain, {
      name: 'UserInfo.LoadStatusModule'
    })
    const SetStatus = StatusModule(domain, {
      name: 'UserInfo.SetStatusModule'
    })

    const UserInfoQuery = domain.query({
      name: 'UserInfo.UserInfoQuery',
      impl: ({ get }) => {
        return get(UserInfoState())
      }
    })

    const UpdateUserInfoCommand = domain.command({
      name: 'UserInfo.UpdateUserInfoCommand',
      impl: (_, userInfo: UserInfo | null) => {
        // Local production boundary: the complete canonical user derived from the profile must
        // fit its 8KiB budget before the profile is accepted or persisted. Rejection is
        // fail-closed: nothing is stored, joined, or published.
        if (userInfo && !isChatUserWithinBudget({ id: userInfo.id, name: userInfo.name, avatar: userInfo.avatar })) {
          return []
        }
        return [
          UserInfoState().new(userInfo),
          UpdateUserInfoEvent(),
          SyncToStorageEvent(),
          userInfo ? SetStatus.command.SetFinishedCommand() : SetStatus.command.SetInitialCommand()
        ]
      }
    })

    const UpdateUserInfoEvent = domain.event({
      name: 'UserInfo.UpdateUserInfoEvent',
      impl: ({ get }) => {
        return get(UserInfoState())
      }
    })

    const SyncToStorageEvent = domain.event({
      name: 'UserInfo.SyncToStorageEvent',
      impl: ({ get }) => {
        return get(UserInfoState())
      }
    })

    const SyncToStateEvent = domain.event<UserInfo | null>({
      name: 'UserInfo.SyncToStateEvent'
    })

    const SyncToStateCommand = domain.command({
      name: 'UserInfo.SyncToStateCommand',
      impl: (_, userInfo: UserInfo | null) => {
        // Storage get/watch can inject a stored profile without the explicit update command; the
        // same complete-user budget applies so an over-8KiB stored profile never becomes state.
        if (userInfo && !isChatUserWithinBudget({ id: userInfo.id, name: userInfo.name, avatar: userInfo.avatar })) {
          return []
        }
        return [
          UserInfoState().new(userInfo),
          UpdateUserInfoEvent(),
          SyncToStateEvent(userInfo),
          userInfo ? SetStatus.command.SetFinishedCommand() : SetStatus.command.SetInitialCommand()
        ]
      }
    })

    storageEffect
      .set(SyncToStorageEvent)
      .get<UserInfo>((value) => [SyncToStateCommand(value), LoadStatus.command.SetFinishedCommand()])
      .watch<UserInfo>((value) => [SyncToStateCommand(value)])

    return {
      query: {
        UserInfoQuery,
        UserInfoLoadIsFinishedQuery: LoadStatus.query.IsFinishedQuery,
        UserInfoSetIsFinishedQuery: SetStatus.query.IsFinishedQuery
      },
      command: {
        UpdateUserInfoCommand
      },
      event: {
        SyncToStateEvent,
        SyncToStorageEvent,
        UpdateUserInfoEvent
      }
    }
  }
})

export default UserInfoDomain
