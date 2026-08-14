#!/usr/bin/env node
/**
 * Functional-iteration quality gate (authority: openspec/changes/prefer-functional-iteration).
 *
 * This script is only the orchestration layer:
 *  1. derives the exact manifest of tracked JS/TS-family files (minus the one exact generated path),
 *  2. prechecks comment trivia and rejects any eslint-disable / oxlint-disable directive that names
 *     a functional-iteration rule (no whole-file, directory, or directive waiver exists), and
 *  3. invokes the read-only functional-only Oxlint pass (local plugin + native forEach rule) with
 *     ignore processing and nested config discovery disabled.
 *
 * The structural rules themselves live in the repository-local Oxlint plugin at
 * oxlint/functional-plugin/functional-plugin.cjs; this script performs no AST scanning and never
 * fixes anything.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const FILE_EXTS = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** Generated output excluded by exact tracked path; its repository-owned generator stays in scope. */
const GENERATED_PATHS = new Set(['.agents/skills/archify/renderers/shared/generated-validators.mjs'])

const manifest = () => {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean)
  return out.filter((file) => FILE_EXTS.test(file) && !GENERATED_PATHS.has(file))
}

const DISABLE_PATTERN =
  /(?:eslint-disable(?:-next-line)?|oxlint-disable(?:-next-line)?)[^\n]*(?:functional-iteration|functional-plugin|loop-annotation|derived-mutation|no-array-for-each)/u

const violations = []
// functional-loop: owner-commit — ordered per-file waiver collection with no bulk primitive
for (const file of manifest()) {
  let source
  try {
    source = readFileSync(path.join(ROOT, file), 'utf8')
  } catch {
    continue
  }
  // Comment-trivia waiver precheck: directive-like text inside strings is not a comment and is
  // ignored by this plain-text pass; the plugin rules below are AST-based.
  let index = 0
  // functional-loop: condition-driven — the comment scan advances to the next comment occurrence
  while (index < source.length) {
    const slash = source.indexOf('//', index)
    const block = source.indexOf('/*', index)
    const candidate = slash === -1 ? block : block === -1 ? slash : Math.min(slash, block)
    if (candidate === -1) break
    const end = source[candidate + 1] === '*' ? source.indexOf('*/', candidate + 2) : source.indexOf('\n', candidate)
    const commentEnd = end === -1 ? source.length : end
    if (DISABLE_PATTERN.test(source.slice(candidate, commentEnd))) {
      const line = source.slice(0, candidate).split('\n').length
      violations.push(`${file}:${line}:1  functional-iteration disable directive is forbidden`)
    }
    index = commentEnd
  }
}

// Read-only functional-only Oxlint pass: local plugin + native forEach rule, no fixes, no ignore
// processing, no nested config discovery. The manifest is passed as the exact file list.
const result = spawnSync(
  process.execPath,
  [
    path.join(ROOT, 'node_modules/oxlint/bin/oxlint'),
    '--config',
    path.join(ROOT, 'oxlint.config.cjs'),
    '--no-ignore',
    '--disable-nested-config',
    ...manifest()
  ],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
)
if (result.stdout.length > 0) process.stdout.write(result.stdout.toString('utf8'))
if (result.stderr.length > 0) process.stderr.write(result.stderr.toString('utf8'))

if (violations.length > 0) {
  process.stderr.write(`functional-iteration waiver violations: ${violations.length}\n`)
  // functional-loop: owner-commit — ordered per-violation reporting with no bulk primitive
  for (const violation of violations) process.stderr.write(`${violation}\n`)
}
if (violations.length > 0 || result.status !== 0) process.exit(1)
process.stdout.write('functional-iteration: clean\n')
