import { Remesh } from 'remesh'
import { DanmakuExtern } from './externs/Danmaku'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from './UserInfo'
import { map, merge } from 'rxjs'

const DanmakuDomain = Remesh.domain({
  name: 'DanmakuDomain',
  impl: (domain) => {
    const danmakuExtern = domain.getExtern(DanmakuExtern)
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())

    const IsEnabledQuery = domain.query({
      name: 'Danmaku.IsEnabledQuery',
      impl: ({ get }) => get(userInfoDomain.query.UserInfoQuery())?.danmakuEnabled ?? false
    })

    const MountCommand = domain.command({
      name: 'Danmaku.MountCommand',
      impl: (_, { container, onOpen }: { container: HTMLElement; onOpen: () => void }) => {
        danmakuExtern.mount(container, onOpen)
        return null
      }
    })

    const UnmountCommand = domain.command({
      name: 'Danmaku.UnmountCommand',
      impl: () => {
        danmakuExtern.unmount()
        return null
      }
    })

    domain.effect({
      name: 'Danmaku.OnRoomMessageEffect',
      impl: ({ fromEvent, get }) => {
        const sendTextMessage$ = fromEvent(chatRoomDomain.event.SendTextMessageEvent)
        const onTextMessage$ = fromEvent(chatRoomDomain.event.OnTextMessageEvent)

        const onMessage$ = merge(sendTextMessage$, onTextMessage$).pipe(
          map((message) => {
            const danmakuEnabled = get(IsEnabledQuery())
            if (danmakuEnabled) danmakuExtern.push(message)
            return null
          })
        )
        return onMessage$
      }
    })

    return {
      query: {
        IsEnabledQuery
      },
      command: {
        MountCommand,
        UnmountCommand
      }
    }
  }
})

export default DanmakuDomain
