import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SOURCE_ROOT = path.resolve(process.cwd(), 'src')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

const collectProductionSources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectProductionSources(fullPath)
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return []
    if (/\.(test|spec|browser\.test)\.(ts|tsx|js|jsx)$/.test(entry.name)) return []
    return [fullPath]
  })

/**
 * Single pass over the source that separates executable code from comment text. String literals
 * are honored so a `//` or quote inside a string cannot be mistaken for a comment boundary.
 */
const partitionComments = (source: string): { executable: string; comments: string } => {
  let executable = ''
  let comments = ''
  let index = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  while (index < source.length) {
    const char = source[index]!
    const next = source[index + 1]
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line'
        index += 2
        continue
      }
      if (char === '/' && next === '*') {
        state = 'block'
        index += 2
        continue
      }
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === '`') state = 'template'
      executable += char
      index += 1
      continue
    }
    if (state === 'line') {
      if (char === '\n') {
        executable += char
        state = 'code'
      } else {
        comments += char
      }
      index += 1
      continue
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code'
        index += 2
        continue
      }
      comments += char === '\n' ? '\n' : char
      index += 1
      continue
    }
    // String literal: copy through, honoring escapes.
    executable += char
    if (char === '\\') {
      executable += next ?? ''
      index += 2
      continue
    }
    if (
      (state === 'single' && char === "'") ||
      (state === 'double' && char === '"') ||
      (state === 'template' && char === '`')
    ) {
      state = 'code'
    }
    index += 1
  }
  return { executable, comments }
}

const NON_ERROR_METHODS =
  /\bconsole\.(warn|log|info|debug|trace|table|dir|dirxml|group|groupCollapsed|groupEnd|time|timeEnd|timeLog|count|countReset|assert|profile|profileEnd|timeStamp|clear)\b/

describe('production console inventory', () => {
  it('allows only console.error in executable production source and keeps no disabled non-error call in comments', () => {
    const files = collectProductionSources(SOURCE_ROOT)
    expect(files.length).toBeGreaterThan(0)

    const violations: string[] = []
    for (const file of files) {
      const { executable, comments } = partitionComments(readFileSync(file, 'utf8'))
      const relative = path.relative(SOURCE_ROOT, file)

      // No executable console method other than console.error.
      for (const match of executable.matchAll(/\bconsole\.(\w+)/g)) {
        if (match[1] !== 'error') violations.push(`${relative}: executable console.${match[1]}`)
      }

      // No disabled non-error console call retained as a comment example.
      const commentedCall = comments.match(NON_ERROR_METHODS)
      if (commentedCall) violations.push(`${relative}: commented ${commentedCall[0]}`)
    }

    expect(violations).toEqual([])
  })
})
