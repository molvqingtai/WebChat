import { Remesh } from 'remesh'
import { DanmakuExtern } from './externs/Danmaku'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'
import { map, merge } from 'rxjs'

const DanmakuDomain = Remesh.domain({
  name: 'DanmakuDomain',
  impl: (domain) => {
    const danmakuExtern = domain.getExtern(DanmakuExtern)
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    let documentIsVisible: (() => boolean) | null = null

    const MountCommand = domain.command({
      name: 'Danmaku.MountCommand',
      impl: (
        _,
        {
          container,
          onOpen,
          documentIsVisible: getDocumentIsVisible
        }: {
          container: HTMLElement
          onOpen: () => void
          documentIsVisible: () => boolean
        }
      ) => {
        documentIsVisible = getDocumentIsVisible
        danmakuExtern.mount(container, onOpen)
        return null
      }
    })

    const UnmountCommand = domain.command({
      name: 'Danmaku.UnmountCommand',
      impl: () => {
        documentIsVisible = null
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
            const danmakuEnabled = get(userInfoDomain.query.UserInfoQuery())?.danmakuEnabled ?? false
            if (danmakuEnabled && documentIsVisible?.()) danmakuExtern.push(message)
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
