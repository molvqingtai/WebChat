import { Remesh } from 'remesh'
import { forkJoin, from, map, merge, switchMap, tap } from 'rxjs'
import { BrowserSyncStorageExtern } from './externs/Storage'
import { isNullish } from '@/utils'
import callbackToObservable from '@/utils/callbackToObservable'

const UserInfoDomain = Remesh.domain({
  name: 'UserInfoDomain',
  impl: (domain) => {
    const storage = domain.getExtern(BrowserSyncStorageExtern)
    const storageKeys = {
      USER_INFO_ID: 'USER_INFO_ID',
      USER_INFO_NAME: 'USER_INFO_NAME',
      USER_INFO_AVATAR: 'USER_INFO_AVATAR',
      USER_INFO_CREATE_TIME: 'USER_INFO_CREATE_TIME',
      USER_INFO_THEME_MODE: 'USER_INFO_THEME_MODE'
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

    const UpdateUserInfoCommand = domain.command({
      name: 'UserInfo.UpdateUserInfoCommand',
      impl: (_, userInfo: UserInfo | null) => {
        return [UserInfoState().new(userInfo), UpdateUserInfoEvent(userInfo), SyncToStorageEvent(userInfo)]
      }
    })

    const UpdateUserInfoEvent = domain.event<UserInfo | null>({
      name: 'UserInfo.UpdateUserInfoEvent'
    })

    const SyncToStorageEvent = domain.event<UserInfo | null>({
      name: 'UserInfo.SyncToStorageEvent'
    })

    const SyncToStateEvent = domain.event<UserInfo | null>({
      name: 'UserInfo.SyncToStateEvent'
    })

    const SyncToStateCommand = domain.command({
      name: 'UserInfo.SyncToStateCommand',
      impl: (_, userInfo: UserInfo | null) => {
        return [UserInfoState().new(userInfo), UpdateUserInfoEvent(userInfo), SyncToStateEvent(userInfo)]
      }
    })

    domain.effect({
      name: 'FormStorageToStateEffect',
      impl: () => {
        return forkJoin({
          id: from(storage.get<UserInfo['id']>(storageKeys.USER_INFO_ID)),
          name: from(storage.get<UserInfo['name']>(storageKeys.USER_INFO_NAME)),
          avatar: from(storage.get<UserInfo['avatar']>(storageKeys.USER_INFO_AVATAR)),
          createTime: from(storage.get<UserInfo['createTime']>(storageKeys.USER_INFO_CREATE_TIME)),
          themeMode: from(storage.get<UserInfo['themeMode']>(storageKeys.USER_INFO_THEME_MODE))
        }).pipe(
          map((userInfo) => {
            if (
              !isNullish(userInfo.id) &&
              !isNullish(userInfo.name) &&
              !isNullish(userInfo.avatar) &&
              !isNullish(userInfo.createTime) &&
              !isNullish(userInfo.themeMode)
            ) {
              return SyncToStateCommand(userInfo as UserInfo)
            } else {
              return SyncToStateCommand(null)
            }
          })
        )
      }
    })

    domain.effect({
      name: 'FormStateToStorageEffect',
      impl: ({ fromEvent }) => {
        const changeUserInfo$ = fromEvent(SyncToStorageEvent).pipe(
          tap(async (userInfo) => {
            return await Promise.all([
              storage.set<UserInfo['id'] | null>(storageKeys.USER_INFO_ID, userInfo?.id ?? null),
              storage.set<UserInfo['name'] | null>(storageKeys.USER_INFO_NAME, userInfo?.name ?? null),
              storage.set<UserInfo['avatar'] | null>(storageKeys.USER_INFO_AVATAR, userInfo?.avatar ?? null),
              storage.set<UserInfo['createTime'] | null>(
                storageKeys.USER_INFO_CREATE_TIME,
                userInfo?.createTime ?? null
              ),
              storage.set<UserInfo['themeMode'] | null>(storageKeys.USER_INFO_THEME_MODE, userInfo?.themeMode ?? null)
            ])
          })
        )
        return merge(changeUserInfo$).pipe(map(() => null))
      }
    })

    domain.effect({
      name: 'WatchStorageToStateEffect',
      impl: () => {
        return callbackToObservable(storage.watch, storage.unwatch).pipe(
          switchMap(() => {
            return forkJoin({
              id: from(storage.get<UserInfo['id']>(storageKeys.USER_INFO_ID)),
              name: from(storage.get<UserInfo['name']>(storageKeys.USER_INFO_NAME)),
              avatar: from(storage.get<UserInfo['avatar']>(storageKeys.USER_INFO_AVATAR)),
              createTime: from(storage.get<UserInfo['createTime']>(storageKeys.USER_INFO_CREATE_TIME)),
              themeMode: from(storage.get<UserInfo['themeMode']>(storageKeys.USER_INFO_THEME_MODE))
            }).pipe(
              map((userInfo) => {
                if (
                  !isNullish(userInfo.id) &&
                  !isNullish(userInfo.name) &&
                  !isNullish(userInfo.avatar) &&
                  !isNullish(userInfo.createTime) &&
                  !isNullish(userInfo.themeMode)
                ) {
                  return SyncToStateCommand(userInfo as UserInfo)
                } else {
                  return SyncToStateCommand(null)
                }
              })
            )
          })
        )
      }
    })

    return {
      query: {
        UserInfoQuery
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
