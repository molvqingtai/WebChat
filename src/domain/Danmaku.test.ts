import { describe, expect, it } from 'vitest'
import { Remesh } from 'remesh'
import DanmakuDomain from '@/domain/Danmaku'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'

const USER_INFO: UserInfo = {
  id: 'local-user',
  name: 'Local',
  avatar: '',
  createTime: 1,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'all'
}

describe('DanmakuDomain consumer surface', () => {
  it('exposes only the query and commands used by App', () => {
    const store = Remesh.store()
    const danmaku = store.getDomain(DanmakuDomain())

    expect(Object.keys(danmaku).sort()).toEqual(['command', 'query'])
    expect(Object.keys(danmaku.query)).toEqual(['IsEnabledQuery'])
    expect(Object.keys(danmaku.command).sort()).toEqual(['MountCommand', 'UnmountCommand'])

    store.discard()
  })

  it('projects the current UserInfo setting without copying it into Danmaku state', () => {
    const store = Remesh.store()
    const danmaku = store.getDomain(DanmakuDomain())
    const userInfo = store.getDomain(UserInfoDomain())

    store.send(userInfo.command.UpdateUserInfoCommand(USER_INFO))
    expect(store.query(danmaku.query.IsEnabledQuery())).toBe(true)

    store.send(userInfo.command.UpdateUserInfoCommand({ ...USER_INFO, danmakuEnabled: false }))
    expect(store.query(danmaku.query.IsEnabledQuery())).toBe(false)

    store.discard()
  })
})
