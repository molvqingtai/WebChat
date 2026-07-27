import { Remesh } from 'remesh'

export type ToastDescriptor = Readonly<{
  id: string
  type: 'success' | 'error' | 'info' | 'warning' | 'loading'
  message: string
  duration?: number
  dismissible?: boolean
  acknowledge?: boolean
  minimumVisibleMs?: number
}>

export type ToastPresentationAcknowledgement = Readonly<{
  id: string
  status: 'presented' | 'unavailable'
}>

const ToastPresentationDomain = Remesh.domain({
  name: 'ToastPresentationDomain',
  impl: (domain) => {
    const SurfaceMountedState = domain.state({ name: 'ToastPresentation.SurfaceMountedState', default: false })
    const SurfaceMountedQuery = domain.query({
      name: 'ToastPresentation.SurfaceMountedQuery',
      impl: ({ get }) => get(SurfaceMountedState())
    })
    const SurfaceChangedEvent = domain.event<boolean>({ name: 'ToastPresentation.SurfaceChangedEvent' })
    const DescriptorEvent = domain.event<ToastDescriptor>({ name: 'ToastPresentation.DescriptorEvent' })
    const DismissEvent = domain.event<string>({ name: 'ToastPresentation.DismissEvent' })
    const AcknowledgedEvent = domain.event<ToastPresentationAcknowledgement>({
      name: 'ToastPresentation.AcknowledgedEvent'
    })

    const SetSurfaceMountedCommand = domain.command({
      name: 'ToastPresentation.SetSurfaceMountedCommand',
      impl: ({ get }, mounted: boolean) =>
        get(SurfaceMountedQuery()) === mounted
          ? null
          : [SurfaceMountedState().new(mounted), SurfaceChangedEvent(mounted)]
    })
    const PublishCommand = domain.command({
      name: 'ToastPresentation.PublishCommand',
      impl: (_, descriptor: ToastDescriptor) => DescriptorEvent(descriptor)
    })
    const DismissCommand = domain.command({
      name: 'ToastPresentation.DismissCommand',
      impl: (_, id: string) => DismissEvent(id)
    })
    const AcknowledgeCommand = domain.command({
      name: 'ToastPresentation.AcknowledgeCommand',
      impl: (_, acknowledgement: ToastPresentationAcknowledgement) => AcknowledgedEvent(acknowledgement)
    })

    return {
      query: { SurfaceMountedQuery },
      command: { SetSurfaceMountedCommand, PublishCommand, DismissCommand, AcknowledgeCommand },
      event: { SurfaceChangedEvent, DescriptorEvent, DismissEvent, AcknowledgedEvent }
    }
  }
})

export default ToastPresentationDomain
