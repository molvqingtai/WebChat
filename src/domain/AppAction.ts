import { Remesh } from 'remesh'
import { EMPTY, catchError, concatMap, defer } from 'rxjs'
import { AppActionExtern } from '@/domain/externs/AppAction'

const AppActionDomain = Remesh.domain({
  name: 'AppActionDomain',
  impl: (domain) => {
    const appAction = domain.getExtern(AppActionExtern)
    const OpenOptionsRequestedEvent = domain.event({ name: 'AppAction.OpenOptionsRequestedEvent' })
    const OpenOptionsCommand = domain.command({
      name: 'AppAction.OpenOptionsCommand',
      impl: () => OpenOptionsRequestedEvent()
    })

    domain.effect({
      name: 'AppAction.OpenOptionsEffect',
      impl: ({ fromEvent }) =>
        fromEvent(OpenOptionsRequestedEvent).pipe(
          concatMap(() =>
            defer(async () => {
              await appAction.openOptionsPage()
              return null
            }).pipe(catchError(() => EMPTY))
          )
        )
    })

    return { command: { OpenOptionsCommand } }
  }
})

export default AppActionDomain
