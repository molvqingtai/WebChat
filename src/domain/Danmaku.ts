import { Remesh } from 'remesh'
import { DanmakuExtern } from './externs/Danmaku'
import ChatRoomDomain from '@/domain/ChatRoom'
import { map, merge } from 'rxjs'

const DanmakuDomain = Remesh.domain({
  name: 'DanmakuDomain',
  impl: (domain) => {
    const danmakuExtern = domain.getExtern(DanmakuExtern)
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    let danmakuIsMounted = false

    const MountCommand = domain.command({
      name: 'Danmaku.MountCommand',
      impl: (_, { container, onOpen }: { container: HTMLElement; onOpen: () => void }) => {
        if (danmakuIsMounted) return null
        danmakuExtern.mount(container, onOpen)
        danmakuIsMounted = true
        return null
      }
    })

    const UnmountCommand = domain.command({
      name: 'Danmaku.UnmountCommand',
      impl: () => {
        if (!danmakuIsMounted) return null
        danmakuExtern.unmount()
        danmakuIsMounted = false
        return null
      }
    })

    domain.effect({
      name: 'Danmaku.OnRoomMessageEffect',
      impl: ({ fromEvent }) => {
        const sendTextMessage$ = fromEvent(chatRoomDomain.event.SendTextMessageEvent)
        const onTextMessage$ = fromEvent(chatRoomDomain.event.OnTextMessageEvent)

        const onMessage$ = merge(sendTextMessage$, onTextMessage$).pipe(
          map((message) => {
            if (danmakuIsMounted) danmakuExtern.push(message)
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
