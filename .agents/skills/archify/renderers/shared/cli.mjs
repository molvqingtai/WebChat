import fs from 'node:fs'
import path from 'node:path'
import { applyTemplate, renderCards, esc } from './utils.mjs'
import { validateSchema } from './validator.mjs'

// Common CLI head: node render-<type>.mjs [input.json] [output.html]
export function loadDiagram({ rendererDir, diagramType, defaultExample, argv = process.argv }) {
  const skillRoot = path.resolve(rendererDir, '../..')
  const inputPath = path.resolve(argv[2] || path.join(skillRoot, 'examples', defaultExample))
  const diagram = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  validateSchema(diagramType, diagram)
  const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8')
  // Optional chaining: in degraded mode (no ajv) malformed input must still
  // reach the renderer's friendly layout checks instead of crashing here.
  const outPath = path.resolve(process.cwd(), argv[3] || diagram.meta?.output || `${diagramType}.html`)
  return { diagram, template, outPath }
}

// Common CLI tail: fill the template and write the standalone HTML file.
// The keyboard hint is screen-only — it means nothing on paper.
export function writeDiagram({ outPath, template, meta, footerLabel, svg, cards }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(
    outPath,
    applyTemplate(template, {
      title: meta.title,
      subtitle: meta.subtitle,
      footer: `${footerLabel} &bull; Built with Archify<span class="no-print"> &bull; Press <kbd>T</kbd> for theme and <kbd>E</kbd> for export</span>`,
      svg,
      cards: renderCards(cards)
    })
  )
  console.log(outPath)
}

// Accessible name for the generated diagram SVG.
export function svgRootAttrs(meta, type) {
  const name = meta.subtitle ? `${meta.title} — ${meta.subtitle}` : meta.title
  const animation = meta.animation === 'trace' ? ' data-animation="trace"' : ''
  return `role="img" aria-label="${esc(`${name} (${type})`)}"${animation}`
}

export function animateAttr(meta, type, step) {
  if (meta.animation !== 'trace') return ''
  const safeStep = Number.isFinite(step) && step >= 0 ? Math.floor(step) : 0
  return ` data-animate="${type}" style="--step:${safeStep}"`
}
