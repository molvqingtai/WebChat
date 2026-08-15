import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillRoot = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-animation-'))

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json'
}

function render(mode, example, animation = 'trace') {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'))
  if (animation) doc.meta = { ...doc.meta, animation }
  const suffix = animation || 'static'
  const input = path.join(tmp, `${mode}-${suffix}.json`)
  const output = path.join(tmp, `${mode}-${suffix}.html`)
  fs.writeFileSync(input, JSON.stringify(doc))
  execFileSync('node', [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output], {
    stdio: ['ignore', 'ignore', 'pipe']
  })
  return fs.readFileSync(output, 'utf8')
}

function svgBlock(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || ''
}

test('static output omits animation attributes', () => {
  const svg = svgBlock(render('workflow', CASES.workflow, null))
  assert.doesNotMatch(svg, /data-animation=/)
  assert.doesNotMatch(svg, /data-animate=/)
})

Object.entries(CASES).forEach(([mode, example]) =>
  test(`${mode}: trace animation annotates svg, edges, and nodes`, () => {
    const svg = svgBlock(render(mode, example))
    assert.match(svg, /<svg[^>]+data-animation="trace"/)
    assert.match(svg, /data-animate="edge" style="--step:0"/)
    assert.match(svg, /data-animate="node" style="--step:0"/)
  })
)

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
