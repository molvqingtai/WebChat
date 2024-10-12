import { Remesh } from 'remesh'
import ToastModule from './modules/Toast'
import RoomDomain from './Room'
import { map, merge } from 'rxjs'

const ToastDomain = Remesh.domain({
  name: 'ToastDomain',
  impl: (domain) => {
    const roomDomain = domain.getDomain(RoomDomain())
    const toastModule = ToastModule(domain)
    domain.effect({
      name: 'Toast.OnRoomErrorEffect',
      impl: ({ fromEvent }) => {
        const onRoomError$ = fromEvent(roomDomain.event.OnErrorEvent)

        const onError$ = merge(onRoomError$).pipe(
          map((error) => {
            return toastModule.command.ErrorCommand(error.message)
          })
        )

        return onError$
      }
    })
    return toastModule
  }
})

export default ToastDomain
