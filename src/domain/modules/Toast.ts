import { type RemeshDomainContext, type DomainConceptName } from 'remesh'
import { ToastExtern } from '../externs/Toast'

export interface ToastOptions {
  name: DomainConceptName<'ToastModule'>
}

const ToastModule = (domain: RemeshDomainContext, options: ToastOptions = { name: 'MessageToastModule' }) => {
  const toastExtern = domain.getExtern(ToastExtern)

  const SuccessEvent = domain.event<number | string>({
    name: `${options.name}.SuccessEvent`
  })

  const SuccessCommand = domain.command({
    name: `${options.name}.SuccessCommand`,
    impl: (_, message: string | { message: string; duration?: number }) => {
      const id = toastExtern.success(
        typeof message === 'string' ? message : message.message,
        typeof message === 'string' ? undefined : message.duration
      )
      return [SuccessEvent(id)]
    }
  })

  const ErrorEvent = domain.event<number | string>({
    name: `${options.name}.ErrorEvent`
  })

  const ErrorCommand = domain.command({
    name: `${options.name}.ErrorCommand`,
    impl: (_, message: string | { message: string; duration?: number }) => {
      const id = toastExtern.error(
        typeof message === 'string' ? message : message.message,
        typeof message === 'string' ? undefined : message.duration
      )
      return [ErrorEvent(id)]
    }
  })

  const InfoEvent = domain.event<number | string>({
    name: `${options.name}.InfoEvent`
  })

  const InfoCommand = domain.command({
    name: `${options.name}.InfoCommand`,
    impl: (_, message: string | { message: string; duration?: number }) => {
      const id = toastExtern.info(
        typeof message === 'string' ? message : message.message,
        typeof message === 'string' ? undefined : message.duration
      )
      return [InfoEvent(id)]
    }
  })

  const WarningEvent = domain.event<number | string>({
    name: `${options.name}.WarningEvent`
  })

  const WarningCommand = domain.command({
    name: `${options.name}.WarningCommand`,
    impl: (_, message: string | { message: string; duration?: number }) => {
      const id = toastExtern.warning(
        typeof message === 'string' ? message : message.message,
        typeof message === 'string' ? undefined : message.duration
      )
      return [WarningEvent(id)]
    }
  })

  const LoadingEvent = domain.event<number | string>({
    name: `${options.name}.LoadingEvent`
  })

  const LoadingCommand = domain.command({
    name: `${options.name}.LoadingCommand`,
    impl: (_, message: string | { message: string; duration?: number }) => {
      const id = toastExtern.loading(
        typeof message === 'string' ? message : message.message,
        typeof message === 'string' ? undefined : message.duration
      )
      return [LoadingEvent(id)]
    }
  })

  const CancelEvent = domain.event<number | string>({
    name: `${options.name}.CancelEvent`
  })

  const CancelCommand = domain.command({
    name: `${options.name}.CancelCommand`,
    impl: (_, id: number | string) => {
      toastExtern.cancel(id)
      return [CancelEvent(id)]
    }
  })

  return {
    event: {
      SuccessEvent,
      ErrorEvent,
      InfoEvent,
      WarningEvent,
      LoadingEvent,
      CancelEvent
    },
    command: {
      SuccessCommand,
      ErrorCommand,
      InfoCommand,
      WarningCommand,
      LoadingCommand,
      CancelCommand
    }
  }
}

export default ToastModule
