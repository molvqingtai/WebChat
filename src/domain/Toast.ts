import { Remesh } from 'remesh'
import { map, merge } from 'rxjs'
import ChatRoomDomain from '@/domain/ChatRoom'
import WorldRoomDomain from '@/domain/WorldRoom'
import { ToastExtern, type ToastOptions } from '@/domain/externs/Toast'

export type ToastMessage = string | ({ message: string } & ToastOptions)

const ToastDomain = Remesh.domain({
  name: 'ToastDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const worldRoomDomain = domain.getDomain(WorldRoomDomain())
    const toast = domain.getExtern(ToastExtern)

    const show = (
      method: (message: string, options?: ToastOptions | number) => number | string,
      input: ToastMessage
    ) => {
      if (typeof input === 'string') return method(input)
      const { message, ...options } = input
      return method(message, options)
    }

    const SuccessEvent = domain.event<number | string>({ name: 'Toast.SuccessEvent' })
    const ErrorEvent = domain.event<number | string>({ name: 'Toast.ErrorEvent' })
    const InfoEvent = domain.event<number | string>({ name: 'Toast.InfoEvent' })
    const WarningEvent = domain.event<number | string>({ name: 'Toast.WarningEvent' })
    const LoadingEvent = domain.event<number | string>({ name: 'Toast.LoadingEvent' })
    const CancelEvent = domain.event<number | string>({ name: 'Toast.CancelEvent' })

    const SuccessCommand = domain.command({
      name: 'Toast.SuccessCommand',
      impl: (_, message: ToastMessage) => SuccessEvent(show(toast.success, message))
    })
    const ErrorCommand = domain.command({
      name: 'Toast.ErrorCommand',
      impl: (_, message: ToastMessage) => ErrorEvent(show(toast.error, message))
    })
    const InfoCommand = domain.command({
      name: 'Toast.InfoCommand',
      impl: (_, message: ToastMessage) => InfoEvent(show(toast.info, message))
    })
    const WarningCommand = domain.command({
      name: 'Toast.WarningCommand',
      impl: (_, message: ToastMessage) => WarningEvent(show(toast.warning, message))
    })
    const LoadingCommand = domain.command({
      name: 'Toast.LoadingCommand',
      impl: (_, message: ToastMessage) => LoadingEvent(show(toast.loading, message))
    })
    const CancelCommand = domain.command({
      name: 'Toast.CancelCommand',
      impl: (_, id: number | string) => {
        toast.cancel(id)
        return CancelEvent(id)
      }
    })

    domain.effect({
      name: 'Toast.OnRoomErrorEffect',
      impl: ({ fromEvent }) =>
        merge(fromEvent(chatRoomDomain.event.OnErrorEvent), fromEvent(worldRoomDomain.event.OnErrorEvent)).pipe(
          map((error) => ErrorCommand(error.message))
        )
    })

    return {
      command: { SuccessCommand, ErrorCommand, InfoCommand, WarningCommand, LoadingCommand, CancelCommand },
      event: { SuccessEvent, ErrorEvent, InfoEvent, WarningEvent, LoadingEvent, CancelEvent }
    }
  }
})

export default ToastDomain
