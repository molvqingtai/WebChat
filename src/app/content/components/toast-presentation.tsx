import { useCallback, useEffect, useRef } from 'react'
import { useRemeshDomain, useRemeshEvent, useRemeshSend } from 'remesh-react'
import { toast } from 'sonner'
import ToastPresentationDomain, { type ToastDescriptor } from '@/domain/ToastPresentation'

const PRESENTATION_TIMEOUT_MS = 1000

const observeVisibleDwell = (
  toaster: HTMLElement,
  descriptor: ToastDescriptor,
  onPresented: () => void,
  onUnavailable: () => void
) => {
  let frame: number | null = null
  let timeout: ReturnType<typeof setTimeout>
  let eligibleFrames = 0
  let visibleSince: number | null = null
  let painted = false
  let settled = false

  const finish = (callback: () => void) => {
    if (settled) return
    settled = true
    if (frame !== null) cancelAnimationFrame(frame)
    clearTimeout(timeout)
    callback()
  }

  const observe = () => {
    const item = [...toaster.querySelectorAll<HTMLElement>('[data-testid]')].find(
      (element) => element.getAttribute('data-testid') === descriptor.id
    )
    const opacity = item ? Number.parseFloat(getComputedStyle(item).opacity || '1') : 0
    const eligible =
      item?.getAttribute('data-mounted') === 'true' &&
      item.getAttribute('data-visible') === 'true' &&
      item.getAttribute('data-removed') !== 'true' &&
      Number.isFinite(opacity) &&
      opacity > 0

    if (eligible) {
      eligibleFrames += 1
      visibleSince ??= Date.now()
      if (!painted) {
        painted = true
        clearTimeout(timeout)
        timeout = setTimeout(() => finish(onUnavailable), PRESENTATION_TIMEOUT_MS + (descriptor.minimumVisibleMs ?? 0))
      }
    } else {
      if (visibleSince !== null) showDescriptor(descriptor)
      eligibleFrames = 0
      visibleSince = null
    }

    if (
      eligibleFrames >= 3 &&
      visibleSince !== null &&
      Date.now() - visibleSince >= (descriptor.minimumVisibleMs ?? 0)
    ) {
      finish(onPresented)
      return
    }
    frame = requestAnimationFrame(observe)
  }

  timeout = setTimeout(() => finish(onUnavailable), PRESENTATION_TIMEOUT_MS)
  frame = requestAnimationFrame(observe)

  return () => {
    settled = true
    if (frame !== null) cancelAnimationFrame(frame)
    clearTimeout(timeout)
  }
}

const showDescriptor = (descriptor: ToastDescriptor) => {
  const options = {
    id: descriptor.id,
    testId: descriptor.id,
    duration: descriptor.duration,
    dismissible: descriptor.dismissible
  }
  switch (descriptor.type) {
    case 'success':
      return toast.success(descriptor.message, options)
    case 'error':
      return toast.error(descriptor.message, options)
    case 'info':
      return toast.info(descriptor.message, options)
    case 'warning':
      return toast.warning(descriptor.message, options)
    case 'loading':
      return toast.loading(descriptor.message, options)
  }
}

export const useToastPresentation = () => {
  const send = useRemeshSend()
  const presentationDomain = useRemeshDomain(ToastPresentationDomain())
  const toasterRef = useRef<HTMLElement | null>(null)
  const surfaceMountedRef = useRef(false)
  const trackedIdsRef = useRef(new Set<string>())
  const surfaceAttemptIdsRef = useRef(new Set<string>())
  const observersRef = useRef(new Map<string, () => void>())
  const pendingUnmountRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const acknowledge = useCallback(
    (id: string, status: 'presented' | 'unavailable') => {
      observersRef.current.delete(id)
      if (status === 'unavailable') surfaceAttemptIdsRef.current.delete(id)
      send(presentationDomain.command.AcknowledgeCommand({ id, status }))
    },
    [presentationDomain.command, send]
  )

  const dismiss = useCallback((id: string) => {
    observersRef.current.get(id)?.()
    observersRef.current.delete(id)
    surfaceAttemptIdsRef.current.delete(id)
    trackedIdsRef.current.delete(id)
    toast.dismiss(id)
  }, [])

  const detach = useCallback(() => {
    const surfaceAttemptIds = [...surfaceAttemptIdsRef.current]
    observersRef.current.forEach((stop) => stop())
    observersRef.current.clear()
    surfaceAttemptIdsRef.current.clear()
    trackedIdsRef.current.forEach((id) => toast.dismiss(id))
    trackedIdsRef.current.clear()
    toasterRef.current = null
    return surfaceAttemptIds
  }, [])

  const unmountSurface = useCallback(() => {
    if (!surfaceMountedRef.current) return
    const surfaceAttemptIds = detach()
    surfaceMountedRef.current = false
    send(presentationDomain.command.SetSurfaceMountedCommand(false))
    surfaceAttemptIds.forEach((id) => acknowledge(id, 'unavailable'))
  }, [acknowledge, detach, presentationDomain.command, send])

  const cancelSurfaceUnmount = useCallback(() => {
    if (pendingUnmountRef.current === null) return
    clearTimeout(pendingUnmountRef.current)
    pendingUnmountRef.current = null
  }, [])

  const scheduleSurfaceUnmount = useCallback(() => {
    if (pendingUnmountRef.current !== null) return
    pendingUnmountRef.current = setTimeout(() => {
      pendingUnmountRef.current = null
      unmountSurface()
    }, 0)
  }, [unmountSurface])

  const setToasterRef = useCallback(
    (toaster: HTMLElement | null) => {
      toasterRef.current = toaster
      if (!toaster) {
        scheduleSurfaceUnmount()
        return
      }
      cancelSurfaceUnmount()
      if (surfaceMountedRef.current) return
      surfaceMountedRef.current = true
      send(presentationDomain.command.SetSurfaceMountedCommand(true))
    },
    [cancelSurfaceUnmount, presentationDomain.command, scheduleSurfaceUnmount, send]
  )

  useRemeshEvent(presentationDomain.event.DescriptorEvent, (descriptor) => {
    const toaster = toasterRef.current
    if (!toaster) {
      if (descriptor.acknowledge) acknowledge(descriptor.id, 'unavailable')
      return
    }

    observersRef.current.get(descriptor.id)?.()
    observersRef.current.delete(descriptor.id)
    showDescriptor(descriptor)
    trackedIdsRef.current.add(descriptor.id)

    if (!descriptor.acknowledge) {
      surfaceAttemptIdsRef.current.delete(descriptor.id)
      return
    }
    surfaceAttemptIdsRef.current.add(descriptor.id)
    observersRef.current.set(
      descriptor.id,
      observeVisibleDwell(
        toaster,
        descriptor,
        () => acknowledge(descriptor.id, 'presented'),
        () => acknowledge(descriptor.id, 'unavailable')
      )
    )
  })

  useRemeshEvent(presentationDomain.event.DismissEvent, dismiss)

  useEffect(() => {
    cancelSurfaceUnmount()
    return scheduleSurfaceUnmount
  }, [cancelSurfaceUnmount, scheduleSurfaceUnmount])

  return setToasterRef
}
