import { Remesh } from 'remesh'
import ToastModule from './modules/Toast'
import ChatRoomDomain, { SendType } from './ChatRoom'
import VirtualRoomDomain from './VirtualRoom'
import { filter, map, merge } from 'rxjs'

const ToastDomain = Remesh.domain({
  name: 'ToastDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const virtualRoomDomain = domain.getDomain(VirtualRoomDomain())
    const toastModule = ToastModule(domain)

    domain.effect({
      name: 'Toast.OnRoomSelfJoinRoomEffect',
      impl: ({ fromEvent }) => {
        const onRoomJoin$ = fromEvent(chatRoomDomain.event.SelfJoinRoomEvent).pipe(
          map(() => toastModule.command.LoadingCommand({ message: 'Connected to the chat.', duration: 3000 }))
        )

        return onRoomJoin$
      }
    })

    domain.effect({
      name: 'Toast.OnRoomErrorEffect',
      impl: ({ fromEvent }) => {
        const onRoomError$ = merge(
          fromEvent(chatRoomDomain.event.OnErrorEvent),
          fromEvent(virtualRoomDomain.event.OnErrorEvent)
        ).pipe(
          map((error) => {
            return toastModule.command.ErrorCommand(error.message)
          })
        )

        return onRoomError$
      }
    })

    domain.effect({
      name: 'Toast.OnSyncHistoryEffect',
      impl: ({ fromEvent }) => {
        const onSyncHistory$ = fromEvent(chatRoomDomain.event.OnMessageEvent).pipe(
          filter((message) => message.type === SendType.SyncHistory),
          map(() => toastModule.command.SuccessCommand('Syncing history messages.'))
        )

        return onSyncHistory$
      }
    })

    return toastModule
  }
})

export default ToastDomain
