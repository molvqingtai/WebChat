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
    // The Content composition owner silences this page's Runtime feedback while the document is
    // departing or suspended: a silenced page never publishes a new readiness loading entry (its lease
    // cleanup may change page-local readiness), and may only remove the presentation it already owns.
    const FeedbackSilencedState = domain.state<boolean>({
      name: 'AppFeedback.FeedbackSilencedState',
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
        get(FeedbackSilencedState()) || get(RuntimeLoadingState())
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

    const SilenceFeedbackCommand = domain.command({
      name: 'AppFeedback.SilenceFeedbackCommand',
      impl: ({ get }) =>
        get(FeedbackSilencedState())
          ? null
          : [
              FeedbackSilencedState().new(true),
              get(RuntimeLoadingState()) ? DismissRuntimeLoadingCommand() : null
            ].filter((action): action is NonNullable<typeof action> => action !== null)
    })
    const ResumeFeedbackCommand = domain.command({
      name: 'AppFeedback.ResumeFeedbackCommand',
      impl: ({ get }) => (get(FeedbackSilencedState()) ? FeedbackSilencedState().new(false) : null)
    })

    return {
      command: {
        SilenceFeedbackCommand,
        ResumeFeedbackCommand
      }
    }
  }
})

export default AppFeedbackDomain
