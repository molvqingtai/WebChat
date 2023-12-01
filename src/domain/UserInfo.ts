import { Remesh } from 'remesh'
import { forkJoin, from, map, merge, tap } from 'rxjs'
import Storage from './externs/Storage'
import { isEmpty } from '@/utils'

const UserInfoDomain = Remesh.domain({
  name: 'UserInfoDomain',
  impl: (domain) => {
    const storage = domain.getExtern(Storage)
    const storageKeys = {
      USER_INFO_ID: 'USER_INFO_ID',
      USER_INFO_NAME: 'USER_INFO_NAME',
      USER_INFO_AVATAR: 'USER_INFO_AVATAR',
      USER_INFO_DARK_MODE: 'USER_INFO_DARK_MODE'
    } as const

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

    const SetUserInfoCommand = domain.command({
      name: 'UserInfo.SetUserInfoCommand',
      impl: (_, userInfo: UserInfo | null) => {
        return [UserInfoState().new(userInfo), ChangeUserInfoEvent()]
      }
    })

    const ChangeUserInfoEvent = domain.event({
      name: 'UserInfo.ChangeUserInfoEvent',
      impl: ({ get }) => {
        return get(UserInfoQuery())
      }
    })

    domain.effect({
      name: 'FormStorageToStateEffect',
      impl: () => {
        return forkJoin({
          id: from(storage.get<UserInfo['id']>(storageKeys.USER_INFO_ID)),
          name: from(storage.get<UserInfo['name']>(storageKeys.USER_INFO_NAME)),
          avatar: from(storage.get<UserInfo['avatar']>(storageKeys.USER_INFO_AVATAR)),
          darkMode: from(storage.get<UserInfo['darkMode']>(storageKeys.USER_INFO_DARK_MODE))
        }).pipe(
          map((userInfo) => {
            if (
              !isEmpty(userInfo.id) &&
              !isEmpty(userInfo.name) &&
              !isEmpty(userInfo.avatar) &&
              !isEmpty(userInfo.darkMode)
            ) {
              return SetUserInfoCommand(userInfo as UserInfo)
            } else {
              return SetUserInfoCommand(null)
            }
          })
        )
      }
    })

    domain.effect({
      name: 'FormStateToStorageEffect',
      impl: ({ fromEvent }) => {
        const changeUserInfo$ = fromEvent(ChangeUserInfoEvent).pipe(
          tap(async (userInfo) => {
            return await Promise.all([
              storage.set<UserInfo['id'] | null>(storageKeys.USER_INFO_ID, userInfo?.id ?? null),
              storage.set<UserInfo['name'] | null>(storageKeys.USER_INFO_NAME, userInfo?.name ?? null),
              storage.set<UserInfo['avatar'] | null>(storageKeys.USER_INFO_AVATAR, userInfo?.avatar ?? null),
              storage.set<UserInfo['darkMode'] | null>(storageKeys.USER_INFO_DARK_MODE, userInfo?.darkMode ?? null)
            ])
          })
        )

        return merge(changeUserInfo$).pipe(map(() => null))
      }
    })

    return {
      query: {
        UserInfoQuery
      },
      command: {
        SetUserInfoCommand
      },
      event: {
        ChangeUserInfoEvent
      }
    }
  }
})

export default UserInfoDomain
