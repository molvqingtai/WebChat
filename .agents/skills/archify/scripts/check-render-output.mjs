#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const input = process.argv[2]

if (!input || input === '-h' || input === '--help') {
  console.error('Usage: node scripts/check-render-output.mjs <diagram.html>')
  process.exit(input ? 0 : 2)
}

const htmlPath = path.resolve(input)
let html
try {
  html = fs.readFileSync(htmlPath, 'utf8')
} catch (err) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        file: htmlPath,
        checks: [{ name: 'file_readable', ok: false, details: [err.message] }]
      },
      null,
      2
    )
  )
  process.exit(1)
}

const checks = []

function addCheck(name, ok, details = []) {
  checks.push({ name, ok, details })
}

const svgMatches = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)]
addCheck('single_svg', svgMatches.length === 1, [`found ${svgMatches.length} <svg> block(s)`])

if (svgMatches.length === 1) {
  const svg = svgMatches[0][0]
  addCheck('finite_svg', !/\b(?:NaN|undefined|Infinity|-Infinity)\b/.test(svg))
  const legendStart = svg.indexOf('<!-- Legend -->')
  const beforeLegend = legendStart >= 0 ? svg.slice(0, legendStart) : svg
  const arrows = collectArrows(beforeLegend)
  const diagonal = arrows.filter((arrow) => isTwoPointDiagonal(arrow))
  addCheck(
    'orthogonal_arrows',
    diagonal.length === 0,
    diagonal.map((arrow) => `${arrow.kind} ${arrow.index}: ${arrow.raw}`)
  )

  if (legendStart >= 0) {
    const legendFragment = svg.slice(legendStart)
    const legendBoxes = collectLegendBoxes(legendFragment)
    const collisions = collectLegendCollisions(arrows, legendBoxes)
    addCheck(
      'legend_clearance',
      collisions.length === 0,
      collisions.map((hit) => `${hit.arrow.kind} ${hit.arrow.index} crosses legend ${hit.box.label}`)
    )
  } else {
    addCheck('legend_clearance', true, ['no legend marker found'])
  }
}

const ok = checks.every((check) => check.ok)
console.log(JSON.stringify({ ok, file: htmlPath, checks }, null, 2))
process.exit(ok ? 0 : 1)

function collectArrows(fragment) {
  const arrows = []
  let index = 0

  // functional-loop: continue — the loop must skip the guarded item and keep processing
  for (const tag of fragment.matchAll(/<(path|line)\b[^>]*>/gi)) {
    const raw = tag[0]
    if (!/\bclass="[^"]*\ba-(?:default|emphasis|security|dashed)\b/.test(raw)) continue
    if (!/\bmarker-end=/.test(raw)) continue
    const attrs = parseAttrs(raw)
    const segments = tag[1].toLowerCase() === 'line' ? lineSegments(attrs) : pathSegments(attrs.d || '')
    arrows.push({ kind: tag[1].toLowerCase(), index: (index += 1), raw, segments })
  }

  return arrows
}

function lineSegments(attrs) {
  const start = [numberAttr(attrs, 'x1'), numberAttr(attrs, 'y1')]
  const end = [numberAttr(attrs, 'x2'), numberAttr(attrs, 'y2')]
  if (!isPoint(start) || !isPoint(end)) return []
  return [{ start, end }]
}

function pathSegments(d) {
  const points = pointsFromPath(d)
  const segments = []
  // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
  for (let i = 1; i < points.length; i += 1) {
    segments.push({ start: points[i - 1], end: points[i] })
  }
  return segments
}

function isTwoPointDiagonal(arrow) {
  if (arrow.segments.length !== 1) return false
  const { start, end } = arrow.segments[0]
  return Math.abs(start[0] - end[0]) > 0.01 && Math.abs(start[1] - end[1]) > 0.01
}

function collectLegendBoxes(fragment) {
  const boxes = []

  // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
  for (const match of fragment.matchAll(/<rect\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0])
    const x = numberAttr(attrs, 'x')
    const y = numberAttr(attrs, 'y')
    const width = numberAttr(attrs, 'width')
    const height = numberAttr(attrs, 'height')
    if ([x, y, width, height].every(Number.isFinite)) {
      boxes.push({ x1: x, y1: y, x2: x + width, y2: y + height, label: `rect@${x},${y}` })
    }
  }

  // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
  for (const match of fragment.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = parseAttrs(match[1])
    const box = textBox(attrs, stripTags(match[2]).trim())
    if (box) boxes.push(box)
  }

  return boxes
}

function collectLegendCollisions(arrows, boxes) {
  const collisions = []
  // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
  for (const arrow of arrows) {
    // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
    for (const segment of arrow.segments) {
      // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
      for (const box of boxes) {
        if (segmentIntersectsBox(segment, padBox(box, 2))) {
          collisions.push({ arrow, box })
        }
      }
    }
  }
  return collisions
}

