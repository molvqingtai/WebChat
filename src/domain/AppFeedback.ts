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
    const RuntimeLoadingState = domain.state<boolean>({
      name: 'AppFeedback.RuntimeLoadingState',
      default: false
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
    const PublishRuntimeLoadingCommand = domain.command({
      name: 'AppFeedback.PublishRuntimeLoadingCommand',
      impl: ({ get }) =>
        get(RuntimeLoadingState())
          ? null
          : [
              RuntimeLoadingState().new(true),
              toastDomain.command.LoadingCommand({
                id: RUNTIME_TOAST_ID,
                message: 'Connected to the chat.',
                dismissible: false
              })
            ]
    })
    const DismissRuntimeLoadingCommand = domain.command({
      name: 'AppFeedback.DismissRuntimeLoadingCommand',
      impl: ({ get }) =>
        get(RuntimeLoadingState())
          ? [RuntimeLoadingState().new(false), toastDomain.command.CancelCommand(RUNTIME_TOAST_ID)]
          : null
    })
    const runtimeFeedbackCommand = (feedback: ReadinessState | null) =>
      feedback === null ? null : feedback === 'ready' ? DismissRuntimeLoadingCommand() : PublishRuntimeLoadingCommand()

    domain.effect({
      name: 'AppFeedback.OnRuntimeFeedbackEffect',
      impl: ({ fromQuery }) => fromQuery(RuntimeFeedbackQuery()).pipe(map(runtimeFeedbackCommand))
    })

    return {}
  }
})

export default AppFeedbackDomain
