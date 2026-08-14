import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs'
import { animateAttr, loadDiagram, writeDiagram, svgRootAttrs } from '../shared/cli.mjs'
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
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
  diagram: dataflow,
  template,
  outPath
} = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'dataflow',
  defaultExample: 'product-analytics.dataflow.json'
})

const viewBox = dataflow.meta?.viewBox || [940, 720]
const layout = {
  stageY: 46,
  stageH: 36,
  stageBottomPad: 74,
  leftX: 100,
  colGap: 215,
  stageW: 168,
  nodeW: 112,
  nodeH: 58,
  rowYs: [128, 242, 356, 470, 584],
  labelH: 16
}

function stageX(index) {
  return layout.leftX + index * layout.colGap
}

function measureNode(node) {
  const width = node.width || layout.nodeW
  const height = node.height || layout.nodeH
  const cx = stageX(node.stage)
  const y = layout.rowYs[node.row] + (node.yOffset || 0)
  return {
    ...node,
    width,
    height,
    cx,
    cy: y + height / 2,
    x: cx - width / 2,
    y
  }
}

const nodes = new Map(asArray(dataflow.nodes).map((node) => [node.id, measureNode(node)]))
// Node steps are derived from flows first, then from remaining nodes: a non-mutating fold
// keeps each step assignment visible to the next entry without owner-style side effects.
const nodeSteps = asArray(dataflow.nodes).reduce(
  (steps, node, index) => {
    if (steps.has(node.id)) return steps
    const next = new Map(steps)
    next.set(node.id, index)
    return next
  },
  asArray(dataflow.flows).reduce((steps, flow, index) => {
    const next = new Map(steps)
    if (!steps.has(flow.from)) next.set(flow.from, index)
    if (!steps.has(flow.to)) next.set(flow.to, index + 1)
    return next
  }, new Map())
)

