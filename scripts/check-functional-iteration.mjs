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
  // Comment-trivia waiver precheck: a real lexer tracks strings and templates so directive-like
  // text inside a string literal is ignored, while every actual line/block comment is checked.
  const comments = []
  let index = 0
  // functional-loop: condition-driven — the lexer advances token by token until the source ends
  while (index < source.length) {
    const ch = source[index]
    if (ch === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index)
      comments.push(source.slice(index, end === -1 ? source.length : end))
      index = end === -1 ? source.length : end + 1
      continue
    }
    if (ch === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      comments.push(source.slice(index, end === -1 ? source.length : end + 2))
      index = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      let end = index + 1
      // functional-loop: condition-driven — scan forward to the closing quote
      while (end < source.length && source[end] !== ch) {
        if (source[end] === '\\') end += 1
        end += 1
      }
      index = Math.min(source.length, end + 1)
      continue
    }
    if (ch === '`') {
      let end = index + 1
      // functional-loop: condition-driven — scan forward to the closing backtick
      while (end < source.length && source[end] !== '`') {
        if (source[end] === '\\') end += 1
        end += 1
      }
      index = Math.min(source.length, end + 1)
      continue
    }
    index += 1
  }
  // functional-loop: owner-commit — ordered per-comment waiver reporting with no bulk primitive
  for (const comment of comments) {
    if (DISABLE_PATTERN.test(comment)) {
      const line = source.slice(0, source.indexOf(comment)).split('\n').length
      violations.push(`${file}:${line}:1  functional-iteration disable directive is forbidden`)
    }
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
