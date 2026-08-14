import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs'
import { animateAttr, loadDiagram, writeDiagram, svgRootAttrs } from '../shared/cli.mjs'
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  segmentIntersectsRect,
  suggestLabelObstacleFix,
  suggestLabelPairFix,
  anchor,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  polylinePath,
  labelPoint,
  componentFill,
  componentText,
  arrowClassMap,
  variantAccent
} from '../shared/geometry.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const {
  diagram: workflow,
  template,
  outPath
} = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'workflow',
  defaultExample: 'agent-tool-call.workflow.json'
})

const layout = {
  laneX: 40,
  laneY: 52,
  laneW: 640,
  laneH: 104,
  laneGap: 20,
  laneTitleH: 30,
  colXs: [88, 220, 300, 430, 500, 625],
  nodeW: 92,
  nodeH: 52
}

// Content is 680px wide (laneX + laneW); auto height fits the lanes plus legend.
const autoHeight =
  layout.laneY +
  (workflow.lanes?.length || 1) * layout.laneH +
  ((workflow.lanes?.length || 1) - 1) * layout.laneGap +
  124
const viewBox = workflow.meta?.viewBox || [720, autoHeight]

const laneIndex = new Map(asArray(workflow.lanes).map((lane, index) => [lane.id, index]))

function laneTop(id) {
  return layout.laneY + laneIndex.get(id) * (layout.laneH + layout.laneGap)
}

function lastLaneBottom() {
  return layout.laneY + workflow.lanes.length * layout.laneH + (workflow.lanes.length - 1) * layout.laneGap
}

function legendY() {
  return lastLaneBottom() + 44
}

function measureNode(node) {
  const width = node.width || layout.nodeW
  const height = node.height || (node.tag ? 68 : layout.nodeH)
  const cx = layout.colXs[node.col]
  const contentH = layout.laneH - layout.laneTitleH
  const y = laneTop(node.lane) + layout.laneTitleH + (contentH - height) / 2 + (node.yOffset || 0)
  return {
    ...node,
    width,
    height,
    x: cx - width / 2,
    y,
    cx,
    cy: y + height / 2
  }
}

const nodes = new Map(asArray(workflow.nodes).map((node) => [node.id, measureNode(node)]))

const mainPathSteps = new Map(asArray(workflow.mainPath).map((id, index) => [id, index]))
const edgeSteps = new Map(
  asArray(workflow.edges).map((edge, index) => {
    const fromStep = mainPathSteps.get(edge.from)
    const toStep = mainPathSteps.get(edge.to)
    const mainStep = Number.isInteger(fromStep) && toStep === fromStep + 1 ? fromStep : null
    return [edge, mainStep ?? asArray(workflow.mainPath).length + index]
  })
)

function nodeStep(node) {
  return (
    mainPathSteps.get(node.id) ??
    asArray(workflow.mainPath).length + asArray(workflow.nodes).findIndex((item) => item.id === node.id)
  )
}

