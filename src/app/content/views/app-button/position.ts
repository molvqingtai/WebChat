import type { AppButtonPosition } from '@/domain/AppStatus'
import { clamp } from '@/utils'

export const APP_BUTTON_SIZE = 44
const APP_BUTTON_HORIZONTAL_CENTER_MARGIN = 50
const APP_BUTTON_BOTTOM_MARGIN = 22
const APP_SHELL_TOP_INSET = 40
const APP_SHELL_MINIMUM_HEIGHT = 375
const APP_SHELL_MINIMUM_LAUNCHER_BOTTOM_EDGE = APP_SHELL_TOP_INSET + APP_SHELL_MINIMUM_HEIGHT + APP_BUTTON_SIZE / 2

export interface ViewportSize {
  width: number
  height: number
}

export interface AppButtonPoint {
  /** Launcher center measured from the viewport left edge. */
  x: number
  /** Launcher bottom edge measured from the viewport top edge. */
  y: number
}

export const getAppButtonDragBounds = ({ width, height }: ViewportSize, expanded: boolean) => {
  const horizontalInset = Math.min(APP_BUTTON_HORIZONTAL_CENTER_MARGIN, width / 2)
  const launcherMinimumBottomEdge = Math.min(APP_BUTTON_SIZE, height)
  const maximumBottomEdge = Math.max(launcherMinimumBottomEdge, height - APP_BUTTON_BOTTOM_MARGIN)
  const minimumBottomEdge =
    expanded && maximumBottomEdge >= APP_SHELL_MINIMUM_LAUNCHER_BOTTOM_EDGE
      ? APP_SHELL_MINIMUM_LAUNCHER_BOTTOM_EDGE
      : launcherMinimumBottomEdge
  return {
    minX: horizontalInset,
    maxX: width - horizontalInset,
    minY: minimumBottomEdge,
    maxY: maximumBottomEdge
  }
}

const boundAppButtonPoint = (point: AppButtonPoint, viewport: ViewportSize, expanded: boolean): AppButtonPoint => {
  const bounds = getAppButtonDragBounds(viewport, expanded)
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY)
  }
}

export const projectAppButtonPosition = (
  position: AppButtonPosition,
  viewport: ViewportSize,
  expanded: boolean
): AppButtonPoint =>
  boundAppButtonPoint(
    {
      x: position.x < 0 ? -position.x : viewport.width - position.x,
      y: viewport.height - position.y
    },
    viewport,
    expanded
  )

export const captureAppButtonPosition = (
  point: AppButtonPoint,
  viewport: ViewportSize,
  expanded: boolean
): AppButtonPosition => {
  const bounded = boundAppButtonPoint(point, viewport, expanded)
  return {
    x: bounded.x < viewport.width / 2 ? -bounded.x : viewport.width - bounded.x,
    y: viewport.height - bounded.y
  }
}
