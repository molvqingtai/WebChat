import { Remesh } from 'remesh'
import InputModule from './modules/Input'

const MessageInputDomain = Remesh.domain({
  name: 'MessageInputDomain',
  impl: (domain) => {
    const inputModule = InputModule(domain, {
      name: 'MessageInput'
    })

    const PreviewState = domain.state({
      name: 'MessageInput.PreviewState',
      default: false
    })

    const PreviewQuery = domain.query({
      name: 'MessageInput.PreviewQuery',
      impl: ({ get }) => {
        return get(PreviewState())
      }
    })

    const PreviewCommand = domain.command({
      name: 'MessageInput.PreviewCommand',
      impl: (_, value: boolean) => {
        return PreviewState().new(value)
      }
    })

    const EnterEvent = domain.event({
      name: 'MessageInput.EnterEvent'
    })

    const EnterCommand = domain.command({
      name: 'MessageInput.EnterCommand',
      impl: () => {
        return EnterEvent()
      }
    })

    const ClearCommand = domain.command({
      name: 'MessageInput.ClearCommand',
      impl: () => {
        return inputModule.command.InputCommand('')
      }
    })

    return {
      query: {
        ...inputModule.query,
        PreviewQuery
      },
      command: {
        ...inputModule.command,
        EnterCommand,
        ClearCommand,
        PreviewCommand
      },
      event: {
        ...inputModule.event,
        EnterEvent
      }
    }
  }
})

export default MessageInputDomain
