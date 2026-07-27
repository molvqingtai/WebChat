import { Remesh } from 'remesh'

const MessageInputDomain = Remesh.domain({
  name: 'MessageInputDomain',
  impl: (domain) => {
    const ValueState = domain.state({ name: 'MessageInput.ValueState', default: '' })
    const FocusState = domain.state({ name: 'MessageInput.FocusState', default: false })
    const DisabledState = domain.state({ name: 'MessageInput.DisabledState', default: false })

    const ValueQuery = domain.query({ name: 'MessageInput.ValueQuery', impl: ({ get }) => get(ValueState()) })
    const MessageQuery = ValueQuery
    const FocusQuery = domain.query({ name: 'MessageInput.FocusQuery', impl: ({ get }) => get(FocusState()) })
    const DisabledQuery = domain.query({
      name: 'MessageInput.DisabledQuery',
      impl: ({ get }) => get(DisabledState())
    })

    const InputEvent = domain.event<string>({ name: 'MessageInput.InputEvent' })
    const ChangeEvent = domain.event<string>({ name: 'MessageInput.ChangeEvent' })
    const FocusEvent = domain.event({ name: 'MessageInput.FocusEvent' })
    const BlurEvent = domain.event({ name: 'MessageInput.BlurEvent' })
    const EnterEvent = domain.event({ name: 'MessageInput.EnterEvent', impl: ({ get }) => get(ValueQuery()) })

    const InputCommand = domain.command({
      name: 'MessageInput.InputCommand',
      impl: (_, value: string) => [ValueState().new(value), InputEvent(value)]
    })
    const ChangeCommand = domain.command({
      name: 'MessageInput.ChangeCommand',
      impl: (_, value: string) => [ValueState().new(value), ChangeEvent(value)]
    })
    const BlurCommand = domain.command({
      name: 'MessageInput.BlurCommand',
      impl: () => [FocusState().new(false), BlurEvent()]
    })
    const FocusCommand = domain.command({
      name: 'MessageInput.FocusCommand',
      impl: () => [FocusState().new(true), FocusEvent()]
    })
    const DisabledCommand = domain.command({
      name: 'MessageInput.DisabledCommand',
      impl: (_, value: boolean) => DisabledState().new(value)
    })
    const EnterCommand = domain.command({ name: 'MessageInput.EnterCommand', impl: () => EnterEvent() })
    const ClearCommand = domain.command({ name: 'MessageInput.ClearCommand', impl: () => InputCommand('') })

    return {
      query: { MessageQuery, ValueQuery, FocusQuery, DisabledQuery },
      command: {
        InputCommand,
        ChangeCommand,
        BlurCommand,
        FocusCommand,
        DisabledCommand,
        EnterCommand,
        ClearCommand
      },
      event: { InputEvent, ChangeEvent, FocusEvent, BlurEvent, EnterEvent }
    }
  }
})

export default MessageInputDomain