function validateDataflow() {
  const problems = [
    ...(dataflow.schema_version !== 1 ? ['Data-flow files must set "schema_version": 1.'] : []),
    ...(dataflow.diagram_type !== 'dataflow' ? ['Data-flow files must set "diagram_type": "dataflow".'] : []),
    ...(!dataflow.meta?.title ? ['Data-flow files must include meta.title.'] : []),
    ...(!Array.isArray(dataflow.stages) || dataflow.stages.length < 2
      ? ['Data-flow diagrams need at least two stages.']
      : []),
    ...(!Array.isArray(dataflow.nodes) || dataflow.nodes.length < 2
      ? ['Data-flow diagrams need at least two nodes.']
      : []),
    ...(!Array.isArray(dataflow.flows) ? ['Data-flow diagrams must include a flows array.'] : []),
    ...(dataflow.cards !== undefined && !Array.isArray(dataflow.cards) ? ['Data-flow "cards" must be an array.'] : []),
    ...(nodes.size !== asArray(dataflow.nodes).length ? ['Node ids must be unique.'] : [])
  ]

  const stageCount = asArray(dataflow.stages).length
  const nodeProblems = [...nodes.values()].reduce((acc, node) => {
    const local = []
    if (typeof node.stage !== 'number' || node.stage < 0 || node.stage >= stageCount) {
      local.push(`Node "${node.id}" uses invalid stage ${node.stage} — valid stages are 0..${stageCount - 1}.`)
    }
    if (typeof node.row !== 'number' || node.row < 0 || node.row >= layout.rowYs.length) {
      local.push(`Node "${node.id}" uses invalid row ${node.row} — valid rows are 0..${layout.rowYs.length - 1}.`)
    }
    if (!isFinitePoint(node.x, node.y, node.cx, node.cy)) {
      local.push(
        `Node "${node.id}" produced non-finite coordinates — check stage, row, width, height, and yOffset are numbers.`
      )
      return [...acc, ...local]
    }
    if (node.x < 24 || node.x + node.width > viewBox[0] - 24) {
      local.push(
        `Node "${node.id}" exceeds the horizontal bounds of the viewBox — reduce node.width or increase meta.viewBox[0].`
      )
    }
    if (node.y < layout.stageY + layout.stageH + 22 || node.y + node.height > viewBox[1] - layout.stageBottomPad) {
      local.push(
        `Node "${node.id}" exceeds the readable diagram area — keep y between ${layout.stageY + layout.stageH + 22} and ${viewBox[1] - layout.stageBottomPad} (adjust row/yOffset or increase meta.viewBox[1]).`
      )
    }
    const estLabelW = textUnits(node.label) * 6.2
    if (estLabelW > node.width + 6) {
      local.push(
        `Label "${node.label}" (~${Math.round(estLabelW)}px) is wider than node "${node.id}" (${node.width}px) — shorten the label, move detail to sublabel, or increase node.width.`
      )
    }
    return [...acc, ...local]
  }, [])
  problems.push(...nodeProblems)

  const nodeList = asArray(dataflow.nodes)
  const pairProblems = nodeList.flatMap((nodeA, i) =>
    nodeList.slice(i + 1).flatMap((nodeB) => {
      const a = nodes.get(nodeA.id)
      const b = nodes.get(nodeB.id)
      return rectsOverlap(a, b, 10)
        ? [`Nodes "${a.id}" and "${b.id}" are less than 10px apart — move one to another stage/row or adjust yOffset.`]
        : []
    })
  )
  problems.push(...pairProblems)

  const flowProblems = asArray(dataflow.flows).flatMap((flow) => {
    const local = []
    if (!nodes.has(flow.from)) local.push(`Flow "${flow.label || flow.from}" references unknown source "${flow.from}".`)
    if (!nodes.has(flow.to)) local.push(`Flow "${flow.label || flow.to}" references unknown target "${flow.to}".`)
    if (!flow.label) local.push(`Flow "${flow.from}" -> "${flow.to}" must include a short data label.`)
    if (nodes.has(flow.from) && nodes.has(flow.to)) {
      const routed = pathFor(flow)
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]]
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1])
      if (distance < 34)
        local.push(
          `Flow "${flow.label}" is too short (${Math.round(distance)}px; minimum 34px) — route it through a channel or spread its nodes.`
        )
    }
    return local
  })
  problems.push(...flowProblems)

  const labelRects = asArray(dataflow.flows)
    .filter((flow) => flow.label && nodes.has(flow.from) && nodes.has(flow.to))
    .map((flow) => {
      const [lx, ly] = labelPoint(flow, pathFor(flow).points)
      const longestLine = Math.max(textUnits(flow.label), textUnits(flow.classification || ''))
      const width = Math.max(34, longestLine * 4.9 + 12)
      const height = flow.classification ? 27 : layout.labelH
      return { label: flow.label, x: lx - width / 2, y: ly - 11, width, height, lx, ly }
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
              `Labels "${rectA.label}" and "${rectB.label}" overlap — adjust labelDx/labelDy.\n${suggestLabelPairFix(rectA, rectB)}`
            ]
          : []
      )
  )
  problems.push(...labelPairProblems)

  const lastStageX = stageX(asArray(dataflow.stages).length - 1)
  if (lastStageX + layout.stageW / 2 > viewBox[0] - 24) {
    problems.push(
      `Stages exceed viewBox width — set meta.viewBox[0] to at least ${Math.ceil(lastStageX + layout.stageW / 2 + 24)}.`
    )
  }

  if (problems.length) {
    throw new Error(`Data-flow layout validation failed:\n- ${problems.join('\n- ')}`)
  }
}

function routeVia(flow, from, to, start, end) {
  if (flow.via) return flow.via
  switch (flow.route || 'auto') {
    case 'straight':
      return []
    case 'vertical-channel': {
      const x = flow.channelX ?? start[0] + (end[0] > start[0] ? 44 : -44)
      return [
        [x, start[1]],
        [x, end[1]]
      ]
    }
    case 'bottom-channel': {
      const y = flow.channelY ?? Math.max(from.y + from.height, to.y + to.height) + 26
      return [
        [start[0], y],
        [end[0], y]
      ]
    }
    case 'top-channel': {
      const y = flow.channelY ?? Math.min(from.y, to.y) - 24
      return [
        [start[0], y],
        [end[0], y]
      ]
    }
    case 'auto':
    default: {
      if (Math.abs(start[1] - end[1]) < 4) return []
      const midX = start[0] + (end[0] - start[0]) / 2
      return [
        [midX, start[1]],
        [midX, end[1]]
      ]
    }
  }
}

const pathCache = new Map()

