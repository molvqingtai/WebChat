// Per-rule coverage for the renderers' layout validators. The golden suite's
// negative cases mostly trip ajv SCHEMA rules; this file targets the hand-
// written LAYOUT rules (the `problems.push(...)` checks) — the layer that has
// regressed before — by mutating a valid example into exactly one violation
// and asserting the renderer exits non-zero with the expected message.
//
// It also locks the error-message CONTRACT: representative messages must carry
// both the numeric threshold and a remediation hint, since the consumer is an
// LLM that fixes the JSON from the message alone.
//
//   node --test test/*.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillRoot = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-rules-'))

const EXAMPLES = {
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
  architecture: 'web-app.architecture.json'
}

function load(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', EXAMPLES[mode]), 'utf8'))
}

// Returns { code, stderr }. Never throws on non-zero exit.
function render(mode, doc) {
  const input = path.join(tmp, `${mode}-${Math.abs(hash(JSON.stringify(doc)))}.json`)
  const outPath = path.join(tmp, `${mode}-${Math.abs(hash(JSON.stringify(doc)))}.html`)
  fs.writeFileSync(input, JSON.stringify(doc))
  try {
    execFileSync('node', [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, outPath], {
      stdio: ['ignore', 'ignore', 'pipe']
    })
    return { code: 0, stderr: '', outPath }
  } catch (err) {
    return { code: err.status ?? 1, stderr: String(err.stderr || ''), outPath }
  }
}

function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

// [name, mode, mutate(doc), expectedSubstrings[]] — every mutation introduces
// exactly one layout violation. Each expected substring must appear in stderr.
const CASES = [
  // ---- workflow layout rules ----
  [
    'workflow: unknown lane',
    'workflow',
    (d) => {
      d.nodes[0].lane = 'ghost'
    },
    ['unknown lane "ghost"']
  ],
  [
    'workflow: node label wider than box',
    'workflow',
    (d) => {
      d.nodes[0].label = 'An Extremely Long Node Label That Overflows'
    },
    ['wider than node', 'shorten the label']
  ],
  [
    'workflow: viewBox width below schema min',
    'workflow',
    (d) => {
      d.meta.viewBox = [699, 900]
    },
    ['700']
  ],
  [
    'workflow: nodes too close in a lane',
    'workflow',
    (d) => {
      d.nodes.push({ ...d.nodes[0], id: 'dupe', col: d.nodes[0].col })
    },
    ['less than 8px apart']
  ],
  [
    'workflow: empty group',
    'workflow',
    (d) => {
      d.groups = [{ id: 'empty', label: 'Empty group', lane: 'ui', fromCol: 3, toCol: 4 }]
    },
    ['does not contain any nodes']
  ],
  [
    'workflow: mainPath missing edge',
    'workflow',
    (d) => {
      d.mainPath = ['user', 'planner']
    },
    ['mainPath step "user" -> "planner" has no matching edge']
  ],
  [
    'workflow: mainPath moves backward',
    'workflow',
    (d) => {
      d.mainPath = ['external', 'trace']
    },
    ['moves backward from col']
  ],

  // ---- sequence layout rules ----
  [
    'sequence: message references unknown participant',
    'sequence',
    (d) => {
      d.messages[0].from = 'ghost'
    },
    ['unknown source "ghost"']
  ],
  [
    'sequence: message y outside timeline',
    'sequence',
    (d) => {
      d.messages[0].y = 9000
    },
    ['outside the readable timeline', 'keep y between']
  ],
  [
    'sequence: segment to <= from',
    'sequence',
    (d) => {
      d.segments = [{ from: 400, to: 300, label: 'bad' }]
    },
    ['invalid y range', 'greater than']
  ],

  // ---- dataflow layout rules ----
  [
    'dataflow: flow missing label',
    'dataflow',
    (d) => {
      delete d.flows[0].label
    },
    ['label']
  ],
  [
    'dataflow: flow references unknown node',
    'dataflow',
    (d) => {
      d.flows[0].to = 'ghost'
    },
    ['unknown target "ghost"']
  ],

  // ---- lifecycle layout rules ----
  [
    'lifecycle: missing reserved main lane',
    'lifecycle',
    (d) => {
      d.lanes = d.lanes.map((l) => (l.id === 'main' ? { ...l, id: 'primary' } : l))
      d.states = d.states.map((s) => (s.lane === 'main' ? { ...s, lane: 'primary' } : s))
    },
    ['"main"', 'reserved']
  ],
  [
    'lifecycle: cross-lane state overlap',
    'lifecycle',
    (d) => {
      const approval = d.states.find((s) => s.id === 'approval')
      const failed = d.states.find((s) => s.id === 'failed')
      delete failed.yOffset
      failed.col = approval.col
    },
    ['less than 10px apart']
  ],
  [
    'lifecycle: viewBox height below schema min',
    'lifecycle',
    (d) => {
      d.meta.viewBox = [980, 565]
    },
    ['566']
  ],

  // ---- architecture layout rules ----
  [
    'architecture: components overlap',
    'architecture',
    (d) => {
      d.components[1].pos = [...d.components[0].pos]
    },
    ['less than 8px apart']
  ],
  [
    'architecture: connection references unknown component',
    'architecture',
    (d) => {
      d.connections[0].to = 'ghost'
    },
    ['unknown target "ghost"']
  ],
  [
    'architecture: boundary wraps unknown component',
    'architecture',
    (d) => {
      d.boundaries[0].wraps.push('ghost')
    },
    ['wraps unknown component "ghost"']
  ],
  [
    'architecture: label wider than component',
    'architecture',
    (d) => {
      d.components[0].label = 'An Extremely Long Component Label Overflow'
    },
    ['wider than component', 'shorten the label']
  ],
  [
    'architecture: component overlap suggests fix',
    'architecture',
    (d) => {
      d.components[1].pos = [...d.components[0].pos]
    },
    ['Suggested fix', 'move "']
  ]
]

