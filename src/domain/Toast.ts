import { Remesh } from 'remesh'
import { map, merge } from 'rxjs'
import ChatRoomDomain from '@/domain/ChatRoom'
import WorldRoomDomain from '@/domain/WorldRoom'
import { ToastExtern } from '@/domain/externs/Toast'

const ToastDomain = Remesh.domain({
  name: 'ToastDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const worldRoomDomain = domain.getDomain(WorldRoomDomain())
    const toast = domain.getExtern(ToastExtern)
    const ReconnectLoadingState = domain.state<number | string | null>({
      name: 'Toast.ReconnectLoadingState',
      default: null
    })

    type Message = string | { message: string; duration?: number }
    const args = (input: Message): [string, number | undefined] =>
      typeof input === 'string' ? [input, undefined] : [input.message, input.duration]

    const SuccessEvent = domain.event<number | string>({ name: 'Toast.SuccessEvent' })
    const ErrorEvent = domain.event<number | string>({ name: 'Toast.ErrorEvent' })
    const InfoEvent = domain.event<number | string>({ name: 'Toast.InfoEvent' })
    const WarningEvent = domain.event<number | string>({ name: 'Toast.WarningEvent' })
    const LoadingEvent = domain.event<number | string>({ name: 'Toast.LoadingEvent' })
    const CancelEvent = domain.event<number | string>({ name: 'Toast.CancelEvent' })

    const SuccessCommand = domain.command({
      name: 'Toast.SuccessCommand',
      impl: (_, message: Message) => SuccessEvent(toast.success(...args(message)))
    })
    const ErrorCommand = domain.command({
      name: 'Toast.ErrorCommand',
      impl: (_, message: Message) => ErrorEvent(toast.error(...args(message)))
    })
    const InfoCommand = domain.command({
      name: 'Toast.InfoCommand',
      impl: (_, message: Message) => InfoEvent(toast.info(...args(message)))
    })
    const WarningCommand = domain.command({
      name: 'Toast.WarningCommand',
      impl: (_, message: Message) => WarningEvent(toast.warning(...args(message)))
    })
    const LoadingCommand = domain.command({
      name: 'Toast.LoadingCommand',
      impl: (_, message: Message) => LoadingEvent(toast.loading(...args(message)))
    })
    const CancelCommand = domain.command({
      name: 'Toast.CancelCommand',
      impl: (_, id: number | string) => {
        toast.cancel(id)
        return CancelEvent(id)
      }
    })

    const StartReconnectLoadingCommand = domain.command({
      name: 'Toast.StartReconnectLoadingCommand',
      impl: ({ get }) => {
        const current = get(ReconnectLoadingState())
        if (current !== null) toast.cancel(current)
        const id = toast.loading('Reconnecting to the chat...')
        return [...(current === null ? [] : [CancelEvent(current)]), ReconnectLoadingState().new(id), LoadingEvent(id)]
      }
    })

    const FinishReconnectLoadingCommand = domain.command({
      name: 'Toast.FinishReconnectLoadingCommand',
      impl: ({ get }) => {
        const id = get(ReconnectLoadingState())
        if (id === null) return null
        toast.cancel(id)
        return [ReconnectLoadingState().new(null), CancelEvent(id)]
      }
    })

    domain.effect({
      name: 'Toast.OnRoomReconnectStartedEffect',
      impl: ({ fromEvent }) =>
        fromEvent(chatRoomDomain.event.ReconnectStartedEvent).pipe(map(StartReconnectLoadingCommand))
    })

    domain.effect({
      name: 'Toast.OnRoomReconnectFinishedEffect',
      impl: ({ fromEvent }) =>
        fromEvent(chatRoomDomain.event.ReconnectFinishedEvent).pipe(map(FinishReconnectLoadingCommand))
    })

    domain.effect({
      name: 'Toast.OnRoomSelfJoinRoomEffect',
      impl: ({ fromEvent }) =>
        fromEvent(chatRoomDomain.event.SelfJoinRoomEvent).pipe(
          map(() => LoadingCommand({ message: 'Connected to the chat.', duration: 3000 }))
        )
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
