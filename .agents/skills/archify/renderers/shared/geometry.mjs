// Geometry helpers shared by all typed renderers. Every function here is
// pure; renderers own their layout tables and pass measured rects
// ({x, y, width, height, cx, cy}) in.

// In degraded mode (no ajv) a type-wrong top-level field reaches the renderer.
// Coerce non-arrays to [] so the module-level Maps build without throwing and
// the friendly validator checks (which run later) report the real problem.
export function asArray(value) {
  return Array.isArray(value) ? value : []
}

// A computed coordinate must be a finite number; NaN/undefined would silently
// write `<rect x="NaN">` into the output. Used by the validators as a backstop.
export function isFinitePoint(...coords) {
  return coords.every((c) => Number.isFinite(c))
}

export function rectsOverlap(a, b, gap = 0) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  )
}

export function segmentIntersectsRect(segment, rect, gap = 0) {
  const box = {
    x1: rect.x - gap,
    y1: rect.y - gap,
    x2: rect.x + rect.width + gap,
    y2: rect.y + rect.height + gap
  }
  const [a, b] = [segment.start, segment.end]
  if (pointInBox(a, box) || pointInBox(b, box)) return true
  return (
    segmentsIntersect(a, b, [box.x1, box.y1], [box.x2, box.y1]) ||
    segmentsIntersect(a, b, [box.x2, box.y1], [box.x2, box.y2]) ||
    segmentsIntersect(a, b, [box.x2, box.y2], [box.x1, box.y2]) ||
    segmentsIntersect(a, b, [box.x1, box.y2], [box.x1, box.y1])
  )
}

function pointInBox(point, box) {
  return point[0] >= box.x1 && point[0] <= box.x2 && point[1] >= box.y1 && point[1] <= box.y2
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  if (o1 === 0 && onSegment(a, c, b)) return true
  if (o2 === 0 && onSegment(a, d, b)) return true
  if (o3 === 0 && onSegment(c, a, d)) return true
  if (o4 === 0 && onSegment(c, b, d)) return true

  return o1 !== o2 && o3 !== o4
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
  if (Math.abs(value) < 0.0001) return 0
  return value > 0 ? 1 : 2
}

function onSegment(a, b, c) {
  return (
    b[0] <= Math.max(a[0], c[0]) &&
    b[0] >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) &&
    b[1] >= Math.min(a[1], c[1])
  )
}

export function anchor(rect, side) {
  switch (side) {
    case 'left':
      return [rect.x, rect.cy]
    case 'right':
      return [rect.x + rect.width, rect.cy]
    case 'top':
      return [rect.cx, rect.y]
    case 'bottom':
      return [rect.cx, rect.y + rect.height]
    default:
      return [rect.x + rect.width, rect.cy]
  }
}

export function defaultFromSide(from, to) {
  if (to.cx < from.cx) return 'left'
  if (to.cx > from.cx) return 'right'
  if (to.cy > from.cy) return 'bottom'
  return 'top'
}

export function defaultToSide(from, to) {
  if (to.cx < from.cx) return 'right'
  if (to.cx > from.cx) return 'left'
  if (to.cy > from.cy) return 'top'
  return 'bottom'
}

export function chosenSide(side, fallback) {
  return side && side !== 'auto' ? side : fallback
}

export function polylinePath(points) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

export function roundedPath(points, radius) {
  if (points.length < 3 || radius <= 0) {
    return polylinePath(points)
  }

  const interior = points.slice(1, -1).flatMap((point, index) => {
    const i = index + 1
    const [px, py] = points[i - 1]
    const [cx, cy] = point
    const [nx, ny] = points[i + 1]
    const prevLen = Math.hypot(cx - px, cy - py)
    const nextLen = Math.hypot(nx - cx, ny - cy)
    const r = Math.min(radius, prevLen / 2, nextLen / 2)
    if (r < 1) {
      return [`L ${cx} ${cy}`]
    }
    const before = [cx - ((cx - px) / prevLen) * r, cy - ((cy - py) / prevLen) * r]
    const after = [cx + ((nx - cx) / nextLen) * r, cy + ((ny - cy) / nextLen) * r]
    return [`L ${before[0]} ${before[1]}`, `Q ${cx} ${cy} ${after[0]} ${after[1]}`]
  })
  const [endX, endY] = points[points.length - 1]
  return [`M ${points[0][0]} ${points[0][1]}`, ...interior, `L ${endX} ${endY}`].join(' ')
}

