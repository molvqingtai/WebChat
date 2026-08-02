import { Remesh } from 'remesh'
import { map } from 'rxjs'
import { ToastExtern } from '@/domain/externs/Toast'

type Feedback = { type: 'success' | 'warning' | 'error'; message: string }

const ProfileFeedbackDomain = Remesh.domain({
  name: 'ProfileFeedbackDomain',
  impl: (domain) => {
    const toast = domain.getExtern(ToastExtern)
    const NotifyEvent = domain.event<Feedback>({ name: 'ProfileFeedback.NotifyEvent' })
    const SuccessCommand = domain.command({
      name: 'ProfileFeedback.SuccessCommand',
      impl: (_, message: string) => NotifyEvent({ type: 'success', message })
    })
    const WarningCommand = domain.command({
      name: 'ProfileFeedback.WarningCommand',
      impl: (_, message: string) => NotifyEvent({ type: 'warning', message })
    })
    const ErrorCommand = domain.command({
      name: 'ProfileFeedback.ErrorCommand',
      impl: (_, message: string) => NotifyEvent({ type: 'error', message })
    })

    domain.effect({
      name: 'ProfileFeedback.NotifyEffect',
      impl: ({ fromEvent }) =>
        fromEvent(NotifyEvent).pipe(
          map(({ type, message }) => {
            toast[type](message)
            return null
          })
        )
    })

    return { command: { SuccessCommand, WarningCommand, ErrorCommand } }
  }
})

export default ProfileFeedbackDomain
