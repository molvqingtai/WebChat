import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillRoot = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-checks-'))
const checker = path.join(skillRoot, 'scripts/check-render-output.mjs')

function checkHtml(name, svgBody) {
  const htmlPath = path.join(tmp, `${name}.html`)
  fs.writeFileSync(htmlPath, `<!doctype html><html><body><svg viewBox="0 0 240 160">${svgBody}</svg></body></html>`)
  try {
    const stdout = execFileSync('node', [checker, htmlPath], { encoding: 'utf8' })
    return { code: 0, result: JSON.parse(stdout) }
  } catch (err) {
    return { code: err.status ?? 1, result: JSON.parse(String(err.stdout || '{}')) }
  }
}

test('render output check: accepts orthogonal arrows away from legend', () => {
  const { code, result } = checkHtml(
    'clean',
    `
    <path d="M 20 20 L 120 20 L 120 60" class="a-default" stroke-width="1.4" marker-end="url(#arrowhead)"/>
    <!-- Legend -->
    <text x="40" y="120" class="t-primary" font-size="10">Legend</text>
    <rect x="40" y="132" width="14" height="9" class="c-backend"/>
    <text x="60" y="140" class="t-muted" font-size="7">Backend</text>
  `
  )
  assert.equal(code, 0)
  assert.equal(result.ok, true)
})

test('render output check: rejects two-point diagonal arrows', () => {
  const { code, result } = checkHtml(
    'diagonal',
    `
    <path d="M 20 20 L 120 80" class="a-default" stroke-width="1.4" marker-end="url(#arrowhead)"/>
    <!-- Legend -->
    <text x="40" y="120" class="t-primary" font-size="10">Legend</text>
  `
  )
  assert.notEqual(code, 0)
  const check = result.checks.find((item) => item.name === 'orthogonal_arrows')
  assert.equal(check.ok, false)
  assert.match(check.details[0], /path 1/)
})

test('render output check: rejects arrows crossing legend text', () => {
  const { code, result } = checkHtml(
    'legend-crossing',
    `
    <path d="M 20 112 L 180 112" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>
    <!-- Legend -->
    <text x="40" y="120" class="t-primary" font-size="10">Legend</text>
    <rect x="40" y="132" width="14" height="9" class="c-backend"/>
    <text x="60" y="140" class="t-muted" font-size="7">Backend</text>
  `
  )
  assert.notEqual(code, 0)
  const check = result.checks.find((item) => item.name === 'legend_clearance')
  assert.equal(check.ok, false)
  assert.match(check.details[0], /Legend/)
})

test('render output check: ignores unmarked sequence lifelines near legend', () => {
  const { code, result } = checkHtml(
    'lifeline-near-legend',
    `
    <path d="M 60 20 L 60 126" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>
    <!-- Legend -->
    <text x="40" y="120" class="t-primary" font-size="10">Legend</text>
    <path d="M 120 136 L 154 136" class="a-default" stroke-width="1.4" stroke-dasharray="3,5" marker-end="url(#arrowhead)"/>
    <text x="163" y="139" class="t-muted" font-size="8">return</text>
  `
  )
  assert.equal(code, 0)
  assert.equal(result.ok, true)
})

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