function validateWorkflow() {
  const problems = []
  if (workflow.schema_version !== 1) {
    problems.push('Workflow files must set "schema_version": 1.')
  }
  if (workflow.diagram_type !== 'workflow') {
    problems.push(`Unsupported diagram_type "${workflow.diagram_type}". Expected "workflow".`)
  }
  if (!workflow.meta || !workflow.meta.title) {
    problems.push('Workflow files must include meta.title.')
  }
  if (!Array.isArray(workflow.lanes) || !workflow.lanes.length) {
    problems.push('Workflow files must include at least one lane.')
  }
  if (!Array.isArray(workflow.nodes)) {
    problems.push('Workflow files must include a nodes array.')
  }
  if (!Array.isArray(workflow.edges)) {
    problems.push('Workflow files must include an edges array.')
  }
  if (workflow.phases !== undefined && !Array.isArray(workflow.phases)) {
    problems.push('Workflow "phases" must be an array.')
  }
  if (workflow.groups !== undefined && !Array.isArray(workflow.groups)) {
    problems.push('Workflow "groups" must be an array.')
  }
  if (workflow.mainPath !== undefined && !Array.isArray(workflow.mainPath)) {
    problems.push('Workflow "mainPath" must be an array of node ids.')
  }
  if (workflow.cards !== undefined && !Array.isArray(workflow.cards)) {
    problems.push('Workflow "cards" must be an array.')
  }
  if (problems.length) {
    throw new Error(`Workflow layout validation failed:\n- ${problems.join('\n- ')}`)
  }

  const laneIds = new Set(workflow.lanes.map((lane) => lane.id))
  if (laneIds.size !== workflow.lanes.length) {
    problems.push('Lane ids must be unique.')
  }
  if (nodes.size !== workflow.nodes.length) {
    problems.push('Node ids must be unique.')
  }
  const phaseIds = new Set(asArray(workflow.phases).map((phase) => phase.id))
  if (phaseIds.size !== asArray(workflow.phases).length) {
    problems.push('Phase ids must be unique.')
  }
  const groupIds = new Set(asArray(workflow.groups).map((group) => group.id))
  if (groupIds.size !== asArray(workflow.groups).length) {
    problems.push('Group ids must be unique.')
  }

  const nodeProblems = [...nodes.values()].reduce((acc, node) => {
    if (!laneIds.has(node.lane)) {
      return [...acc, `Node "${node.id}" uses unknown lane "${node.lane}".`]
    }
    if (!Number.isInteger(node.col) || node.col < 0 || node.col >= layout.colXs.length) {
      return [
        ...acc,
        `Node "${node.id}" uses column ${node.col}, but valid columns are integers 0..${layout.colXs.length - 1}.`
      ]
    }
    if (!isFinitePoint(node.x, node.y, node.cx, node.cy)) {
      return [
        ...acc,
        `Node "${node.id}" produced non-finite coordinates — check col, width, height, and yOffset are numbers.`
      ]
    }
    const local = []
    const estLabelW = textUnits(node.label) * 6.8
    if (estLabelW > node.width + 6) {
      local.push(
        `Label "${node.label}" (~${Math.round(estLabelW)}px) is wider than node "${node.id}" (${node.width}px) — shorten the label, move detail to sublabel, or increase node.width.`
      )
    }
    const top = laneTop(node.lane)
    const contentTop = top + layout.laneTitleH
    const laneRight = layout.laneX + layout.laneW
    if (node.x < layout.laneX || node.x + node.width > laneRight) {
      local.push(`Node "${node.id}" exceeds the horizontal bounds of lane "${node.lane}".`)
    }
    if (node.y < contentTop || node.y + node.height > top + layout.laneH) {
      local.push(`Node "${node.id}" collides with the title or boundary of lane "${node.lane}".`)
    }
    return [...acc, ...local]
  }, [])
  problems.push(...nodeProblems)

  const phaseProblems = asArray(workflow.phases).reduce((acc, phase) => {
    if (!Number.isInteger(phase.fromCol) || !Number.isInteger(phase.toCol)) {
      return [...acc, `Phase "${phase.id}" must use integer fromCol/toCol values.`]
    }
    const local = []
    if (phase.fromCol < 0 || phase.toCol >= layout.colXs.length || phase.fromCol > phase.toCol) {
      local.push(
        `Phase "${phase.id}" uses invalid columns ${phase.fromCol}..${phase.toCol}; use an ordered range within 0..${layout.colXs.length - 1}.`
      )
    }
    const estLabelW = textUnits(phase.label) * 5.6
    const width = spanForCols(phase.fromCol, phase.toCol).width
    if (estLabelW > width + 8) {
      local.push(
        `Phase label "${phase.label}" (~${Math.round(estLabelW)}px) is wider than its ${Math.round(width)}px span — shorten the label or widen the phase range.`
      )
    }
    return [...acc, ...local]
  }, [])
  problems.push(...phaseProblems)

  const groupProblems = asArray(workflow.groups).reduce((acc, group) => {
    if (!laneIds.has(group.lane)) {
      return [...acc, `Group "${group.id}" uses unknown lane "${group.lane}".`]
    }
    if (!Number.isInteger(group.fromCol) || !Number.isInteger(group.toCol)) {
      return [...acc, `Group "${group.id}" must use integer fromCol/toCol values.`]
    }
    const local = []
    if (group.fromCol < 0 || group.toCol >= layout.colXs.length || group.fromCol > group.toCol) {
      local.push(
        `Group "${group.id}" uses invalid columns ${group.fromCol}..${group.toCol}; use an ordered range within 0..${layout.colXs.length - 1}.`
      )
    }
    const contained = [...nodes.values()].some(
      (node) => node.lane === group.lane && node.col >= group.fromCol && node.col <= group.toCol
    )
    if (!contained) {
      local.push(
        `Group "${group.id}" does not contain any nodes — align its lane/columns with the parallel or branch work it frames.`
      )
    }
    return [...acc, ...local]
  }, [])
  problems.push(...groupProblems)

  // Nodes are grouped per lane with a non-mutating fold, then pairs within each lane are
  // checked with nested flatMaps — both are result derivations, not owner-side effects.
  const byLane = [...nodes.values()].reduce((acc, node) => {
    const next = new Map(acc)
    next.set(node.lane, [...(acc.get(node.lane) || []), node])
    return next
  }, new Map())
  const lanePairProblems = [...byLane.entries()].flatMap(([lane, laneNodes]) =>
    laneNodes.flatMap((nodeA, i) =>
      laneNodes
        .slice(i + 1)
        .flatMap((nodeB) =>
          rectsOverlap(nodeA, nodeB, 8)
            ? [
                `Nodes "${nodeA.id}" and "${nodeB.id}" are less than 8px apart in lane "${lane}" — move one to another col, adjust yOffset, or reduce width/height.`
              ]
            : []
        )
    )
  )
  problems.push(...lanePairProblems)

  const edgeProblems = workflow.edges.flatMap((edge) => {
    const local = []
    if (!nodes.has(edge.from)) local.push(`Edge "${edge.label || edge.from}" references unknown source "${edge.from}".`)
    if (!nodes.has(edge.to)) local.push(`Edge "${edge.label || edge.to}" references unknown target "${edge.to}".`)
    if (nodes.has(edge.from) && nodes.has(edge.to)) {
      const routed = pathFor(edge)
      if (routed.points.length === 2) {
        const [start, end] = routed.points
        const segmentLength = Math.hypot(end[0] - start[0], end[1] - start[1])
        if (segmentLength < 28) {
          local.push(
            `Edge "${edge.from}" -> "${edge.to}" is too short (${Math.round(segmentLength)}px; minimum 28px) — drop its label or route it through a channel.`
          )
        }
      }
      const segments = routed.points.slice(1).map((_point, index) => ({
        start: routed.points[index],
        end: routed.points[index + 1]
      }))
      const crossingProblems = [...nodes.values()].flatMap((node) =>
        node.id === edge.from || node.id === edge.to
          ? []
          : segments.some((segment) => segmentIntersectsRect(segment, node, 2))
            ? [
                `Edge "${edge.from}" -> "${edge.to}" crosses node "${node.id}" — adjust fromSide/toSide, route it through a channel, or move one node to a clearer lane/column.`
              ]
            : []
      )
      local.push(...crossingProblems)
    }
    return local
  })
  problems.push(...edgeProblems)

  if (Array.isArray(workflow.mainPath)) {
    const unknownStepProblems = workflow.mainPath.flatMap((id) =>
      nodes.has(id) ? [] : [`mainPath references unknown node "${id}".`]
    )
    problems.push(...unknownStepProblems)
    // Adjacent mainPath steps are paired with a pure zip and validated as a fold: each pair
    // contributes its own problems without mutating the shared list.
    const stepPairProblems = workflow.mainPath
      .slice(0, -1)
      .map((fromId, i) => [fromId, workflow.mainPath[i + 1]])
      .flatMap(([fromId, toId]) => {
        const from = nodes.get(fromId)
        const to = nodes.get(toId)
        if (!from || !to) return []
        const local = []
        const linked = workflow.edges.some((edge) => edge.from === fromId && edge.to === toId)
        if (!linked) {
          local.push(
            `mainPath step "${fromId}" -> "${toId}" has no matching edge — add the edge or remove the pair from mainPath.`
          )
        }
        if (to.col < from.col) {
          local.push(
            `mainPath step "${fromId}" -> "${toId}" moves backward from col ${from.col} to ${to.col} — use a return edge outside mainPath for loops.`
          )
        }
        return local
      })
    problems.push(...stepPairProblems)
  }

  const labelRects = workflow.edges
    .filter((edge) => edge.label && nodes.has(edge.from) && nodes.has(edge.to))
    .map((edge) => {
      const [lx, ly] = labelPoint(edge, pathFor(edge).points)
      const width = Math.max(30, textUnits(edge.label) * 4.8 + 10)
      return { label: edge.label, x: lx - width / 2, y: ly - 10, width, height: 14, lx, ly }
    })
  const labelNodeProblems = labelRects.flatMap((rect) =>
    [...nodes.values()].flatMap((node) =>
      rectsOverlap(rect, node, -2)
        ? [
            `Label "${rect.label}" overlaps node "${node.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, node, 'node')}`
          ]
        : []
    )
  )
  problems.push(...labelNodeProblems)
  const labelPairProblems = labelRects.flatMap((rectA, i) =>
    labelRects
      .slice(i + 1)
      .flatMap((rectB) =>
        rectsOverlap(rectA, rectB, -2)
          ? [
              `Labels "${rectA.label}" and "${rectB.label}" overlap — adjust labelDx/labelDy or remove one label.\n${suggestLabelPairFix(rectA, rectB)}`
            ]
          : []
      )
  )
  problems.push(...labelPairProblems)

  if (viewBox[0] < layout.laneX + layout.laneW + 16) {
    problems.push(
      `viewBox width ${viewBox[0]} clips the ${layout.laneW}px lanes — set meta.viewBox[0] to at least ${layout.laneX + layout.laneW + 16}.`
    )
  }
  if (legendY() + 18 > viewBox[1]) {
    problems.push(`Legend exceeds viewBox height ${viewBox[1]} — set meta.viewBox[1] to at least ${legendY() + 18}.`)
  }

  if (problems.length) {
    throw new Error(`Workflow layout validation failed:\n- ${problems.join('\n- ')}`)
  }
}

