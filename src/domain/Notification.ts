import { Remesh } from 'remesh'
import { NotificationExtern } from './externs/Notification'
import ChatRoomDomain, { TextMessage } from '@/domain/ChatRoom'
import UserInfoDomain from './UserInfo'
import { map, merge } from 'rxjs'

const NotificationDomain = Remesh.domain({
  name: 'NotificationDomain',
  impl: (domain) => {
    const notificationExtern = domain.getExtern(NotificationExtern)
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())

    const NotificationEnabledState = domain.state<boolean>({
      name: 'Notification.EnabledState',
      default: false
    })

    const IsEnabledQuery = domain.query({
      name: 'Notification.IsOpenQuery',
      impl: ({ get }) => {
        return get(NotificationEnabledState())
      }
    })

    const EnableCommand = domain.command({
      name: 'Notification.EnableCommand',
      impl: () => {
        return NotificationEnabledState().new(true)
      }
    })

    const DisableCommand = domain.command({
      name: 'Notification.DisableCommand',
      impl: () => {
        return NotificationEnabledState().new(false)
      }
    })

    const PushCommand = domain.command({
      name: 'Notification.PushCommand',
      impl: (_, message: TextMessage) => {
        notificationExtern.push(message)
        return [PushEvent(message)]
      }
    })

    const PushEvent = domain.event<TextMessage>({
      name: 'Notification.PushEvent'
    })

    const ClearEvent = domain.event<string>({
      name: 'Notification.ClearEvent'
    })

    domain.effect({
      name: 'Notification.OnUserInfoEffect',
      impl: ({ fromEvent }) => {
        const onUserInfo$ = fromEvent(userInfoDomain.event.UpdateUserInfoEvent)
        return onUserInfo$.pipe(
          map((userInfo) => {
            return userInfo?.notificationEnabled ? EnableCommand() : DisableCommand()
          })
        )
      }
    })

    domain.effect({
      name: 'Notification.OnRoomMessageEffect',
      impl: ({ fromEvent, get }) => {
        const onTextMessage$ = fromEvent(chatRoomDomain.event.OnTextMessageEvent)
        const onMessage$ = merge(onTextMessage$).pipe(
          map((message) => {
            const notificationEnabled = get(IsEnabledQuery())
            if (notificationEnabled) {
              // Compatible with old versions, without the atUsers field
              if (message.atUsers) {
                const userInfo = get(userInfoDomain.query.UserInfoQuery())
                const hasAtSelf = message.atUsers.find((user) => user.userId === userInfo?.id)
                if (userInfo?.notificationType === 'all') {
                  return PushCommand(message)
                }
                if (userInfo?.notificationType === 'at' && hasAtSelf) {
                  return PushCommand(message)
                }
                return null
              } else {
                return PushCommand(message)
              }
            } else {
              return null
            }
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
        EnableCommand,
        DisableCommand,
        PushCommand
      },
      event: {
        PushEvent,
        ClearEvent
      }
    }
  }
})

export default NotificationDomain