// Shared by edges/flows/transitions: all carry the same optional
// labelAt/labelDx/labelDy/labelSegment knobs.
export function labelPoint(item, points) {
  if (item.labelAt) return item.labelAt
  if (points.length === 2) {
    return [(points[0][0] + points[1][0]) / 2 + (item.labelDx || 0), points[0][1] - 10 + (item.labelDy || 0)]
  }
  const segmentIndex = Math.min(points.length - 2, Math.max(0, item.labelSegment ?? 1))
  const a = points[segmentIndex]
  const b = points[segmentIndex + 1]
  return [(a[0] + b[0]) / 2 + (item.labelDx || 0), (a[1] + b[1]) / 2 - 10 + (item.labelDy || 0)]
}

export const componentFill = {
  frontend: 'c-frontend',
  backend: 'c-backend',
  database: 'c-database',
  cloud: 'c-cloud',
  security: 'c-security',
  messagebus: 'c-messagebus',
  external: 'c-external'
}

export const componentText = {
  frontend: 't-frontend',
  backend: 't-backend',
  database: 't-database',
  cloud: 't-cloud',
  security: 't-security',
  messagebus: 't-messagebus',
  external: 't-external'
}

export const arrowClassMap = {
  default: ['a-default', 'arrowhead'],
  emphasis: ['a-emphasis', 'arrowhead-emphasis'],
  security: ['a-security', 'arrowhead-security'],
  dashed: ['a-dashed', 'arrowhead-dashed']
}

// Label accent per edge variant. Workflow colors dashed (async trace) labels
// like the trace store it points at; the other renderers use the bus color.
export function variantAccent(variant, { dashed = 't-messagebus' } = {}) {
  return variant === 'security'
    ? 't-security'
    : variant === 'emphasis'
      ? 't-backend'
      : variant === 'dashed'
        ? dashed
        : 't-muted'
}

export function formatRect(r) {
  return `[${Math.round(r.x)}, ${Math.round(r.y)}, ${Math.round(r.width)}, ${Math.round(r.height)}]`
}

function formatDelta(n) {
  const v = Math.round(n)
  return v >= 0 ? `+${v}` : String(v)
}

/** Actionable hint when an edge label rect hits a node/component box (#7). */
export function suggestLabelObstacleFix(labelRect, lx, ly, obstacle, obstacleKind = 'component') {
  const lxR = Math.round(lx)
  const lyR = Math.round(ly)
  const belowY = Math.round(obstacle.y + obstacle.height + 14)
  const aboveY = Math.round(obstacle.y - 4)
  return [
    `  label rect: ${formatRect(labelRect)}`,
    `  ${obstacleKind} "${obstacle.id}" rect: ${formatRect(obstacle)}`,
    `  Suggested fix: labelAt [${lxR}, ${belowY}] or labelDy ${formatDelta(belowY - lyR)} (below); or labelAt [${lxR}, ${aboveY}] or labelDy ${formatDelta(aboveY - lyR)} (above)`
  ].join('\n')
}

/** Hint when two edge labels collide. */
export function suggestLabelPairFix(a, b) {
  return [
    `  "${a.label}" ${formatRect(a)}; "${b.label}" ${formatRect(b)}`,
    '  Suggested fix: add labelDy +24 on one edge, adjust labelDx, or remove one label'
  ].join('\n')
}

/** Hint when two components/nodes are too close. */
export function suggestComponentSeparation(a, b, minGap = 8) {
  const rightX = Math.round(a.x + a.width + minGap)
  const belowY = Math.round(a.y + a.height + minGap)
  return [
    `  "${a.id}" ${formatRect(a)}; "${b.id}" ${formatRect(b)}`,
    `  Suggested fix: move "${b.id}" pos to [${rightX}, ${Math.round(b.y)}] (right of "${a.id}") or [${Math.round(b.x)}, ${belowY}] (below)`
  ].join('\n')
}
