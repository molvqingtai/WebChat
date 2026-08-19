import { Remesh } from 'remesh'
import { NotificationExtern } from './externs/Notification'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from './UserInfo'
import { map } from 'rxjs'

const NotificationDomain = Remesh.domain({
  name: 'NotificationDomain',
  impl: (domain) => {
    const notificationExtern = domain.getExtern(NotificationExtern)
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())

    domain.effect({
      name: 'Notification.OnRoomMessageEffect',
      impl: ({ fromEvent, get }) => {
        // The ChatRoom callback runs only in the tab whose atomic insert won.
        const onMessage$ = fromEvent(chatRoomDomain.event.OnTextMessageEvent).pipe(
          map((message) => {
            const userInfo = get(userInfoDomain.query.UserInfoQuery())
            if (!userInfo?.notificationEnabled || message.author.id === userInfo.id) {
              return null
            }

            if (userInfo.notificationType === 'at' && !message.mentions.some((user) => user.id === userInfo.id)) {
              return null
            }

            void notificationExtern.push(message).catch(() => {})
            return null
          })
        )

        return onMessage$
      }
    })

    return {}
  }
})

export default NotificationDomain
