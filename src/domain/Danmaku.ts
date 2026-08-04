import { Remesh } from 'remesh'
import { DanmakuExtern } from './externs/Danmaku'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { map, merge } from 'rxjs'

interface DanmakuBinding {
  container: HTMLElement
  onOpen: () => void
  documentIsVisible: () => boolean
}

const DanmakuDomain = Remesh.domain({
  name: 'DanmakuDomain',
  impl: (domain) => {
    const danmakuExtern = domain.getExtern(DanmakuExtern)
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    let danmakuBinding: DanmakuBinding | null = null
    let danmakuIsMounted = false

    const isEligible = (userInfo: UserInfo | null) =>
      Boolean(danmakuBinding?.documentIsVisible() && userInfo?.danmakuEnabled)

    const reconcile = (eligible: boolean) => {
      if (eligible && !danmakuIsMounted) {
        danmakuExtern.mount(danmakuBinding!.container, danmakuBinding!.onOpen)
        danmakuIsMounted = true
      } else if (!eligible && danmakuIsMounted) {
        danmakuExtern.unmount()
        danmakuIsMounted = false
      }
      return eligible
    }

    const MountCommand = domain.command({
      name: 'Danmaku.MountCommand',
      impl: ({ get }, binding: DanmakuBinding) => {
        danmakuBinding = binding
        reconcile(isEligible(get(userInfoDomain.query.UserInfoQuery())))
        return null
      }
    })

    const UnmountCommand = domain.command({
      name: 'Danmaku.UnmountCommand',
      impl: () => {
        danmakuBinding = null
        reconcile(false)
        return null
      }
    })

    domain.effect({
      name: 'Danmaku.OnUserInfoEffect',
      impl: ({ fromEvent }) =>
        fromEvent(userInfoDomain.event.UpdateUserInfoEvent).pipe(
          map((userInfo) => {
            reconcile(isEligible(userInfo))
            return null
          })
        )
    })

    domain.effect({
      name: 'Danmaku.OnRoomMessageEffect',
      impl: ({ fromEvent, get }) => {
        const sendTextMessage$ = fromEvent(chatRoomDomain.event.SendTextMessageEvent)
        const onTextMessage$ = fromEvent(chatRoomDomain.event.OnTextMessageEvent)

        const onMessage$ = merge(sendTextMessage$, onTextMessage$).pipe(
          map((message) => {
            const userInfo = get(userInfoDomain.query.UserInfoQuery())
            if (reconcile(isEligible(userInfo))) danmakuExtern.push(message)
            return null
          })
        )
        return onMessage$
      }
    })

    return {
      command: {
        MountCommand,
        UnmountCommand
      }
    }
  }
})

export default DanmakuDomain
