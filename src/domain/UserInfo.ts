import { Remesh } from 'remesh'
import { BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import StorageEffect from '@/domain/modules/StorageEffect'
import StatusModule from './modules/Status'
import { USER_INFO_STORAGE_KEY } from '@/constants/config'

export interface UserInfo {
  id: string
  name: string
  avatar: string
  createTime: number
  themeMode: 'system' | 'light' | 'dark'
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

    const UserInfoLoadStatusModule = StatusModule(domain, {
      name: 'UserInfoLoadStatusModule'
    })
    const UserInfoSetStatusModule = StatusModule(domain, {
      name: 'UserInfoSetStatusModule'
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
        console.log('111', userInfo)

        return [
          UserInfoState().new(userInfo),
          UpdateUserInfoEvent(),
          SyncToStorageEvent(),
          userInfo
            ? UserInfoSetStatusModule.command.SetFinishedCommand()
            : UserInfoSetStatusModule.command.SetInitialCommand()
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
        return [
          UserInfoState().new(userInfo),
          UpdateUserInfoEvent(),
          SyncToStateEvent(userInfo),
          userInfo && UserInfoSetStatusModule.command.SetFinishedCommand()
        ]
      }
    })

    storageEffect
      .set(SyncToStorageEvent)
      .get<UserInfo>((value) => {
        return [SyncToStateCommand(value), UserInfoLoadStatusModule.command.SetFinishedCommand()]
      })
      .watch<UserInfo>((value) => [SyncToStateCommand(value)])

    return {
      query: {
        UserInfoQuery,
        UserInfoLoadIsFinishedQuery: UserInfoLoadStatusModule.query.IsFinishedQuery,
        UserInfoSetIsFinishedQuery: UserInfoSetStatusModule.query.IsFinishedQuery
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