function gapYBetween(fromLane, toLane, bias = 0.5) {
  const a = laneTop(fromLane) + layout.laneH
  const b = laneTop(toLane)
  return a + (b - a) * bias
}

function spanForCols(fromCol, toCol, pad = 46) {
  const start = layout.colXs[fromCol] - pad
  const end = layout.colXs[toCol] + pad
  return { x: start, width: end - start, cx: (start + end) / 2 }
}

function sameLaneAutoVia(start, end) {
  if (start[0] === end[0] || start[1] === end[1]) return []
  const midX = (start[0] + end[0]) / 2
  return [
    [midX, start[1]],
    [midX, end[1]]
  ]
}

function routeVia(edge, from, to, start, end) {
  if (edge.via) return edge.via
  switch (edge.route || 'auto') {
    case 'straight':
      return []
    case 'drop': {
      const y = gapYBetween(from.lane, to.lane, edge.bias ?? 0.5)
      return [
        [start[0], y],
        [end[0], y]
      ]
    }
    case 'outside-right': {
      const x = edge.channelX ?? layout.laneX + layout.laneW + 12
      return [
        [x, start[1]],
        [x, end[1]]
      ]
    }
    case 'return-left': {
      const x = edge.channelX ?? Math.min(from.x, to.x) - 28
      return [
        [x, start[1]],
        [x, end[1]]
      ]
    }
    case 'bottom-channel': {
      const y = edge.channelY ?? Math.max(from.y + from.height, to.y + to.height) + 32
      return [
        [start[0], y],
        [end[0], y]
      ]
    }
    case 'up-channel': {
      const y = edge.channelY ?? Math.min(from.y, to.y) - 28
      return [
        [start[0], y],
        [end[0], y]
      ]
    }
    case 'auto':
    default: {
      if (from.lane === to.lane) return sameLaneAutoVia(start, end)
      const y = gapYBetween(from.lane, to.lane, edge.bias ?? 0.5)
      return [
        [start[0], y],
        [end[0], y]
      ]
    }
  }
}

