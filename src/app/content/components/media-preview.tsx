import {
  createContext,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { flushSync } from 'react-dom'
import { MinusIcon, RotateCcwIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  MEDIA_PREVIEW_MAX_ZOOM,
  MEDIA_PREVIEW_MIN_ZOOM,
  clampMediaPreviewTransform,
  getMediaPreviewLayout,
  getMediaPreviewPanBounds,
  zoomMediaPreviewAtPoint,
  zoomMediaPreviewBetweenPoints,
  type MediaPreviewPoint,
  type MediaPreviewSize,
  type MediaPreviewTransform
} from './media-preview-geometry'

const ZOOM_STEP = 0.25
const PREVIEW_BACKDROP_LAYER = 2147483646
const PREVIEW_BODY_LAYER = 2147483647
export const MEDIA_PREVIEW_TRANSITION_PART = 'webchat-media-preview-transition'
export const MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY = '--webchat-media-preview-transition-name'

export interface MediaPreviewRequest {
  src: string
  alt: string
  activator: HTMLElement
  transitionElement: HTMLElement
}

export interface MediaPreviewHandle {
  open: (request: MediaPreviewRequest) => void
}

type OpenMediaPreview = (request: MediaPreviewRequest) => void

export const MediaPreviewContext = createContext<OpenMediaPreview | null>(null)

const initialTransform: MediaPreviewTransform = { zoom: 1, x: 0, y: 0 }

interface CurrentPreview extends MediaPreviewRequest {
  requestId: number
}

interface PreviewState {
  current: CurrentPreview | null
  naturalSize: MediaPreviewSize | null
  transform: MediaPreviewTransform
  viewport: MediaPreviewSize
}

type PointerState = MediaPreviewPoint

interface PanGesture {
  pointerId: number
  startPoint: MediaPreviewPoint
  startTransform: MediaPreviewTransform
}

interface PinchGesture {
  pointerIds: [number, number]
  startDistance: number
  startFocalPoint: MediaPreviewPoint
  startTransform: MediaPreviewTransform
}

interface TransitionIdentity {
  generation: number
  name: string
  element: HTMLElement
  previousValue: string
  previousPriority: string
}

type PreviewPhase = 'closed' | 'opening' | 'opening-close-pending' | 'open' | 'closing'
type TransitionIntent = 'close' | 'replace' | null

interface ActivePreviewTransition {
  generation: number
  kind: 'opening' | 'closing'
  transition: ViewTransition
  intent: TransitionIntent
}

type TransitionDocument = Omit<Document, 'startViewTransition'> & {
  startViewTransition?: Document['startViewTransition']
}

const pointerDistance = (first: MediaPreviewPoint, second: MediaPreviewPoint) =>
  Math.hypot(second.x - first.x, second.y - first.y)
const pointerMidpoint = (first: MediaPreviewPoint, second: MediaPreviewPoint): MediaPreviewPoint => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2
})
const isEditableTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null