function pathFor(flow) {
  if (pathCache.has(flow)) return pathCache.get(flow)
  const from = nodes.get(flow.from)
  const to = nodes.get(flow.to)
  const start = anchor(from, chosenSide(flow.fromSide, defaultFromSide(from, to)))
  const end = anchor(to, chosenSide(flow.toSide, defaultToSide(from, to)))
  const points = [start, ...routeVia(flow, from, to, start, end), end]
  const routed = { d: polylinePath(points), points }
  pathCache.set(flow, routed)
  return routed
}

function renderStage(stage, index) {
  const cx = stageX(index)
  const x = cx - layout.stageW / 2
  const h = viewBox[1] - layout.stageY - layout.stageBottomPad
  return `        <rect x="${x}" y="${layout.stageY}" width="${layout.stageW}" height="${h}" rx="10" class="c-lane" stroke-width="1"/>
        <text x="${cx}" y="${layout.stageY + 22}" class="t-dim" font-size="9" font-weight="600" text-anchor="middle">${String(index + 1).padStart(2, '0')} / ${esc(stage.label)}</text>`
}

function renderNode(node) {
  const fill = componentFill[node.type] || 'c-external'
  const accent = componentText[node.type] || 't-muted'
  const tag = node.tag
    ? `\n        <text x="${node.cx}" y="${node.y + node.height - 11}" class="${accent}" font-size="7" text-anchor="middle">${esc(node.tag)}</text>`
    : ''
  return `        <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
        <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}"${animateAttr(dataflow.meta, 'node', nodeSteps.get(node.id))} stroke-width="1.5"/>
        <text x="${node.cx}" y="${node.y + 21}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle">${esc(node.label)}</text>
        <text x="${node.cx}" y="${node.y + 37}" class="t-muted" font-size="7" text-anchor="middle">${esc(node.sublabel || '')}</text>${tag}`
}

function renderFlowPath(flow, index) {
  const [cls, marker] = arrowClassMap[flow.variant || 'default'] || arrowClassMap.default
  const routed = pathFor(flow)
  const strokeWidth = flow.width || (flow.variant === 'emphasis' ? 1.8 : 1.4)
  return `        <path d="${routed.d}" class="${cls}"${animateAttr(dataflow.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`
}

function renderFlowLabel(flow) {
  const routed = pathFor(flow)
  const [lx, ly] = labelPoint(flow, routed.points)
  const longestLine = Math.max(textUnits(flow.label), textUnits(flow.classification || ''))
  const labelW = Math.max(34, longestLine * 4.9 + 12)
  const classification = flow.classification
    ? `\n        <text x="${lx}" y="${ly + 11}" class="t-dim" font-size="7" text-anchor="middle">${esc(flow.classification)}</text>`
    : ''
  const labelH = flow.classification ? 27 : layout.labelH
  return `        <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
        <text x="${lx}" y="${ly}" class="${variantAccent(flow.variant)}" font-size="8" text-anchor="middle">${esc(flow.label)}</text>${classification}`
}

function renderLegend() {
  const y = viewBox[1] - 36
  return `        <text x="214" y="${y - 20}" class="t-primary" font-size="10" font-weight="600">Legend</text>
        <path d="M 214 ${y} L 248 ${y}" class="a-emphasis" stroke-width="1.8" marker-end="url(#arrowhead-emphasis)"/>
        <text x="257" y="${y + 3}" class="t-muted" font-size="8">primary data</text>
        <path d="M 340 ${y} L 374 ${y}" class="a-security" stroke-width="1.4" marker-end="url(#arrowhead-security)"/>
        <text x="383" y="${y + 3}" class="t-muted" font-size="8">policy / PII</text>
        <path d="M 480 ${y} L 514 ${y}" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>
        <text x="523" y="${y + 3}" class="t-muted" font-size="8">async batch</text>
        <rect x="625" y="${y - 8}" width="14" height="9" rx="2" class="c-database" stroke-width="1"/>
        <text x="646" y="${y}" class="t-muted" font-size="8">data store</text>`
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(dataflow.meta, 'data-flow diagram')}>
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Data Stages -->
${dataflow.stages.map(renderStage).join('\n\n')}

        <!-- Flow paths -->
${asArray(dataflow.flows).map(renderFlowPath).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Flow labels -->
${asArray(dataflow.flows).map(renderFlowLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`
}

validateDataflow()
writeDiagram({
  outPath,
  template,
  meta: dataflow.meta,
  footerLabel: 'Data-flow diagram',
  svg: renderSvg(),
  cards: dataflow.cards
})
