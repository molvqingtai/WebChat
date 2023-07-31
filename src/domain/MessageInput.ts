import { Remesh } from 'remesh'
import InputModule from './modules/Input'

const MessageInputDomain = Remesh.domain({
  name: 'MessageInputDomain',
  impl: (domain) => {
    const inputModule = InputModule(domain, {
      name: 'MessageInput'
    })

    const PreviewState = domain.state({
      name: 'PreviewState',
      default: false
    })

    const PreviewQuery = domain.query({
      name: 'PreviewQuery',
      impl: ({ get }) => {
        return get(PreviewState())
      }
    })

    const PreviewCommand = domain.command({
      name: 'PreviewCommand',
      impl: (_, value: boolean) => {
        return PreviewState().new(value)
      }
    })

    const EnterEvent = domain.event({
      name: 'EnterEvent'
    })

    const EnterCommand = domain.command({
      name: 'EnterCommand',
      impl: () => {
        return EnterEvent()
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
