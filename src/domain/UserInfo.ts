import { Remesh } from 'remesh'
import { nanoid } from 'nanoid'
import { BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import StorageEffect from '@/domain/modules/StorageEffect'
import generateUglyAvatar from '@/lib/uglyAvatar'
import generateRandomName from '@/utils/generateRandomName'

export interface UserInfo {
  id: string
  name: string
  avatar: string
  createTime: number
  themeMode: 'system' | 'light' | 'dark'
}

export const STORAGE_KEY = 'USER_INFO'

const UserInfoDomain = Remesh.domain({
  name: 'UserInfoDomain',
  impl: (domain) => {
    const storageEffect = new StorageEffect({
      domain,
      extern: BrowserSyncStorageExtern,
      key: STORAGE_KEY
    })

    const UserInfoState = domain.state<UserInfo | null>({
      name: 'UserInfo.UserInfoState',
      default: null
    })

    const UserInfoQuery = domain.query({
      name: 'UserInfo.UserInfoQuery',
      impl: ({ get }) => {
        return get(UserInfoState())
      }
    })

    const IsLoginQuery = domain.query({
      name: 'UserInfo.IsLoginQuery',
      impl: ({ get }) => {
        return !!get(UserInfoState())?.id
      }
    })

    const UpdateUserInfoCommand = domain.command({
      name: 'UserInfo.UpdateUserInfoCommand',
      impl: (_, userInfo: UserInfo | null) => {
        return [UserInfoState().new(userInfo), UpdateUserInfoEvent(), SyncToStorageEvent()]
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
        return [UserInfoState().new(userInfo), UpdateUserInfoEvent(), SyncToStateEvent(userInfo)]
      }
    })

    storageEffect
      .set(SyncToStorageEvent)
      .get<UserInfo>((value) => SyncToStateCommand(value))
      .watch<UserInfo>((value) => SyncToStateCommand(value!))

    return {
      query: {
        UserInfoQuery,
        IsLoginQuery
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
