import { Remesh } from 'remesh'
import InputModule from './modules/Input'

const MessageInputDomain = Remesh.domain({
  name: 'MessageInputDomain',
  impl: (domain) => {
    const MessageInputModule = InputModule(domain, {
      name: 'MessageInputModule'
    })

    const MessageQuery = MessageInputModule.query.ValueQuery

    const EnterEvent = domain.event({
      name: 'MessageInput.EnterEvent',
      impl: ({ get }) => {
        return get(MessageInputModule.query.ValueQuery())
      }
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
        return MessageInputModule.command.InputCommand('')
      }
    })

    return {
      query: {
        MessageQuery
      },
      command: {
        ...MessageInputModule.command,
        EnterCommand,
        ClearCommand
      },
      event: {
        ...MessageInputModule.event,
        EnterEvent
      }
    }
  }
})

export default MessageInputDomain