function computeRoute(edge) {
  const from = nodes.get(edge.from)
  const to = nodes.get(edge.to)
  const start = anchor(from, chosenSide(edge.fromSide, defaultFromSide(from, to)))
  const end = anchor(to, chosenSide(edge.toSide, defaultToSide(from, to)))
  const points = [start, ...routeVia(edge, from, to, start, end), end]
  return { d: polylinePath(points), points }
}

// Routes are precomputed once as a fresh result map over the items whose endpoints exist —
// the same set the lazy cache would have computed — and every lookup is a pure read.
const routes = new Map(
  workflow.edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)).map((edge) => [edge, computeRoute(edge)])
)

function pathFor(edge) {
  return routes.get(edge)
}

function renderLane(lane, index) {
  const y = layout.laneY + index * (layout.laneH + layout.laneGap)
  const exception =
    lane.variant === 'exception'
      ? `\n        <rect x="${layout.laneX + 6}" y="${y + 6}" width="${layout.laneW - 12}" height="${layout.laneH - 12}" rx="8" class="c-security-group" stroke-width="1"/>`
      : ''
  const labelClass = lane.variant === 'exception' ? 't-security' : 't-dim'
  const prefix = lane.variant === 'exception' ? 'EX' : String(index + 1).padStart(2, '0')
  return `        <rect x="${layout.laneX}" y="${y}" width="${layout.laneW}" height="${layout.laneH}" rx="10" class="c-lane" stroke-width="1"/>${exception}
        <text x="${layout.laneX + 14}" y="${y + 22}" class="${labelClass}" font-size="10" font-weight="600">${prefix} / ${esc(lane.label)}</text>`
}

