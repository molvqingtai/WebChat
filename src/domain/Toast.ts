import { Remesh } from 'remesh'
import ToastModule from './modules/Toast'
import ChatRoomDomain from './ChatRoom'
import WorldRoomDomain from './WorldRoom'
import { map, merge } from 'rxjs'

const ToastDomain = Remesh.domain({
  name: 'ToastDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const worldRoomDomain = domain.getDomain(WorldRoomDomain())
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
          fromEvent(worldRoomDomain.event.OnErrorEvent)
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
        const onSyncHistory$ = fromEvent(chatRoomDomain.event.OnSyncMessageEvent).pipe(
          map(() => toastModule.command.SuccessCommand('Syncing history messages.'))
        )

        return onSyncHistory$
      }
    })

    return toastModule
  }
})

export default ToastDomain
