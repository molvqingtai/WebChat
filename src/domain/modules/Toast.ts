import { type RemeshDomainContext, type DomainConceptName } from 'remesh'
import { ToastExtern } from '../externs/Toast'

export interface ToastOptions {
  name: DomainConceptName<'ToastModule'>
}

const ToastModule = (domain: RemeshDomainContext, options: ToastOptions = { name: 'MessageToastModule' }) => {
  const toast = domain.getExtern(ToastExtern)

  const SuccessEvent = domain.event({
    name: `${options.name}.SuccessEvent`
  })

  const SuccessCommand = domain.command({
    name: `${options.name}.SuccessCommand`,
    impl: (_, message: string) => {
      toast.success(message)
      return [SuccessEvent()]
    }
  })

  const ErrorEvent = domain.event({
    name: `${options.name}.ErrorEvent`
  })

  const ErrorCommand = domain.command({
    name: `${options.name}.ErrorCommand`,
    impl: (_, message: string) => {
      toast.error(message)
      return [ErrorEvent()]
    }
  })

  const InfoEvent = domain.event({
    name: `${options.name}.InfoEvent`
  })

  const InfoCommand = domain.command({
    name: `${options.name}.InfoCommand`,
    impl: (_, message: string) => {
      toast.info(message)
      return [InfoEvent()]
    }
  })

  const WarningEvent = domain.event({
    name: `${options.name}.WarningEvent`
  })

  const WarningCommand = domain.command({
    name: `${options.name}.WarningCommand`,
    impl: (_, message: string) => {
      toast.warning(message)
      return [WarningEvent()]
    }
  })

  return {
    event: {
      SuccessEvent,
      ErrorEvent,
      InfoEvent,
      WarningEvent
    },
    command: {
      SuccessCommand,
      ErrorCommand,
      InfoCommand,
      WarningCommand
    }
  }
}

export default ToastModule