function renderPhase(phase) {
  const span = spanForCols(phase.fromCol, phase.toCol, 46)
  const accent = variantAccent(phase.variant)
  const [lineClass] = arrowClassMap[phase.variant || 'default'] || arrowClassMap.default
  return `        <line x1="${span.x}" y1="35" x2="${span.x + span.width}" y2="35" class="${lineClass}" stroke-width="1.1"/>
        <rect x="${span.x}" y="27" width="${span.width}" height="16" rx="4" class="c-mask"/>
        <text x="${span.cx}" y="39" class="${accent}" font-size="8" font-weight="600" text-anchor="middle">${esc(phase.label)}</text>`
}

function renderGroup(group) {
  const span = spanForCols(group.fromCol, group.toCol, 50)
  const y = laneTop(group.lane) + layout.laneTitleH + 8
  const height = layout.laneH - layout.laneTitleH - 16
  const cls = group.variant === 'security' ? 'c-security-group' : 'c-lane'
  const textClass = variantAccent(group.variant)
  return `        <rect x="${span.x}" y="${y}" width="${span.width}" height="${height}" rx="9" class="${cls}" stroke-width="1"/>
        <text x="${span.x + 10}" y="${y + 14}" class="${textClass}" font-size="7" font-weight="600">${esc(group.label)}</text>`
}

