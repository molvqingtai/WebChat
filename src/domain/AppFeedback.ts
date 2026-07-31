import { Remesh } from 'remesh'
import { filter, map } from 'rxjs'
import ChatRoomDomain from '@/domain/ChatRoom'
import ReadinessDomain from '@/domain/Readiness'
import ToastPresentationDomain, { type ToastDescriptor } from '@/domain/ToastPresentation'
import type { ReadinessState } from '@/domain/externs/Readiness'

const RUNTIME_TOAST_ID = 'webchat-runtime-readiness'

const readinessDescriptor = (state: Exclude<ReadinessState, 'ready'>): ToastDescriptor => {
  if (state === 'connecting') {
    return {
      id: RUNTIME_TOAST_ID,
      type: 'loading',
      message: 'Connected to the chat.',
      dismissible: false,
      acknowledge: true,
      minimumVisibleMs: 300
    }
  }
  return {
    id: RUNTIME_TOAST_ID,
    type: 'error',
    message: 'Connection failed'
  }
}

const AppFeedbackDomain = Remesh.domain({
  name: 'AppFeedbackDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const readinessDomain = domain.getDomain(ReadinessDomain())
    const presentationDomain = domain.getDomain(ToastPresentationDomain())
    const RuntimeDescriptorTypeState = domain.state<ToastDescriptor['type'] | null>({
      name: 'AppFeedback.RuntimeDescriptorTypeState',
      default: null
    })
    const RuntimeFeedbackQuery = domain.query({
      name: 'AppFeedback.RuntimeFeedbackQuery',
      impl: ({ get }) =>
        get(chatRoomDomain.query.ConnectionIsLoadingQuery()) ? 'connecting' : get(readinessDomain.query.StateQuery())
    })
    const PublishRuntimeFeedbackCommand = domain.command({
      name: 'AppFeedback.PublishRuntimeFeedbackCommand',
      impl: (_, state: Exclude<ReadinessState, 'ready'>) => {
        const descriptor = readinessDescriptor(state)
        return [
          RuntimeDescriptorTypeState().new(descriptor.type),
          presentationDomain.command.PublishCommand(descriptor)
        ]
      }
    })
    const DismissRuntimeLoadingCommand = domain.command({
      name: 'AppFeedback.DismissRuntimeLoadingCommand',
      impl: ({ get }) =>
        get(RuntimeDescriptorTypeState()) === 'loading'
          ? [RuntimeDescriptorTypeState().new(null), presentationDomain.command.DismissCommand(RUNTIME_TOAST_ID)]
          : null
    })
    const runtimeFeedbackCommand = (state: ReadinessState) =>
      state === 'ready' ? DismissRuntimeLoadingCommand() : PublishRuntimeFeedbackCommand(state)

    domain.effect({
      name: 'AppFeedback.OnRuntimeFeedbackEffect',
      impl: ({ fromQuery, get }) =>
        fromQuery(RuntimeFeedbackQuery()).pipe(
          map((state) => (get(presentationDomain.query.SurfaceMountedQuery()) ? runtimeFeedbackCommand(state) : null))
        )
    })

    domain.effect({
      name: 'AppFeedback.OnRequestStartedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.ReconnectStartedEvent).pipe(
          map((id) =>
            get(presentationDomain.query.SurfaceMountedQuery())
              ? chatRoomDomain.command.BeginToastCommand(id)
              : chatRoomDomain.command.OmitToastCommand(id)
          )
        )
    })

    domain.effect({
      name: 'AppFeedback.OnSurfaceMountedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(presentationDomain.event.SurfaceChangedEvent).pipe(
          filter(Boolean),
          map(() => {
            const readiness = runtimeFeedbackCommand(get(RuntimeFeedbackQuery()))
            const request = get(chatRoomDomain.query.ReconnectRequestQuery())
            return request && !request.toast.attempted
              ? [chatRoomDomain.command.BeginToastCommand(request.id), readiness]
              : readiness
          })
        )
    })

    domain.effect({
      name: 'AppFeedback.OnAcknowledgedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(presentationDomain.event.AcknowledgedEvent).pipe(
          map(({ id, status }) => {
            const request = get(chatRoomDomain.query.ReconnectRequestQuery())
            if (!request || id !== RUNTIME_TOAST_ID) return null
            return status === 'presented'
              ? chatRoomDomain.command.SettleToastCommand(request.id)
              : chatRoomDomain.command.OmitToastCommand(request.id)
          })
        )
    })

    domain.effect({
      name: 'AppFeedback.OnConnectionFinishedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.ReconnectFinishedEvent).pipe(
          map(({ error }) => {
            if (!error || get(RuntimeFeedbackQuery()) !== 'ready') return null
            if (!get(presentationDomain.query.SurfaceMountedQuery())) {
              return DismissRuntimeLoadingCommand()
            }
            return PublishRuntimeFeedbackCommand('unavailable')
          })
        )
    })

    return {}
  }
})

export default AppFeedbackDomain
