import { Remesh, type Capitalize, type RemeshDomainContext } from 'remesh'

export interface InputModuleOptions {
  name: Capitalize
  value?: string
  disabled?: boolean
}

const InputModule = (domain: RemeshDomainContext, options: InputModuleOptions) => {
  const ValueState = domain.state({
    name: `${options.name}.ValueState`,
    default: options.value ?? ''
  })

  const ValueQuery = domain.query({
    name: `${options.name}.ValueQuery`,
    impl: ({ get }) => {
      return get(ValueState())
    }
  })

  const InputEvent = domain.event<string>({
    name: `${options.name}.InputEvent`
  })

  const InputCommand = domain.command({
    name: `${options.name}.InputCommand`,
    impl: (_, value: string) => {
      InputEvent(value)
      return ValueState().new(value)
    }
  })

  const ChangeEvent = domain.event<string>({
    name: `${options.name}.ChangeEvent`
  })

  const ChangeCommand = domain.command({
    name: `${options.name}.ChangeCommand`,
    impl: (_, value: string) => {
      ChangeEvent(value)
      return ValueState().new(value)
    }
  })

  const FocusState = domain.state({
    name: `${options.name}.FocusState`,
    default: false
  })

  const FocusQuery = domain.query({
    name: `${options.name}.FocusQuery`,
    impl: ({ get }) => {
      return get(FocusState())
    }
  })

  const FocusEvent = domain.event<boolean>({
    name: `${options.name}.FocusEvent`
  })

  const BlurEvent = domain.event<boolean>({
    name: `${options.name}.BlurEvent`
  })

  const BlurCommand = domain.command({
    name: `${options.name}.BlurCommand`,
    impl: () => {
      BlurEvent(false)
      return FocusState().new(false)
    }
  })

  const FocusCommand = domain.command({
    name: `${options.name}.FocusCommand`,
    impl: () => {
      FocusEvent(true)
      return FocusState().new(true)
    }
  })

  const DisabledState = domain.state({
    name: `${options.name}.DisabledState`,
    default: options.disabled ?? false
  })

  const DisabledQuery = domain.query({
    name: `${options.name}.DisabledQuery`,
    impl: ({ get }) => {
      return get(DisabledState())
    }
  })

  const DisabledCommand = domain.command({
    name: `${options.name}.DisabledCommand`,
    impl: (_, value: boolean) => {
      return DisabledState().new(value)
    }
  })

  return Remesh.module({
    query: {
      ValueQuery,
      FocusQuery,
      DisabledQuery
    },
    command: {
      InputCommand,
      ChangeCommand,
      BlurCommand,
      FocusCommand,
      DisabledCommand
    },
    event: {
      InputEvent,
      ChangeEvent,
      FocusEvent,
      BlurEvent
    }
  })
}

export default InputModule