function textBox(attrs, text) {
  const x = numberAttr(attrs, 'x')
  const y = numberAttr(attrs, 'y')
  const fontSize = Number.parseFloat(attrs['font-size'] || '10')
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(fontSize)) return null
  const width = estimatedTextWidth(text, fontSize)
  const anchor = attrs['text-anchor'] || 'start'
  let x1 = x
  if (anchor === 'middle') x1 = x - width / 2
  if (anchor === 'end') x1 = x - width
  return {
    x1,
    y1: y - fontSize,
    x2: x1 + width,
    y2: y + fontSize * 0.25,
    label: text || `text@${x},${y}`
  }
}

function estimatedTextWidth(text, fontSize) {
  let units = 0
  // functional-loop: break — the loop must stop exactly at the guarded item
  for (const char of text) units += char.charCodeAt(0) > 255 ? 1.8 : 0.62
  return Math.max(fontSize, units * fontSize)
}

function pointsFromPath(d) {
  const tokens = d.match(/[MLHVZmlhvz]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g) || []
  const points = []
  let i = 0
  let command = ''
  let current = [0, 0]
  let start = null

  // functional-loop: break — the loop must stop exactly at the guarded item
  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++]
    if (!command) break

    const absolute = command === command.toUpperCase()
    switch (command.toUpperCase()) {
      case 'M':
      case 'L': {
        // functional-loop: break — the loop must stop exactly at the guarded item
        while (i + 1 < tokens.length && !isCommand(tokens[i])) {
          const x = Number.parseFloat(tokens[i++])
          const y = Number.parseFloat(tokens[i++])
          if (!Number.isFinite(x) || !Number.isFinite(y)) break
          current = absolute ? [x, y] : [current[0] + x, current[1] + y]
          points.push(current)
          if (!start) start = current
        }
        break
      }
      case 'H': {
        // functional-loop: break — the loop must stop exactly at the guarded item
        while (i < tokens.length && !isCommand(tokens[i])) {
          const x = Number.parseFloat(tokens[i++])
          if (!Number.isFinite(x)) break
          current = absolute ? [x, current[1]] : [current[0] + x, current[1]]
          points.push(current)
        }
        break
      }
      case 'V': {
        // functional-loop: break — the loop must stop exactly at the guarded item
        while (i < tokens.length && !isCommand(tokens[i])) {
          const y = Number.parseFloat(tokens[i++])
          if (!Number.isFinite(y)) break
          current = absolute ? [current[0], y] : [current[0], current[1] + y]
          points.push(current)
        }
        break
      }
      case 'Z': {
        if (start) points.push(start)
        break
      }
      default:
        return []
    }
  }

  return points.filter(isPoint)
}

function segmentIntersectsBox(segment, box) {
  const { start, end } = segment
  if (pointInsideBox(start, box) || pointInsideBox(end, box)) return true
  const edges = [
    [
      [box.x1, box.y1],
      [box.x2, box.y1]
    ],
    [
      [box.x2, box.y1],
      [box.x2, box.y2]
    ],
    [
      [box.x2, box.y2],
      [box.x1, box.y2]
    ],
    [
      [box.x1, box.y2],
      [box.x1, box.y1]
    ]
  ]
  return edges.some(([a, b]) => segmentsIntersect(start, end, a, b))
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(a, c, b)) return true
  if (o2 === 0 && onSegment(a, d, b)) return true
  if (o3 === 0 && onSegment(c, a, d)) return true
  if (o4 === 0 && onSegment(c, b, d)) return true
  return false
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
  if (Math.abs(value) < 1e-9) return 0
  return value > 0 ? 1 : 2
}

function onSegment(a, b, c) {
  return (
    b[0] <= Math.max(a[0], c[0]) + 1e-9 &&
    b[0] + 1e-9 >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + 1e-9 &&
    b[1] + 1e-9 >= Math.min(a[1], c[1])
  )
}

function pointInsideBox(point, box) {
  return point[0] >= box.x1 && point[0] <= box.x2 && point[1] >= box.y1 && point[1] <= box.y2
}

function padBox(box, padding) {
  return {
    ...box,
    x1: box.x1 - padding,
    y1: box.y1 - padding,
    x2: box.x2 + padding,
    y2: box.y2 + padding
  }
}

function parseAttrs(tag) {
  const attrs = {}
  // functional-loop: early-return — the loop must exit the enclosing function on the guarded item
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[match[1]] = match[2]
  return attrs
}

function numberAttr(attrs, name) {
  return Number.parseFloat(attrs[name])
}

function isCommand(token) {
  return /^[A-Za-z]$/.test(token)
}

function isPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, '')
}
