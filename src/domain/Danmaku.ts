import { Remesh } from 'remesh'
import { DanmakuExtern } from './externs/Danmaku'
import ChatRoomDomain, { TextMessage } from '@/domain/ChatRoom'
import UserInfoDomain from './UserInfo'
import { map, merge } from 'rxjs'

const DanmakuDomain = Remesh.domain({
  name: 'DanmakuDomain',
  impl: (domain) => {
    const danmakuExtern = domain.getExtern(DanmakuExtern)
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())

    const MountState = domain.state({
      name: 'Danmaku.MountState',
      default: false
    })
    const DanmakuEnabledState = domain.state<boolean>({
      name: 'Danmaku.EnabledState',
      default: false
    })

    const IsEnabledQuery = domain.query({
      name: 'Danmaku.IsOpenQuery',
      impl: ({ get }) => {
        return get(DanmakuEnabledState())
      }
    })

    const EnableCommand = domain.command({
      name: 'Danmaku.EnableCommand',
      impl: () => {
        return DanmakuEnabledState().new(true)
      }
    })

    const DisableCommand = domain.command({
      name: 'Danmaku.DisableCommand',
      impl: () => {
        return DanmakuEnabledState().new(false)
      }
    })

    const IsMountedQuery = domain.query({
      name: 'Danmaku.IsMountedQuery',
      impl: ({ get }) => get(MountState())
    })

    const PushCommand = domain.command({
      name: 'Danmaku.PushCommand',
      impl: (_, message: TextMessage) => {
        danmakuExtern.push(message)
        return [PushEvent(message)]
      }
    })

    const UnshiftCommand = domain.command({
      name: 'Danmaku.UnshiftCommand',
      impl: (_, message: TextMessage) => {
        danmakuExtern.unshift(message)
        return [UnshiftEvent(message)]
      }
    })

    const ClearCommand = domain.command({
      name: 'Danmaku.ClearCommand',
      impl: () => {
        danmakuExtern.clear()
        return [ClearEvent()]
      }
    })

    const MountCommand = domain.command({
      name: 'Danmaku.ClearCommand',
      impl: (_, container: HTMLElement) => {
        danmakuExtern.mount(container)
        return [MountEvent(container)]
      }
    })

    const UnmountCommand = domain.command({
      name: 'Danmaku.UnmountCommand',
      impl: () => {
        danmakuExtern.unmount()
        return [UnmountEvent()]
      }
    })

    const PushEvent = domain.event<TextMessage>({
      name: 'Danmaku.PushEvent'
    })

    const UnshiftEvent = domain.event<TextMessage>({
      name: 'Danmaku.UnshiftEvent'
    })

    const ClearEvent = domain.event({
      name: 'Danmaku.ClearEvent'
    })

    const MountEvent = domain.event<HTMLElement>({
      name: 'Danmaku.MountEvent'
    })

    const UnmountEvent = domain.event({
      name: 'Danmaku.UnmountEvent'
    })

    domain.effect({
      name: 'Danmaku.OnUserInfoEffect',
      impl: ({ fromEvent }) => {
        const onUserInfo$ = fromEvent(userInfoDomain.event.UpdateUserInfoEvent)
        return onUserInfo$.pipe(
          map((userInfo) => {
            return userInfo?.danmakuEnabled ? EnableCommand() : DisableCommand()
          })
        )
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
            return danmakuEnabled ? PushCommand(message) : null
          })
        )
        return onMessage$
      }
    })

    return {
      query: {
        IsMountedQuery,
        IsEnabledQuery
      },
      command: {
        EnableCommand,
        DisableCommand,
        PushCommand,
        UnshiftCommand,
        ClearCommand,
        MountCommand,
        UnmountCommand
      },
      event: {
        PushEvent,
        UnshiftEvent,
        ClearEvent,
        MountEvent,
        UnmountEvent
      }
    }
  }
})

export default DanmakuDomain
