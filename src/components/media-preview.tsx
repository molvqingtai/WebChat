import {
  createContext,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'
import { flushSync } from 'react-dom'
import { MinusIcon, RotateCcwIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import useWindowResize from '@/hooks/useWindowResize'

const PREVIEW_MARGIN = 24
const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25
const PREVIEW_LAYER = 2147483646

interface Size {
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

export interface MediaPreviewFit extends Size {
  availableWidth: number
  availableHeight: number
}

export interface MediaPreviewTransform extends Point {
  zoom: number
}

export interface MediaPreviewRequest {
  src: string
  alt: string
  activator: HTMLElement
  transitionElement: HTMLElement
}

export interface MediaPreviewHandle {
  open: (request: MediaPreviewRequest) => void
}

export type OpenMediaPreview = (request: MediaPreviewRequest) => void

export const MediaPreviewContext = createContext<OpenMediaPreview | null>(null)

const initialTransform: MediaPreviewTransform = { zoom: MIN_ZOOM, x: 0, y: 0 }

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export const getMediaPreviewFit = (natural: Size, viewport: Size): MediaPreviewFit => {
  const availableWidth = Math.max(0, viewport.width - PREVIEW_MARGIN * 2)
  const availableHeight = Math.max(0, viewport.height - PREVIEW_MARGIN * 2)
  const scale =
    natural.width > 0 && natural.height > 0
      ? Math.min(1, availableWidth / natural.width, availableHeight / natural.height)
      : 0

  return {
    availableWidth,
    availableHeight,
    width: natural.width * scale,
    height: natural.height * scale
  }
}

export const getMediaPreviewPanBounds = (fit: MediaPreviewFit, zoom: number): Point => ({
  x: Math.max(0, (fit.width * zoom - fit.availableWidth) / 2),
  y: Math.max(0, (fit.height * zoom - fit.availableHeight) / 2)
})

export const clampMediaPreviewTransform = (
  transform: MediaPreviewTransform,
  fit: MediaPreviewFit
): MediaPreviewTransform => {
  const zoom = clamp(transform.zoom, MIN_ZOOM, MAX_ZOOM)
  const bounds = getMediaPreviewPanBounds(fit, zoom)
  return {
    zoom,
    x: bounds.x === 0 ? 0 : clamp(transform.x, -bounds.x, bounds.x),
    y: bounds.y === 0 ? 0 : clamp(transform.y, -bounds.y, bounds.y)
  }
}

const zoomBetweenPoints = (
  transform: MediaPreviewTransform,
  nextZoom: number,
  sourceFocalPoint: Point,
  targetFocalPoint: Point,
  fit: MediaPreviewFit
) => {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  const ratio = zoom / transform.zoom
  return clampMediaPreviewTransform(
    {
      zoom,
      x: targetFocalPoint.x - (sourceFocalPoint.x - transform.x) * ratio,
      y: targetFocalPoint.y - (sourceFocalPoint.y - transform.y) * ratio
    },
    fit
  )
}

export const zoomMediaPreviewAtPoint = (
  transform: MediaPreviewTransform,
  nextZoom: number,
  focalPoint: Point,
  fit: MediaPreviewFit
): MediaPreviewTransform => zoomBetweenPoints(transform, nextZoom, focalPoint, focalPoint, fit)

interface CurrentPreview extends MediaPreviewRequest {
  requestId: number
  transitionName: string | null
}

interface PreviewState {
  current: CurrentPreview | null
  naturalSize: Size | null
  transform: MediaPreviewTransform
}

interface PointerState extends Point {
  pointerType: string
}

interface PanGesture {
  pointerId: number
  startPoint: Point
  startTransform: MediaPreviewTransform
}

interface PinchGesture {
  pointerIds: [number, number]
  startDistance: number
  startFocalPoint: Point
  startTransform: MediaPreviewTransform
}

type TransitionDocument = Document & {
  startViewTransition?: (operation: () => void) => {
    ready?: Promise<unknown>
    updateCallbackDone?: Promise<unknown>
    finished: Promise<unknown>
  }
}

const pointerDistance = (first: Point, second: Point) => Math.hypot(second.x - first.x, second.y - first.y)
const pointerMidpoint = (first: Point, second: Point): Point => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2
})

const MediaPreview = forwardRef<MediaPreviewHandle, { shellOpen: boolean }>(({ shellOpen }, ref) => {
  const viewport = useWindowResize()
  const [state, setState] = useState<PreviewState>({
    current: null,
    naturalSize: null,
    transform: initialTransform
  })
  const stateRef = useRef(state)
  const operationRef = useRef(0)
  const overlayRef = useRef<HTMLDialogElement>(null)
  const pointersRef = useRef(new Map<number, PointerState>())
  const panGestureRef = useRef<PanGesture | null>(null)
  const pinchGestureRef = useRef<PinchGesture | null>(null)
  const suppressBackdropClickRef = useRef(false)
  const suppressionTimerRef = useRef<number | null>(null)

  const fit = useMemo(
    () => (state.naturalSize ? getMediaPreviewFit(state.naturalSize, viewport) : null),
    [state.naturalSize, viewport]
  )
  const fitRef = useRef(fit)
  fitRef.current = fit

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
        if (overlay.hasPointerCapture?.(pointerId)) overlay.releasePointerCapture(pointerId)
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
      const nextTransform = fitRef.current
        ? clampMediaPreviewTransform(next, fitRef.current)
        : { zoom: clamp(next.zoom, MIN_ZOOM, MAX_ZOOM), x: 0, y: 0 }
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

  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  const clearTransitionIdentity = useCallback(
    (requestId: number, transitionName: string, transitionElement: HTMLElement, previousName: string) => {
      if (transitionElement.style.viewTransitionName === transitionName) {
        transitionElement.style.viewTransitionName = previousName
      }
      const currentState = stateRef.current
      if (currentState.current?.requestId === requestId && currentState.current.transitionName === transitionName) {
        commitState({
          ...currentState,
          current: { ...currentState.current, transitionName: null }
        })
      }
    },
    [commitState]
  )

  const open = useCallback(
    (request: MediaPreviewRequest) => {
      if (!request.src) return
      const requestId = ++operationRef.current
      clearGestures()

      const applyOpen = (transitionName: string | null, synchronous: boolean) => {
        if (operationRef.current !== requestId) return
        commitState(
          {
            current: { ...request, requestId, transitionName },
            naturalSize: null,
            transform: initialTransform
          },
          synchronous
        )
      }

      const transitionDocument = document as TransitionDocument
      if (!transitionDocument.startViewTransition || reducedMotion()) {
        applyOpen(null, false)
        return
      }

      const transitionName = `webchat-media-preview-${requestId}`
      const previousName = request.transitionElement.style.viewTransitionName
      request.transitionElement.style.viewTransitionName = transitionName
      let applied = false
      const restoreActivatorIdentity = () => {
        if (request.transitionElement.style.viewTransitionName === transitionName) {
          request.transitionElement.style.viewTransitionName = previousName
        }
      }
      const settle = () => clearTransitionIdentity(requestId, transitionName, request.transitionElement, previousName)
      const fallback = () => {
        if (applied) return
        applied = true
        applyOpen(null, false)
      }

      try {
        const transition = transitionDocument.startViewTransition(() => {
          if (operationRef.current !== requestId || applied) return
          applied = true
          restoreActivatorIdentity()
          applyOpen(transitionName, true)
        })
        void transition.ready?.catch(() => {})
        void transition.updateCallbackDone?.catch(() => {
          fallback()
          settle()
        })
        void Promise.resolve(transition.finished).then(settle, () => {
          fallback()
          settle()
        })
      } catch {
        fallback()
        settle()
      }
    },
    [clearGestures, clearTransitionIdentity, commitState]
  )

  useImperativeHandle(ref, () => ({ open }), [open])

  const close = useCallback(() => {
    const closing = stateRef.current.current
    if (!closing) return
    const requestId = ++operationRef.current
    clearGestures()

    const applyClose = (synchronous: boolean) => {
      if (operationRef.current !== requestId) return
      commitState({ current: null, naturalSize: null, transform: initialTransform }, synchronous)
      if (closing.activator.isConnected) closing.activator.focus({ preventScroll: true })
    }

    const transitionDocument = document as TransitionDocument
    if (!transitionDocument.startViewTransition || reducedMotion()) {
      applyClose(false)
      return
    }

    const transitionName = `webchat-media-preview-${requestId}`
    const previousName = closing.transitionElement.style.viewTransitionName
    const namedState = stateRef.current
    if (namedState.current?.requestId === closing.requestId) {
      commitState({ ...namedState, current: { ...namedState.current, transitionName } }, true)
    }
    let applied = false
    const settle = () => {
      if (closing.transitionElement.style.viewTransitionName === transitionName) {
        closing.transitionElement.style.viewTransitionName = previousName
      }
    }
    const fallback = () => {
      if (applied) return
      applied = true
      applyClose(false)
    }

    try {
      const transition = transitionDocument.startViewTransition(() => {
        if (operationRef.current !== requestId || applied) return
        applied = true
        closing.transitionElement.style.viewTransitionName = transitionName
        applyClose(true)
      })
      void transition.ready?.catch(() => {})
      void transition.updateCallbackDone?.catch(() => {
        fallback()
        settle()
      })
      void Promise.resolve(transition.finished).then(settle, () => {
        fallback()
        settle()
      })
    } catch {
      fallback()
      settle()
    }
  }, [clearGestures, commitState])

  const currentRequestId = state.current?.requestId
  const previewOpen = state.current !== null

  useEffect(() => {
    if (shellOpen || !stateRef.current.current) return
    queueMicrotask(close)
  }, [close, shellOpen])

  useEffect(() => {
    if (!previewOpen) return
    overlayRef.current?.focus({ preventScroll: true })
  }, [currentRequestId, previewOpen])

  useEffect(() => {
    if (!fit) return
    commitTransform(stateRef.current.transform)
  }, [commitTransform, fit])

  const changeZoom = useCallback(
    (nextZoom: number, focalPoint: Point = { x: 0, y: 0 }) => {
      const currentTransform = stateRef.current.transform
      commitTransform(
        fitRef.current
          ? zoomMediaPreviewAtPoint(currentTransform, nextZoom, focalPoint, fitRef.current)
          : { zoom: nextZoom, x: 0, y: 0 }
      )
    },
    [commitTransform]
  )

  const resetTransform = useCallback(() => commitTransform(initialTransform), [commitTransform])

  useEffect(() => {
    if (!previewOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      }
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
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeZoom, close, previewOpen, resetTransform])

  const handleWheel = (event: ReactWheelEvent<HTMLDialogElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const focalPoint = { x: event.clientX - viewport.width / 2, y: event.clientY - viewport.height / 2 }
    changeZoom(stateRef.current.transform.zoom - event.deltaY * 0.0025, focalPoint)
  }

  const relativePoint = (point: Point): Point => ({ x: point.x - viewport.width / 2, y: point.y - viewport.height / 2 })

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
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType
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
      y: event.clientY,
      pointerType: pointer.pointerType
    })

    const pinch = pinchGestureRef.current
    const fit = fitRef.current
    if (pinch && fit) {
      const first = pointersRef.current.get(pinch.pointerIds[0])
      const second = pointersRef.current.get(pinch.pointerIds[1])
      if (!first || !second || pinch.startDistance === 0) return
      const distance = pointerDistance(first, second)
      const focalPoint = relativePoint(pointerMidpoint(first, second))
      const next = zoomBetweenPoints(
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
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
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
  }

  if (!state.current) return null

  const imageStyle = {
    inlineSize: fit ? `${fit.width}px` : 'auto',
    blockSize: fit ? `${fit.height}px` : 'auto',
    maxInlineSize: `calc(100vw - ${PREVIEW_MARGIN * 2}px)`,
    maxBlockSize: `calc(100vh - ${PREVIEW_MARGIN * 2}px)`,
    objectFit: 'contain' as const,
    transform: `translate3d(${state.transform.x}px, ${state.transform.y}px, 0) scale(${state.transform.zoom})`,
    transformOrigin: 'center',
    viewTransitionName: state.current.transitionName ?? 'none'
  }

  return (
    <dialog
      ref={overlayRef}
      open
      aria-label="Image preview"
      tabIndex={-1}
      data-testid="media-preview"
      className="fixed inset-0 m-0 flex h-auto max-h-none w-auto max-w-none touch-none items-center justify-center overflow-hidden border-0 p-0 outline-none"
      style={{ zIndex: PREVIEW_LAYER, backgroundColor: 'rgb(0 0 0 / 18%)' }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    >
      <button
        type="button"
        aria-hidden="true"
        data-testid="media-preview-backdrop"
        tabIndex={-1}
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={handleBackdropClick}
      />
      <div
        className="absolute top-6 left-1/2 z-10 flex -translate-x-1/2 gap-2"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="rounded-full shadow"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={state.transform.zoom <= MIN_ZOOM}
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
          disabled={state.transform.zoom >= MAX_ZOOM}
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
      <img
        key={state.current.requestId}
        src={state.current.src}
        alt={state.current.alt}
        draggable={false}
        data-zoom={state.transform.zoom}
        data-translate-x={state.transform.x}
        data-translate-y={state.transform.y}
        className="block max-h-none max-w-none select-none"
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
    </dialog>
  )
})

MediaPreview.displayName = 'MediaPreview'

export default MediaPreview
