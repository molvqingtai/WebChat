import { Remesh } from 'remesh'
import { map } from 'rxjs'
import AppStatusDomain from '@/domain/AppStatus'
import ChatRoomDomain from '@/domain/ChatRoom'
import ReadinessDomain from '@/domain/Readiness'
import ToastDomain from '@/domain/Toast'
import type { ReadinessState } from '@/domain/externs/Readiness'

const RUNTIME_TOAST_ID = 'webchat-runtime-readiness'

const AppFeedbackDomain = Remesh.domain({
  name: 'AppFeedbackDomain',
  impl: (domain) => {
    const appStatusDomain = domain.getDomain(AppStatusDomain())
    const chatRoomDomain = domain.getDomain(ChatRoomDomain())
    const readinessDomain = domain.getDomain(ReadinessDomain())
    const toastDomain = domain.getDomain(ToastDomain())
    const RuntimeToastTypeState = domain.state<'loading' | 'error' | null>({
      name: 'AppFeedback.RuntimeToastTypeState',
      default: null
    })
    const RuntimeFeedbackQuery = domain.query({
      name: 'AppFeedback.RuntimeFeedbackQuery',
      impl: ({ get }): ReadinessState | null => {
        if (!get(appStatusDomain.query.ReadyQuery())) return null
        return get(chatRoomDomain.query.ConnectionIsLoadingQuery())
          ? 'connecting'
          : get(readinessDomain.query.StateQuery())
      }
    })
    const PublishRuntimeFeedbackCommand = domain.command({
      name: 'AppFeedback.PublishRuntimeFeedbackCommand',
      impl: ({ get }, input: { state: Exclude<ReadinessState, 'ready'>; message?: string }) =>
        input.state === 'unavailable' && input.message === undefined && get(RuntimeToastTypeState()) === 'error'
          ? null
          : input.state === 'connecting'
            ? [
                RuntimeToastTypeState().new('loading'),
                toastDomain.command.LoadingCommand({
                  id: RUNTIME_TOAST_ID,
                  message: 'Connected to the chat.',
                  dismissible: false
                })
              ]
            : [
                RuntimeToastTypeState().new('error'),
                toastDomain.command.ErrorCommand({
                  id: RUNTIME_TOAST_ID,
                  message: input.message ?? 'Connection failed'
                })
              ]
    })
    const DismissRuntimeLoadingCommand = domain.command({
      name: 'AppFeedback.DismissRuntimeLoadingCommand',
      impl: ({ get }) =>
        get(RuntimeToastTypeState()) === 'loading'
          ? [RuntimeToastTypeState().new(null), toastDomain.command.CancelCommand(RUNTIME_TOAST_ID)]
          : null
    })
    const runtimeFeedbackCommand = (state: ReadinessState | null) =>
      state === null
        ? null
        : state === 'ready'
          ? DismissRuntimeLoadingCommand()
          : PublishRuntimeFeedbackCommand({ state })

    domain.effect({
      name: 'AppFeedback.OnRuntimeFeedbackEffect',
      impl: ({ fromQuery }) => fromQuery(RuntimeFeedbackQuery()).pipe(map(runtimeFeedbackCommand))
    })

    domain.effect({
      name: 'AppFeedback.OnConnectionFinishedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(chatRoomDomain.event.ReconnectFinishedEvent).pipe(
          map(({ error }) =>
            error && get(RuntimeFeedbackQuery()) === 'ready'
              ? PublishRuntimeFeedbackCommand({ state: 'unavailable', message: error.message })
              : null
          )
        )
    })

    return {}
  }
})

export default AppFeedbackDomain