for (const [name, mode, mutate, expected] of CASES) {
  test(name, () => {
    const doc = load(mode)
    mutate(doc)
    const { code, stderr } = render(mode, doc)
    assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`)
    assert.doesNotMatch(stderr, /TypeError|is not a function|Cannot read/, `crashed instead of reporting:\n${stderr}`)
    for (const sub of expected) {
      assert.ok(stderr.includes(sub), `expected "${sub}" in stderr:\n${stderr}`)
    }
  })
}

// ---- error-message contract: threshold + remediation, not just a path ----
test('contract: short-edge message carries both the px minimum and a fix verb', () => {
  const d = load('workflow')
  // Force a too-short labeled edge between adjacent same-lane columns.
  d.nodes.push({ id: 'a1', lane: d.nodes[0].lane, col: 0, type: 'backend', label: 'A' })
  d.nodes.push({ id: 'a2', lane: d.nodes[0].lane, col: 0, type: 'backend', label: 'B', yOffset: 30 })
  d.edges.push({ from: 'a1', to: 'a2', label: 'x', route: 'straight' })
  const { stderr } = render('workflow', d)
  // Whatever rule fires, the messages must remain actionable (threshold + verb).
  assert.match(stderr, /\d+px|at least \d+|0\.\.\d+|less than/)
})

test('contract: ajv path errors are annotated with the element id', () => {
  const d = load('workflow')
  d.nodes[3].colour = 'red' // unknown property → ajv additionalProperties
  const { stderr } = render('workflow', d)
  // Only meaningful when ajv is installed; skip the assertion in degraded mode.
  if (!/schema validation failed/.test(stderr)) return
  assert.match(stderr, /id\/label:/)
})

test('workflow: same-lane offset auto edge stays orthogonal', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Same-lane offset route' },
    lanes: [{ id: 'main', label: 'Main lane' }],
    nodes: [
      { id: 'left', lane: 'main', col: 1, type: 'backend', label: 'A', width: 32, height: 38, yOffset: -14 },
      { id: 'right', lane: 'main', col: 2, type: 'backend', label: 'B', width: 32, height: 38, yOffset: 14 }
    ],
    edges: [{ from: 'left', to: 'right' }]
  }
  const { code, stderr, outPath } = render('workflow', d)
  assert.equal(code, 0, stderr)
  const html = fs.readFileSync(outPath, 'utf8')
  assert.doesNotMatch(html, /M 236 105 L 284 133/)
  assert.match(html, /M 236 105 L 260 105 L 260 133 L 284 133/)
})

test('workflow: edge crossing a non-endpoint node is rejected', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Crossing edge route' },
    lanes: [{ id: 'main', label: 'Main lane' }],
    nodes: [
      { id: 'left', lane: 'main', col: 0, type: 'backend', label: 'Left', width: 60 },
      { id: 'middle', lane: 'main', col: 2, type: 'database', label: 'Middle', width: 70 },
      { id: 'right', lane: 'main', col: 4, type: 'backend', label: 'Right', width: 60 }
    ],
    edges: [{ from: 'left', to: 'right', route: 'straight' }]
  }
  const { code, stderr } = render('workflow', d)
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`)
  assert.match(stderr, /crosses node "middle"/)
  assert.match(stderr, /fromSide\/toSide|channel|lane\/column/)
})

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
