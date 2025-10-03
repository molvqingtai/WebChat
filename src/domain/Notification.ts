import { Remesh } from 'remesh'
import { NotificationExtern } from './externs/Notification'
import type { ChatRoomTextMessage } from '@/protocol'
import ChatRoomDomain from '@/domain/ChatRoom'
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
      impl: (_, message: ChatRoomTextMessage) => {
        notificationExtern.push(message)
        return [PushEvent(message)]
      }
    })

    const PushEvent = domain.event<ChatRoomTextMessage>({
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

            if (!notificationEnabled) {
              return null
            }

            const userInfo = get(userInfoDomain.query.UserInfoQuery())
            if (message.userId === userInfo?.id) {
              return null
            }

            if (userInfo?.notificationType === 'all') {
              return PushCommand(message)
            }

            if (userInfo?.notificationType === 'at') {
              const hasAtSelf = message.atUsers.find((user) => user.userId === userInfo?.id)
              if (hasAtSelf) {
                return PushCommand(message)
              }
            }
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