const MediaPreview = forwardRef<MediaPreviewHandle, { shellOpen: boolean }>(({ shellOpen }, ref) => {
  const [state, setState] = useState<PreviewState>(() => ({
    current: null,
    naturalSize: null,
    transform: initialTransform,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  }))
  const stateRef = useRef(state)
  const operationRef = useRef(0)
  const selectedPreviewRef = useRef<CurrentPreview | null>(null)
  const phaseRef = useRef<PreviewPhase>('closed')
  const activeTransitionRef = useRef<ActivePreviewTransition | null>(null)
  const transitionIdentityRef = useRef<TransitionIdentity | null>(null)
  const backdropRef = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLDialogElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointersRef = useRef(new Map<number, PointerState>())
  const panGestureRef = useRef<PanGesture | null>(null)
  const pinchGestureRef = useRef<PinchGesture | null>(null)
  const suppressBackdropClickRef = useRef(false)
  const suppressionTimerRef = useRef<number | null>(null)

  const layout = useMemo(
    () => getMediaPreviewLayout(state.naturalSize, state.viewport),
    [state.naturalSize, state.viewport]
  )
  const fit = layout.fit
  const renderedTransform = useMemo(
    () => (fit ? clampMediaPreviewTransform(state.transform, fit) : state.transform),
    [fit, state.transform]
  )
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const commitState = useCallback((next: PreviewState, synchronous = false) => {
    stateRef.current = next
    if (synchronous) flushSync(() => setState(next))
    else setState(next)
  }, [])

  const clearSuppressionTimer = useCallback(() => {
    if (suppressionTimerRef.current === null) return
    window.clearTimeout(suppressionTimerRef.current)
    suppressionTimerRef.current = null
  }, [])

  const clearGestures = useCallback(() => {
    const overlay = overlayRef.current
    if (overlay) {
      for (const pointerId of pointersRef.current.keys()) {
        if (overlay.hasPointerCapture(pointerId)) overlay.releasePointerCapture(pointerId)
      }
    }
    pointersRef.current.clear()
    panGestureRef.current = null
    pinchGestureRef.current = null
    suppressBackdropClickRef.current = false
    clearSuppressionTimer()
  }, [clearSuppressionTimer])

  const commitTransform = useCallback(
    (next: MediaPreviewTransform) => {
      const currentState = stateRef.current
      const nextFit = layoutRef.current.fit
      const nextTransform = nextFit
        ? clampMediaPreviewTransform(next, nextFit)
        : {
            zoom: Math.min(MEDIA_PREVIEW_MAX_ZOOM, Math.max(MEDIA_PREVIEW_MIN_ZOOM, next.zoom)),
            x: 0,
            y: 0
          }
      if (
        currentState.transform.zoom === nextTransform.zoom &&
        currentState.transform.x === nextTransform.x &&
        currentState.transform.y === nextTransform.y
      ) {
        return
      }
      commitState({ ...currentState, transform: nextTransform })
    },
    [commitState]
  )

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const releaseTransitionIdentity = useCallback((generation?: number) => {
    const identity = transitionIdentityRef.current
    if (!identity || (generation !== undefined && identity.generation !== generation)) return
    transitionIdentityRef.current = null
    if (identity.element.style.getPropertyValue(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY) === identity.name) {
      if (identity.previousValue) {
        identity.element.style.setProperty(
          MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY,
          identity.previousValue,
          identity.previousPriority
        )
      } else {
        identity.element.style.removeProperty(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY)
      }
    }
  }, [])

  const claimTransitionIdentity = useCallback(
    (generation: number, name: string, element: HTMLElement) => {
      releaseTransitionIdentity()
      const previousValue = element.style.getPropertyValue(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY)
      const previousPriority = element.style.getPropertyPriority(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY)
      element.style.setProperty(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY, name)
      transitionIdentityRef.current = { generation, name, element, previousValue, previousPriority }
    },
    [releaseTransitionIdentity]
  )

  const transferTransitionIdentity = useCallback(
    (generation: number, element: HTMLElement) => {
      const identity = transitionIdentityRef.current
      if (!identity || identity.generation !== generation) return
      if (identity.element === element) return
      claimTransitionIdentity(generation, identity.name, element)
    },
    [claimTransitionIdentity]
  )

  const startClose = useCallback(
    (closing: CurrentPreview) => {
      if (selectedPreviewRef.current?.requestId !== closing.requestId) return
      phaseRef.current = 'closing'
      const requestId = ++operationRef.current
      releaseTransitionIdentity()
      clearGestures()

      const applyClose = (synchronous: boolean) => {
        if (operationRef.current !== requestId || selectedPreviewRef.current?.requestId !== closing.requestId) {
          return
        }
        selectedPreviewRef.current = null
        phaseRef.current = 'closed'
        commitState(
          { current: null, naturalSize: null, transform: initialTransform, viewport: stateRef.current.viewport },
          synchronous
        )
        if (closing.activator.isConnected) closing.activator.focus({ preventScroll: true })
      }

      const transitionDocument = document as TransitionDocument
      if (!transitionDocument.startViewTransition || reducedMotion()) {
        applyClose(false)
        return
      }

      const image = imageRef.current
      if (!image) {
        applyClose(false)
        return
      }
      const transitionName = `webchat-media-preview-${requestId}`
      claimTransitionIdentity(requestId, transitionName, image)
      let applied = false
      let active: ActivePreviewTransition | null = null
      const settle = () => {
        if (activeTransitionRef.current === active) activeTransitionRef.current = null
        releaseTransitionIdentity(requestId)
      }
      const fallback = () => {
        if (applied) return
        applied = true
        releaseTransitionIdentity(requestId)
        applyClose(false)
      }
      const finish = () => {
        fallback()
        settle()
      }

      try {
        const transition = transitionDocument.startViewTransition(() => {
          if (operationRef.current !== requestId || applied) return
          applied = true
          transferTransitionIdentity(requestId, closing.transitionElement)
          applyClose(true)
        })
        active = { generation: requestId, kind: 'closing', transition, intent: null }
        activeTransitionRef.current = active
        void transition.ready.catch(finish)
        void transition.updateCallbackDone.catch(finish)
        void transition.finished.then(finish, finish)
      } catch {
        finish()
      }
    },
    [claimTransitionIdentity, clearGestures, commitState, releaseTransitionIdentity, transferTransitionIdentity]
  )

  const close = useCallback(() => {
    const closing = selectedPreviewRef.current
    if (!closing || phaseRef.current === 'closing' || phaseRef.current === 'opening-close-pending') return
    const active = activeTransitionRef.current
    if (phaseRef.current === 'opening' && active?.kind === 'opening' && active.generation === closing.requestId) {
      if (active.intent === 'close') return
      active.intent = 'close'
      phaseRef.current = 'opening-close-pending'
      active.transition.skipTransition()
      const beginClose = () => {
        if (
          active.intent === 'close' &&
          selectedPreviewRef.current?.requestId === closing.requestId &&
          phaseRef.current === 'opening-close-pending'
        ) {
          startClose(closing)
        }
      }
      void active.transition.updateCallbackDone.then(beginClose, beginClose)
      return
    }
    startClose(closing)
  }, [startClose])

  const startOpen = useCallback(
    (request: MediaPreviewRequest) => {
      const requestId = ++operationRef.current
      const current = { ...request, requestId }
      selectedPreviewRef.current = current
      phaseRef.current = 'opening'
      releaseTransitionIdentity()
      clearGestures()

      const applyOpen = (synchronous: boolean) => {
        if (operationRef.current !== requestId || selectedPreviewRef.current?.requestId !== requestId) return
        const viewport = stateRef.current.viewport
        commitState(
          {
            current,
            naturalSize: null,
            transform: initialTransform,
            viewport
          },
          synchronous
        )
      }
      const markOpen = () => {
        if (
          operationRef.current === requestId &&
          selectedPreviewRef.current?.requestId === requestId &&
          phaseRef.current === 'opening'
        ) {
          phaseRef.current = 'open'
        }
      }

      const transitionDocument = document as TransitionDocument
      if (!transitionDocument.startViewTransition || reducedMotion()) {
        applyOpen(false)
        markOpen()
        return
      }

      const transitionName = `webchat-media-preview-${requestId}`
      claimTransitionIdentity(requestId, transitionName, request.transitionElement)
      let applied = false
      let active: ActivePreviewTransition | null = null
      const fallback = () => {
        if (active && active.intent !== null) return
        if (!applied) {
          applied = true
          releaseTransitionIdentity(requestId)
          applyOpen(false)
        }
        markOpen()
      }
      const settle = () => {
        if (activeTransitionRef.current === active) activeTransitionRef.current = null
        releaseTransitionIdentity(requestId)
        if (!active || active.intent === null) markOpen()
      }
      const finish = () => {
        fallback()
        settle()
      }

      try {
        const transition = transitionDocument.startViewTransition(() => {
          if (operationRef.current !== requestId || selectedPreviewRef.current?.requestId !== requestId || applied) {
            return
          }
          applied = true
          applyOpen(true)
          const image = imageRef.current
          if (image) transferTransitionIdentity(requestId, image)
          else releaseTransitionIdentity(requestId)
        })
        active = { generation: requestId, kind: 'opening', transition, intent: null }
        activeTransitionRef.current = active
        void transition.ready.catch(finish)
        void transition.updateCallbackDone.catch(finish)
        void transition.finished.then(finish, finish)
      } catch {
        finish()
      }
    },
    [claimTransitionIdentity, clearGestures, commitState, releaseTransitionIdentity, transferTransitionIdentity]
  )

  const open = useCallback(
    (request: MediaPreviewRequest) => {
      if (!request.src || !shellOpen || phaseRef.current === 'closing') return
      const current = selectedPreviewRef.current
      if (current?.activator === request.activator) {
        close()
        return
      }
      if (current) {
        const active = activeTransitionRef.current
        if (active?.kind === 'opening' && active.generation === current.requestId) {
          const shouldSkip = active.intent === null
          active.intent = 'replace'
          if (shouldSkip) active.transition.skipTransition()
        }
      }
      startOpen(request)
    },
    [close, shellOpen, startOpen]
  )

  useImperativeHandle(ref, () => ({ open }), [open])

  const currentRequestId = state.current?.requestId
  const previewOpen = state.current !== null

  useLayoutEffect(() => {
    if (shellOpen) return
    if (selectedPreviewRef.current) queueMicrotask(close)
    else phaseRef.current = 'closed'
  }, [close, shellOpen])

  useLayoutEffect(() => {
    if (!previewOpen) return
    overlayRef.current?.focus({ preventScroll: true })
  }, [currentRequestId, previewOpen])

  useLayoutEffect(() => {
    const handleResize = () => {
      const currentState = stateRef.current
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      if (currentState.viewport.width === viewport.width && currentState.viewport.height === viewport.height) return
      const nextFit = getMediaPreviewLayout(currentState.naturalSize, viewport).fit
      commitState(
        {
          ...currentState,
          viewport,
          transform: nextFit ? clampMediaPreviewTransform(currentState.transform, nextFit) : currentState.transform
        },
        true
      )
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [commitState])

  useLayoutEffect(() => {
    if (fit) commitTransform(renderedTransform)
  }, [commitTransform, fit, renderedTransform])

  useEffect(() => () => releaseTransitionIdentity(), [releaseTransitionIdentity])

  const changeZoom = useCallback(
    (nextZoom: number, focalPoint: MediaPreviewPoint = { x: 0, y: 0 }) => {
      const currentTransform = stateRef.current.transform
      commitTransform(
        layoutRef.current.fit
          ? zoomMediaPreviewAtPoint(currentTransform, nextZoom, focalPoint, layoutRef.current.fit)
          : { zoom: nextZoom, x: 0, y: 0 }
      )
    },
    [commitTransform]
  )

  const resetTransform = useCallback(() => commitTransform(initialTransform), [commitTransform])

  useLayoutEffect(() => {
    if (!previewOpen) return
    const owner = overlayRef.current?.getRootNode()
    if (!owner) return
    const handleKeyDown = (nativeEvent: Event) => {
      const event = nativeEvent as KeyboardEvent
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      }
      if (isEditableTarget(event.target)) return
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        event.stopPropagation()
        changeZoom(stateRef.current.transform.zoom + ZOOM_STEP)
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        event.stopPropagation()
        changeZoom(stateRef.current.transform.zoom - ZOOM_STEP)
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        event.stopPropagation()
        resetTransform()
      }
    }
    owner.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => owner.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [changeZoom, close, previewOpen, resetTransform])

  useLayoutEffect(() => {
    if (!previewOpen) return
    const surfaces = [backdropRef.current, overlayRef.current].filter((surface) => surface !== null)
    const handleWheel = (nativeEvent: Event) => {
      const event = nativeEvent as WheelEvent
      event.preventDefault()
      event.stopPropagation()
      const center = layoutRef.current.center
      const focalPoint = { x: event.clientX - center.x, y: event.clientY - center.y }
      changeZoom(stateRef.current.transform.zoom - event.deltaY * 0.0025, focalPoint)
    }
    for (const surface of surfaces) surface.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      for (const surface of surfaces) surface.removeEventListener('wheel', handleWheel)
    }
  }, [changeZoom, previewOpen])

  useLayoutEffect(() => {
    if (!previewOpen) return
    const backdrop = backdropRef.current
    const overlay = overlayRef.current
    const owner = overlay?.getRootNode()
    if (!backdrop || !overlay || !owner) return
    const handleClick = (event: Event) => {
      const path = event.composedPath()
      if (path.includes(backdrop) || path.includes(overlay)) event.stopPropagation()
    }
    owner.addEventListener('click', handleClick)
    return () => owner.removeEventListener('click', handleClick)
  }, [previewOpen])

  const relativePoint = (point: MediaPreviewPoint): MediaPreviewPoint => ({
    x: point.x - layoutRef.current.center.x,
    y: point.y - layoutRef.current.center.y
  })

  const beginPinch = () => {
    const [firstEntry, secondEntry] = [...pointersRef.current.entries()]
    if (!firstEntry || !secondEntry) return
    const [firstId, first] = firstEntry
    const [secondId, second] = secondEntry
    pinchGestureRef.current = {
      pointerIds: [firstId, secondId],
      startDistance: pointerDistance(first, second),
      startFocalPoint: relativePoint(pointerMidpoint(first, second)),
      startTransform: stateRef.current.transform
    }
    panGestureRef.current = null
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDialogElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (pointersRef.current.size === 0) {
      clearSuppressionTimer()
      suppressBackdropClickRef.current = false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    })
    if (pointersRef.current.size === 1) {
      panGestureRef.current = {
        pointerId: event.pointerId,
        startPoint: { x: event.clientX, y: event.clientY },
        startTransform: stateRef.current.transform
      }
    } else if (pointersRef.current.size === 2) {
      beginPinch()
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDialogElement>) => {
    const pointer = pointersRef.current.get(event.pointerId)
    if (!pointer) return
    event.preventDefault()
    event.stopPropagation()
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    })

    const pinch = pinchGestureRef.current
    const fit = layoutRef.current.fit
    if (pinch && fit) {
      const first = pointersRef.current.get(pinch.pointerIds[0])
      const second = pointersRef.current.get(pinch.pointerIds[1])
      if (!first || !second || pinch.startDistance === 0) return
      const distance = pointerDistance(first, second)
      const focalPoint = relativePoint(pointerMidpoint(first, second))
      const next = zoomMediaPreviewBetweenPoints(
        pinch.startTransform,
        pinch.startTransform.zoom * (distance / pinch.startDistance),
        pinch.startFocalPoint,
        focalPoint,
        fit
      )
      if (
        Math.abs(distance - pinch.startDistance) > 3 ||
        Math.abs(focalPoint.x - pinch.startFocalPoint.x) > 3 ||
        Math.abs(focalPoint.y - pinch.startFocalPoint.y) > 3
      ) {
        suppressBackdropClickRef.current = true
      }
      commitTransform(next)
      return
    }

    const pan = panGestureRef.current
    if (!pan || pan.pointerId !== event.pointerId || !fit) return
    const bounds = getMediaPreviewPanBounds(fit, pan.startTransform.zoom)
    if (bounds.x === 0 && bounds.y === 0) return
    const deltaX = event.clientX - pan.startPoint.x
    const deltaY = event.clientY - pan.startPoint.y
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) suppressBackdropClickRef.current = true
    commitTransform({
      zoom: pan.startTransform.zoom,
      x: pan.startTransform.x + deltaX,
      y: pan.startTransform.y + deltaY
    })
  }

  const finishPointer = (event: ReactPointerEvent<HTMLDialogElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    event.preventDefault()
    event.stopPropagation()
    pointersRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pinchGestureRef.current = null
    panGestureRef.current = null
    const remaining = [...pointersRef.current.entries()][0]
    if (remaining) {
      panGestureRef.current = {
        pointerId: remaining[0],
        startPoint: remaining[1],
        startTransform: stateRef.current.transform
      }
    } else if (suppressBackdropClickRef.current) {
      clearSuppressionTimer()
      suppressionTimerRef.current = window.setTimeout(() => {
        suppressBackdropClickRef.current = false
        suppressionTimerRef.current = null
      }, 0)
    }
  }

  const handleBackdropClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressBackdropClickRef.current) {
      suppressBackdropClickRef.current = false
      clearSuppressionTimer()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    close()
    event.stopPropagation()
  }

  if (!state.current) return null

  const interactionStyle = {
    left: `${layout.interaction.x}px`,
    top: `${layout.interaction.y}px`,
    inlineSize: `${layout.interaction.width}px`,
    blockSize: `${layout.interaction.height}px`
  }
  const imageStyle = {
    inlineSize: fit ? `${fit.width}px` : 'auto',
    blockSize: fit ? `${fit.height}px` : 'auto',
    maxInlineSize: `${layout.interaction.width}px`,
    maxBlockSize: `${layout.interaction.height}px`,
    objectFit: 'contain' as const,
    transform: `translate3d(${renderedTransform.x}px, ${renderedTransform.y}px, 0) scale(${renderedTransform.zoom})`,
    transformOrigin: 'center'
  }
  const toolbarBandStyle = {
    left: `${layout.toolbar.x}px`,
    top: `${layout.toolbar.y}px`,
    inlineSize: `${layout.toolbar.width}px`,
    blockSize: `${layout.toolbar.height}px`
  }

  return (
    <>
      <button
        ref={backdropRef}
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="fixed inset-0 cursor-default border-0 p-0"
        style={{ zIndex: PREVIEW_BACKDROP_LAYER, backgroundColor: 'rgb(0 0 0 / 18%)' }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={handleBackdropClick}
      />
      <dialog
        ref={overlayRef}
        open
        aria-label="Image preview"
        tabIndex={-1}
        className="pointer-events-none fixed inset-0 m-0 h-auto max-h-none w-auto max-w-none touch-none overflow-visible border-0 bg-transparent p-0 outline-none"
        style={{ zIndex: PREVIEW_BODY_LAYER }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <div
          className="pointer-events-none absolute flex items-center justify-center overflow-hidden"
          style={interactionStyle}
        >
          <img
            ref={imageRef}
            key={state.current.requestId}
            src={state.current.src}
            alt={state.current.alt}
            part={MEDIA_PREVIEW_TRANSITION_PART}
            draggable={false}
            className="pointer-events-auto block max-h-none max-w-none select-none"
            style={imageStyle}
            onLoad={(event) => {
              const naturalSize = {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight
              }
              if (naturalSize.width <= 0 || naturalSize.height <= 0) return
              const currentState = stateRef.current
              commitState({ ...currentState, naturalSize })
            }}
          />
        </div>
        <div className="pointer-events-none absolute flex items-center justify-center" style={toolbarBandStyle}>
          <div
            role="toolbar"
            aria-label="Image preview controls"
            className="pointer-events-auto flex gap-2"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="rounded-full shadow"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={state.transform.zoom <= MEDIA_PREVIEW_MIN_ZOOM}
              onClick={() => changeZoom(stateRef.current.transform.zoom - ZOOM_STEP)}
            >
              <MinusIcon />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="rounded-full shadow"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={state.transform.zoom >= MEDIA_PREVIEW_MAX_ZOOM}
              onClick={() => changeZoom(stateRef.current.transform.zoom + ZOOM_STEP)}
            >
              <PlusIcon />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="rounded-full shadow"
              aria-label="Reset zoom"
              title="Reset zoom"
              onClick={resetTransform}
            >
              <RotateCcwIcon />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="rounded-full shadow"
              aria-label="Close preview"
              title="Close preview"
              onClick={close}
            >
              <XIcon />
            </Button>
          </div>
        </div>
      </dialog>
    </>
  )
})

MediaPreview.displayName = 'MediaPreview'

export default MediaPreview