function renderNode(node) {
  const fill = componentFill[node.type] || 'c-external'
  const accent = componentText[node.type] || 't-muted'
  const tag = node.tag
    ? `\n        <text x="${node.cx}" y="${node.y + node.height - 12}" class="${accent}" font-size="7" text-anchor="middle">${esc(node.tag)}</text>`
    : ''
  return `        <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
        <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}"${animateAttr(workflow.meta, 'node', nodeStep(node))} stroke-width="1.5"/>
        <text x="${node.cx}" y="${node.y + 21}" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">${esc(node.label)}</text>
        <text x="${node.cx}" y="${node.y + 38}" class="t-muted" font-size="8" text-anchor="middle">${esc(node.sublabel || '')}</text>${tag}`
}

function renderEdgePath(edge) {
  const [cls, marker] = arrowClassMap[edge.variant || 'default'] || arrowClassMap.default
  const routed = pathFor(edge)
  const strokeWidth = edge.width || (edge.variant === 'emphasis' ? 1.8 : 1.4)
  return `        <path d="${routed.d}" class="${cls}"${animateAttr(workflow.meta, 'edge', edgeSteps.get(edge))} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`
}

function renderEdgeLabel(edge) {
  if (!edge.label) return ''
  const routed = pathFor(edge)
  const [lx, ly] = labelPoint(edge, routed.points)
  const labelW = Math.max(30, textUnits(edge.label) * 4.8 + 10)
  return `        <rect x="${lx - labelW / 2}" y="${ly - 10}" width="${labelW}" height="14" rx="3" class="c-mask"/>
        <text x="${lx}" y="${ly}" class="${variantAccent(edge.variant, { dashed: 't-database' })}" font-size="8" text-anchor="middle">${esc(edge.label)}</text>`
}

function renderLegend() {
  const y = legendY()
  return `        <text x="175" y="${y - 20}" class="t-primary" font-size="10" font-weight="600">Legend</text>
        <rect x="175" y="${y - 8}" width="14" height="9" rx="2" class="c-frontend" stroke-width="1"/>
        <text x="195" y="${y}" class="t-muted" font-size="7">User UI</text>
        <rect x="260" y="${y - 8}" width="14" height="9" rx="2" class="c-backend" stroke-width="1"/>
        <text x="280" y="${y}" class="t-muted" font-size="7">Agent logic</text>
        <rect x="370" y="${y - 8}" width="14" height="9" rx="2" class="c-security" stroke-width="1"/>
        <text x="390" y="${y}" class="t-muted" font-size="7">Policy</text>
        <rect x="455" y="${y - 8}" width="14" height="9" rx="2" class="c-messagebus" stroke-width="1"/>
        <text x="475" y="${y}" class="t-muted" font-size="7">Tool action</text>
        <rect x="565" y="${y - 8}" width="14" height="9" rx="2" class="c-database" stroke-width="1"/>
        <text x="585" y="${y}" class="t-muted" font-size="7">Context / trace</text>`
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(workflow.meta, 'workflow diagram')}>
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Swimlanes -->
${workflow.lanes.map(renderLane).join('\n\n')}

        <!-- Phase headers -->
${asArray(workflow.phases).map(renderPhase).join('\n')}

        <!-- Workflow groups -->
${asArray(workflow.groups).map(renderGroup).join('\n')}

        <!-- Edge paths -->
${workflow.edges.map((edge) => renderEdgePath(edge)).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Edge labels -->
${workflow.edges.map((edge) => renderEdgeLabel(edge)).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`
}

validateWorkflow()
writeDiagram({
  outPath,
  template,
  meta: workflow.meta,
  footerLabel: 'Workflow diagram',
  svg: renderSvg(),
  cards: workflow.cards
})
