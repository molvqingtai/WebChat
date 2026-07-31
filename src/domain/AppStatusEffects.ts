import { Remesh } from 'remesh'
import { map } from 'rxjs'
import AppStatusDomain from '@/domain/AppStatus'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'
import { MESSAGE_TYPE } from '@/protocol/ChatRoom'

const AppStatusEffectsDomain = Remesh.domain({
  name: 'AppStatusEffectsDomain',
  impl: (domain) => {
    const appStatusDomain = domain.getDomain(AppStatusDomain())
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())

    domain.effect({
      name: 'OnMessageEffect',
      impl: ({ fromEvent, get }) => {
        // Unread increments once per message: only the first atomic insert wins.
        // Self-sent messages never count (parity with the old inbound-only path).
        return fromEvent(chatRoomDomain.event.OnTextMessageEvent).pipe(
          map((message) => {
            const open = get(appStatusDomain.query.OpenQuery())
            const unread = get(appStatusDomain.query.UnreadQuery())
            const selfId = get(userInfoDomain.query.UserInfoQuery())?.id
            if (!open && message.type === MESSAGE_TYPE.TEXT && message.author.id !== selfId) {
              return appStatusDomain.command.UpdateUnreadCommand(unread + 1)
            }
            return null
          })
        )
      }
    })

    return {}
  }
})

export default AppStatusEffectsDomain
