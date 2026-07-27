import { Remesh } from 'remesh'
import { filter, map } from 'rxjs'
import ChatRoomDomain from '@/domain/ChatRoom'
import ReadinessDomain from '@/domain/Readiness'
import ToastPresentationDomain, { type ToastDescriptor } from '@/domain/ToastPresentation'
import type { ReadinessState } from '@/domain/externs/Readiness'

const RUNTIME_TOAST_ID = 'webchat-runtime-readiness'
const requestToastId = (requestId: number) => `webchat-request-${requestId}`

const requestLoadingDescriptor = (requestId: number): ToastDescriptor => ({
  id: requestToastId(requestId),
  type: 'loading',
  message: 'Reconnecting to the chat...',
  dismissible: false,
  acknowledge: true,
  minimumVisibleMs: 300
})

const readinessDescriptor = (state: Exclude<ReadinessState, 'ready'>): ToastDescriptor => {
  if (state === 'connecting') {
    return {
      id: RUNTIME_TOAST_ID,
      type: 'loading',
      message: 'WebChat connecting',
      dismissible: false
    }
  }
  return {
    id: RUNTIME_TOAST_ID,
    type: 'error',
    message: 'WebChat unavailable'
  }
}

const AppFeedbackDomain = Remesh.domain({
  name: 'AppFeedbackDomain',
  impl: (domain) => {
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const readinessDomain = domain.getDomain(ReadinessDomain())
    const presentationDomain = domain.getDomain(ToastPresentationDomain())
    const readinessFeedbackCommand = (state: ReadinessState) =>
      state === 'ready'
        ? presentationDomain.command.DismissCommand(RUNTIME_TOAST_ID)
        : presentationDomain.command.PublishCommand(readinessDescriptor(state))

    domain.effect({
      name: 'AppFeedback.OnReadinessEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(readinessDomain.event.StateChangedEvent).pipe(
          map((state) => (get(presentationDomain.query.SurfaceMountedQuery()) ? readinessFeedbackCommand(state) : null))
        )
    })

    domain.effect({
      name: 'AppFeedback.OnRequestStartedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.ReconnectStartedEvent).pipe(
          map((id) => {
            const cleanup = id > 1 ? [presentationDomain.command.DismissCommand(requestToastId(id - 1))] : []
            if (!get(presentationDomain.query.SurfaceMountedQuery())) {
              return [...cleanup, chatRoomDomain.command.OmitToastCommand(id)]
            }
            return [
              ...cleanup,
              chatRoomDomain.command.BeginToastCommand(id),
              presentationDomain.command.PublishCommand(requestLoadingDescriptor(id))
            ]
          })
        )
    })

    domain.effect({
      name: 'AppFeedback.OnSurfaceMountedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(presentationDomain.event.SurfaceChangedEvent).pipe(
          filter(Boolean),
          map(() => {
            const readiness = readinessFeedbackCommand(get(readinessDomain.query.StateQuery()))
            const request = get(chatRoomDomain.query.ReconnectRequestQuery())
            return request && !request.toast.attempted
              ? [
                  readiness,
                  chatRoomDomain.command.BeginToastCommand(request.id),
                  presentationDomain.command.PublishCommand(requestLoadingDescriptor(request.id))
                ]
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
            if (!request || requestToastId(request.id) !== id) return null
            return status === 'presented'
              ? chatRoomDomain.command.SettleToastCommand(request.id)
              : chatRoomDomain.command.OmitToastCommand(request.id)
          })
        )
    })

    domain.effect({
      name: 'AppFeedback.OnRequestFinishedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.ReconnectFinishedEvent).pipe(
          map(({ id, error }) => {
            const toastId = requestToastId(id)
            if (!get(presentationDomain.query.SurfaceMountedQuery())) {
              return presentationDomain.command.DismissCommand(toastId)
            }
            return presentationDomain.command.PublishCommand({
              id: toastId,
              type: error ? 'error' : 'success',
              message: error?.message ?? 'Ready to chat'
            })
          })
        )
    })

    return {}
  }
})

export default AppFeedbackDomain
