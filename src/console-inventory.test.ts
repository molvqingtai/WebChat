import { afterAll, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { API } from 'typescript/unstable/sync'
import {
  isPropertyAccessExpression,
  isElementAccessExpression,
  isIdentifier,
  isStringLiteral,
  SyntaxKind,
  LanguageVariant
} from 'typescript/unstable/ast'
import type { Node, SourceFile } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'

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

// The project's own TypeScript parser (tsgo-backed API), shared across this file's tests.
const api = new API()
afterAll(() => {
  api.close()
})

/** Parse one file and run `use` while the snapshot (and therefore the AST) is alive. */
const withSourceFile = <T>(file: string, use: (sourceFile: SourceFile) => T): T => {
  const uri = pathToFileURL(file).href
  api.updateSnapshot({ openFiles: [{ uri }] })
  try {
    const snapshot = api.updateSnapshot({})
    const sourceFile = snapshot.getDefaultProjectForFile({ uri })?.program.getSourceFile({ uri })
    if (!sourceFile) throw new Error(`TypeScript parser returned no SourceFile for ${file}`)
    return use(sourceFile)
  } finally {
    api.updateSnapshot({ closeFiles: [{ uri }] })
  }
}

/** Parse many files in one snapshot so the project is loaded once. */
const withSourceFiles = <T>(files: readonly string[], use: (sourceFiles: Map<string, SourceFile>) => T): T => {
  const uris = files.map((file) => pathToFileURL(file).href)
  api.updateSnapshot({ openFiles: uris.map((uri) => ({ uri })) })
  try {
    const snapshot = api.updateSnapshot({})
    const sourceFiles = new Map(
      files.map((file, index) => {
        const uri = uris[index]!
        const sourceFile = snapshot.getDefaultProjectForFile({ uri })?.program.getSourceFile({ uri })
        if (!sourceFile) throw new Error(`TypeScript parser returned no SourceFile for ${file}`)
        return [file, sourceFile] as const
      })
    )
    return use(sourceFiles)
  } finally {
    api.updateSnapshot({ closeFiles: uris.map((uri) => ({ uri })) })
  }
}

const childNodes = (node: Node): Node[] => {
  const children: Node[] = []
  node.forEachChild((child) => {
    children.push(child)
  })
  return children
}

const lineOf = (sourceFile: SourceFile, node: Node): number =>
  sourceFile.text.slice(0, node.getStart(sourceFile)).split('\n').length

/**
 * Structural AST detection of every `console` member reference — property access, optional chain,
 * and element access (literal or dynamic) are all real node kinds, so `console?.['warn']`,
 * `console?.[method]`, and `console['error' + suffix]` cannot slip past, and string or template
 * text can never false-positive. Only the exact `console.error` member is allowed.
 */
const executableViolations = (label: string, sourceFile: SourceFile): string[] => {
  const visit = (node: Node): string[] => {
    const own: string[] = []
    if (isPropertyAccessExpression(node) && isIdentifier(node.expression) && node.expression.text === 'console') {
      if (node.name.text !== 'error') {
        own.push(`${label}: line ${lineOf(sourceFile, node)} executable console.${node.name.text}`)
      }
    } else if (isElementAccessExpression(node) && isIdentifier(node.expression) && node.expression.text === 'console') {
      const argument = node.argumentExpression
      if (!(argument && isStringLiteral(argument) && argument.text === 'error')) {
        own.push(`${label}: line ${lineOf(sourceFile, node)} executable console[...]`)
      }
    }
    return [...own, ...childNodes(node).flatMap(visit)]
  }
  return visit(sourceFile)
}

const NON_ERROR_METHOD =
  '(?:warn|log|info|debug|trace|table|dir|dirxml|group|groupCollapsed|groupEnd|time|timeEnd|timeLog|count|countReset|assert|profile|profileEnd|timeStamp|clear)'
/** Comment residue: disabled non-error console calls in direct, optional, computed, or optional-computed form. */
const NON_ERROR_IN_COMMENT = new RegExp(
  `\\bconsole(?:\\?\\.|\\.)?(?:${NON_ERROR_METHOD}\\b|\\[\\s*['"\`]${NON_ERROR_METHOD}['"\`]\\s*\\])`
)

interface CommentTrivia {
  text: string
  line: number
}

/** Comment trivia via the project's TypeScript scanner; strings/templates never surface as comments. */
const commentTriviaOf = (source: string): CommentTrivia[] => {
  const scanner = createScanner(false, LanguageVariant.Standard, source)
  const iterator = {
    [Symbol.iterator]() {
      return this
    },
    next(): IteratorResult<CommentTrivia> {
      let kind = scanner.scan()
      while (kind !== SyntaxKind.EndOfFile) {
        if (kind === SyntaxKind.SingleLineCommentTrivia || kind === SyntaxKind.MultiLineCommentTrivia) {
          const text = scanner.getTokenText()
          const line = source.slice(0, scanner.getTokenStart()).split('\n').length
          return { done: false, value: { text, line } }
        }
        kind = scanner.scan()
      }
      return { done: true, value: undefined }
    }
  }
  return Array.from(iterator as Iterable<CommentTrivia>)
}

const commentViolations = (label: string, source: string): string[] =>
  commentTriviaOf(source).flatMap((comment) => {
    const match = comment.text.match(NON_ERROR_IN_COMMENT)
    return match ? [`${label}: line ${comment.line} commented ${match[0]}`] : []
  })

describe('production console inventory', () => {
  it('syntax matrix: only exact console.error passes; optional/computed/dynamic forms fail closed; comment residue in every form fails; strings and templates never false-positive', () => {
    const matrix = [
      "console.error('allowed direct error')",
      "console?.error?.('allowed optional error')",
      "console['error']('allowed computed error literal')",
      "console.warn('direct violation')",
      "console?.warn?.('optional violation')",
      "console['warn']('computed literal violation')",
      "console?.['warn']('optional computed violation')",
      "const method = 'warn'; console[method]('dynamic violation')",
      "console?.[method]('optional dynamic violation')",
      "console['error' + method]('dynamic expression violation')",
      "// console.log('disabled direct residue')",
      "// console?.warn('disabled optional residue')",
      "/* console['debug']('disabled computed residue') */",
      "/* console?.['info']('disabled optional computed residue') */",
      'const text = \'console.warn("inside a string")\'',
      'const template = `console.warn(${1}inside a template)`',
      "const errorLike = 'console.error inside a string is not a call'"
    ].join('\n')

    const fixture = path.join(os.tmpdir(), `console-inventory-matrix-${process.pid}.ts`)
    writeFileSync(fixture, matrix)
    try {
      const executable = withSourceFile(fixture, (sourceFile) => executableViolations('matrix.ts', sourceFile))
      expect(executable).toEqual([
        'matrix.ts: line 4 executable console.warn',
        'matrix.ts: line 5 executable console.warn',
        'matrix.ts: line 6 executable console[...]',
        'matrix.ts: line 7 executable console[...]',
        'matrix.ts: line 8 executable console[...]',
        'matrix.ts: line 9 executable console[...]',
        'matrix.ts: line 10 executable console[...]'
      ])
      expect(commentViolations('matrix.ts', matrix)).toEqual([
        'matrix.ts: line 11 commented console.log',
        'matrix.ts: line 12 commented console?.warn',
        "matrix.ts: line 13 commented console['debug']",
        "matrix.ts: line 14 commented console?.['info']"
      ])
    } finally {
      unlinkSync(fixture)
    }
  })

  it(
    'allows only console.error in executable production source and keeps no disabled non-error call in comments',
    { timeout: 300_000 },
    () => {
      const files = collectProductionSources(SOURCE_ROOT)
      expect(files.length).toBeGreaterThan(0)

      const violations = withSourceFiles(files, (sourceFiles) =>
        files.flatMap((file) => {
          const relative = path.relative(SOURCE_ROOT, file)
          const sourceFile = sourceFiles.get(file)!
          return [
            ...executableViolations(relative, sourceFile),
            ...commentViolations(relative, readFileSync(file, 'utf8'))
          ]
        })
      )
      expect(violations).toEqual([])
    }
  )
})
