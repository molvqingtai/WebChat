import { Remesh } from 'remesh'
import { DanmakuExtern } from './externs/Danmaku'
import { TextMessage } from './Room'
import UserInfoDomain from './UserInfo'
import { map } from 'rxjs'

const DanmakuDomain = Remesh.domain({
  name: 'DanmakuDomain',
  impl: (domain) => {
    const danmaku = domain.getExtern(DanmakuExtern)
    const userInfoDomain = domain.getDomain(UserInfoDomain())

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
        danmaku.push(message)
        return [PushEvent(message)]
      }
    })

    const UnshiftCommand = domain.command({
      name: 'Danmaku.UnshiftCommand',
      impl: (_, message: TextMessage) => {
        danmaku.unshift(message)
        return [UnshiftEvent(message)]
      }
    })

    const ClearCommand = domain.command({
      name: 'Danmaku.ClearCommand',
      impl: () => {
        danmaku.clear()
        return [ClearEvent()]
      }
    })

    const MountCommand = domain.command({
      name: 'Danmaku.ClearCommand',
      impl: (_, container: HTMLElement) => {
        danmaku.mount(container)
        return [MountEvent(container)]
      }
    })

    const DestroyCommand = domain.command({
      name: 'Danmaku.DestroyCommand',
      impl: () => {
        danmaku.destroy()
        return [DestroyEvent()]
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

    const DestroyEvent = domain.event({
      name: 'Danmaku.DestroyEvent'
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
        DestroyCommand
      },
      event: {
        PushEvent,
        UnshiftEvent,
        ClearEvent,
        MountEvent,
        DestroyEvent
      }
    }
  }
})

export default DanmakuDomain