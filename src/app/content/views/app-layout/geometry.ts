import type { AppButtonPosition } from '@/domain/AppStatus'
import { clamp } from '@/utils'

const APP_BUTTON_SIZE = 44
const APP_BUTTON_RADIUS = APP_BUTTON_SIZE / 2
const APP_BUTTON_TOP_MARGIN = 62
const APP_BUTTON_MINIMUM_BOTTOM_EDGE = APP_BUTTON_TOP_MARGIN + APP_BUTTON_SIZE
const APP_BUTTON_HORIZONTAL_CENTER_MARGIN = 50
const APP_SHELL_TOP_INSET = 40
const APP_SHELL_MINIMUM_SIZE = 375
const APP_SHELL_MAXIMUM_WIDTH = 750
const APP_SHELL_MAXIMUM_HEIGHT = 1000
const APP_SHELL_MINIMUM_LAUNCHER_BOTTOM_EDGE = APP_SHELL_TOP_INSET + APP_SHELL_MINIMUM_SIZE + APP_BUTTON_RADIUS

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

export interface AppGeometry {
  point: AppButtonPoint
  bounds: ReturnType<typeof getAppButtonDragBounds>
  launcher: {
    size: number
  }
  shell: {
    minimumWidth: number
    maximumWidth: number
    isOnRightSide: boolean
  }
  style: {
    '--webchat-launcher-left': string
    '--webchat-launcher-bottom': string
    '--webchat-shell-bottom-offset': string
    '--webchat-shell-height': string
    '--webchat-shell-translate-x': string
  }
}

export const getAppButtonDragBounds = ({ width, height }: ViewportSize, expanded: boolean) => {
  const horizontalInset = Math.min(APP_BUTTON_HORIZONTAL_CENTER_MARGIN, width / 2)
  const launcherMinimumBottomEdge = Math.min(APP_BUTTON_SIZE, height)
  const maximumBottomEdge = Math.max(launcherMinimumBottomEdge, height - APP_BUTTON_RADIUS)
  // Two independent layers in the one geometry owner:
  // - Launcher-only (collapsed): the 62px outer-top margin (bottom edge 106px) requested
  //   whenever the viewport can contain the launcher, capped by the existing bottom bound so a
  //   viewport that cannot satisfy every fixed margin keeps the launcher fully visible at the
  //   nearest point with the LARGEST feasible top margin. Shell height is never read here.
  // - Expanded shell layer: the existing shell-safe bound remains authoritative when it places
  //   the launcher farther from the top; below that threshold the expanded fallback stays the
  //   original fully-visible bound, so expanded placement is unchanged by the collapsed value.
  const collapsedMinimumBottomEdge = Math.min(APP_BUTTON_MINIMUM_BOTTOM_EDGE, maximumBottomEdge)
  const minimumBottomEdge = expanded
    ? maximumBottomEdge >= APP_SHELL_MINIMUM_LAUNCHER_BOTTOM_EDGE
      ? APP_SHELL_MINIMUM_LAUNCHER_BOTTOM_EDGE
      : launcherMinimumBottomEdge
    : collapsedMinimumBottomEdge
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

export const getAppGeometry = (position: AppButtonPosition, viewport: ViewportSize, expanded: boolean): AppGeometry => {
  const bounds = getAppButtonDragBounds(viewport, expanded)
  const point = projectAppButtonPosition(position, viewport, expanded)
  const minimumWidth = Math.max(APP_SHELL_MINIMUM_SIZE, viewport.width / 6)
  const maximumWidth = Math.max(Math.min(APP_SHELL_MAXIMUM_WIDTH, viewport.width / 3), APP_SHELL_MINIMUM_SIZE)
  const height = Math.max(
    APP_SHELL_MINIMUM_SIZE,
    Math.min(APP_SHELL_MAXIMUM_HEIGHT, point.y - APP_BUTTON_RADIUS - APP_SHELL_TOP_INSET)
  )
  const isOnRightSide = point.x >= viewport.width / 2

  return {
    point,
    bounds,
    launcher: {
      size: APP_BUTTON_SIZE
    },
    shell: {
      minimumWidth,
      maximumWidth,
      isOnRightSide
    },
    style: {
      '--webchat-launcher-left': `${point.x}px`,
      '--webchat-launcher-bottom': `${viewport.height - point.y}px`,
      '--webchat-shell-bottom-offset': `${APP_BUTTON_RADIUS}px`,
      '--webchat-shell-height': `${height}px`,
      '--webchat-shell-translate-x': isOnRightSide ? '-100%' : '0%'
    }
  }
}

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
