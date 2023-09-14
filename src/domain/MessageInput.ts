import { Remesh } from 'remesh'
import InputModule from './modules/Input'

export const MESSAGE_INPUT_STORAGE_KEY = 'MESSAGE_INPUT'

const MessageInputDomain = Remesh.domain({
  name: 'MessageInputDomain',
  impl: (domain) => {
    const MessageInputModule = InputModule(domain, {
      name: 'MessageInputModule'
    })

    const MessageQuery = MessageInputModule.query.ValueQuery

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
        ClearCommand
      },
      event: {
        ...MessageInputModule.event
      }
    }
  }
})

export default MessageInputDomain
