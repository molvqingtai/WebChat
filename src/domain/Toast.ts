import { Remesh } from 'remesh'
import ToastModule from './modules/Toast'
import RoomDomain, { SendType } from './Room'
import { filter, map } from 'rxjs'

const ToastDomain = Remesh.domain({
  name: 'ToastDomain',
  impl: (domain) => {
    const roomDomain = domain.getDomain(RoomDomain())
    const toastModule = ToastModule(domain)

    domain.effect({
      name: 'Toast.OnRoomSelfJoinRoomEffect',
      impl: ({ fromEvent }) => {
        const onRoomJoin$ = fromEvent(roomDomain.event.SelfJoinRoomEvent).pipe(
          map(() => toastModule.command.LoadingCommand('Connected to the chat.'))
        )

        return onRoomJoin$
      }
    })

    domain.effect({
      name: 'Toast.OnRoomErrorEffect',
      impl: ({ fromEvent }) => {
        const onRoomError$ = fromEvent(roomDomain.event.OnErrorEvent).pipe(
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
        const onSyncHistory$ = fromEvent(roomDomain.event.OnMessageEvent).pipe(
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
