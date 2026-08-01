export const MEDIA_PREVIEW_MARGIN = 24
export const MEDIA_PREVIEW_MIN_ZOOM = 1
export const MEDIA_PREVIEW_MAX_ZOOM = 4

export interface MediaPreviewSize {
  width: number
  height: number
}

export interface MediaPreviewPoint {
  x: number
  y: number
}

export interface MediaPreviewFit extends MediaPreviewSize {
  availableWidth: number
  availableHeight: number
}

export interface MediaPreviewTransform extends MediaPreviewPoint {
  zoom: number
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export const getMediaPreviewFit = (natural: MediaPreviewSize, viewport: MediaPreviewSize): MediaPreviewFit => {
  const availableWidth = Math.max(0, viewport.width - MEDIA_PREVIEW_MARGIN * 2)
  const availableHeight = Math.max(0, viewport.height - MEDIA_PREVIEW_MARGIN * 2)
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

export const getMediaPreviewPanBounds = (fit: MediaPreviewFit, zoom: number): MediaPreviewPoint => ({
  x: Math.max(0, (fit.width * zoom - fit.availableWidth) / 2),
  y: Math.max(0, (fit.height * zoom - fit.availableHeight) / 2)
})

export const clampMediaPreviewTransform = (
  transform: MediaPreviewTransform,
  fit: MediaPreviewFit
): MediaPreviewTransform => {
  const zoom = clamp(transform.zoom, MEDIA_PREVIEW_MIN_ZOOM, MEDIA_PREVIEW_MAX_ZOOM)
  const bounds = getMediaPreviewPanBounds(fit, zoom)
  return {
    zoom,
    x: bounds.x === 0 ? 0 : clamp(transform.x, -bounds.x, bounds.x),
    y: bounds.y === 0 ? 0 : clamp(transform.y, -bounds.y, bounds.y)
  }
}

export const zoomMediaPreviewBetweenPoints = (
  transform: MediaPreviewTransform,
  nextZoom: number,
  sourceFocalPoint: MediaPreviewPoint,
  targetFocalPoint: MediaPreviewPoint,
  fit: MediaPreviewFit
) => {
  const zoom = clamp(nextZoom, MEDIA_PREVIEW_MIN_ZOOM, MEDIA_PREVIEW_MAX_ZOOM)
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
  focalPoint: MediaPreviewPoint,
  fit: MediaPreviewFit
): MediaPreviewTransform => zoomMediaPreviewBetweenPoints(transform, nextZoom, focalPoint, focalPoint, fit)
