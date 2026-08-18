import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { SyntaxKind, LanguageVariant } from 'typescript/unstable/ast'
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

interface Token {
  kind: SyntaxKind
  text: string
  line: number
}

/**
 * Tokenize with the project's own TypeScript scanner. Strings and template parts never surface as
 * identifier tokens, so quoted `console.warn(...)` text can never produce a false positive; comment
 * trivia is retained separately for residue detection.
 */
const scanTokens = (source: string, jsx: boolean): Token[] => {
  const scanner = createScanner(false, jsx ? LanguageVariant.JSX : LanguageVariant.Standard, source)
  const iterator = {
    [Symbol.iterator]() {
      return this
    },
    next(): IteratorResult<Token> {
      const kind = scanner.scan()
      if (kind === SyntaxKind.EndOfFile) return { done: true, value: undefined }
      const text = scanner.getTokenText()
      const line = source.slice(0, scanner.getTokenStart()).split('\n').length
      return { done: false, value: { kind, text, line } }
    }
  }
  return Array.from(iterator as Iterable<Token>)
}

const TRIVIA_KINDS = new Set<SyntaxKind>([
  SyntaxKind.WhitespaceTrivia,
  SyntaxKind.NewLineTrivia,
  SyntaxKind.SingleLineCommentTrivia,
  SyntaxKind.MultiLineCommentTrivia
])

const COMMENT_KINDS = new Set<SyntaxKind>([SyntaxKind.SingleLineCommentTrivia, SyntaxKind.MultiLineCommentTrivia])

const NON_ERROR_IN_COMMENT =
  /\bconsole\.(warn|log|info|debug|trace|table|dir|dirxml|group|groupCollapsed|groupEnd|time|timeEnd|timeLog|count|countReset|assert|profile|profileEnd|timeStamp|clear)\b/

const isConsoleIdentifier = (token: Token | undefined) =>
  token?.kind === SyntaxKind.Identifier && token.text === 'console'

/** Executable violations: direct/optional member access and computed access on `console`. */
const executableViolations = (file: string, tokens: Token[]): string[] => {
  const code = tokens.filter((token) => !TRIVIA_KINDS.has(token.kind))
  return code.flatMap((token, index) => {
    if (!isConsoleIdentifier(token)) return []
    const next = code[index + 1]
    const after = code[index + 2]
    const at = `${file}: line ${token.line}`
    if (next?.kind === SyntaxKind.DotToken || next?.kind === SyntaxKind.QuestionDotToken) {
      return after?.kind === SyntaxKind.Identifier && after.text !== 'error'
        ? [`${at} executable console.${after.text}`]
        : []
    }
    if (next?.kind === SyntaxKind.OpenBracketToken) {
      const isErrorLiteral =
        after?.kind === SyntaxKind.StringLiteral && (after.text === '"error"' || after.text === "'error'")
      return isErrorLiteral ? [] : [`${at} executable console[...]`]
    }
    return []
  })
}

/** Comment residue: disabled non-error console calls retained as examples. */
const commentViolations = (file: string, tokens: Token[]): string[] =>
  tokens.flatMap((token) => {
    if (!COMMENT_KINDS.has(token.kind)) return []
    const match = token.text.match(NON_ERROR_IN_COMMENT)
    return match ? [`${file}: line ${token.line} commented ${match[0]}`] : []
  })

const fileViolations = (file: string): string[] => {
  const source = readFileSync(file, 'utf8')
  const jsx = file.endsWith('.tsx') || file.endsWith('.jsx')
  const tokens = scanTokens(source, jsx)
  const relative = path.relative(SOURCE_ROOT, file)
  return [...executableViolations(relative, tokens), ...commentViolations(relative, tokens)]
}

describe('production console inventory', () => {
  it('syntax matrix: only direct console.error passes; optional, computed, and dynamic access fail; comments fail; strings and templates never false-positive', () => {
    const matrix = [
      "console.error('allowed direct error')",
      "console?.error?.('allowed optional error')",
      "console['error']('allowed computed error')",
      "console.warn('direct violation')",
      "console?.warn?.('optional violation')",
      "console['warn']('computed violation')",
      "const method = 'warn'; console[method]('dynamic violation')",
      "// console.log('disabled call residue')",
      "/* console.debug('disabled block residue') */",
      'const text = \'console.warn("inside a string")\'',
      'const template = `console.warn(${1}inside a template)`',
      "const errorLike = 'console.error inside a string is not a call'"
    ].join('\n')

    const tokens = scanTokens(matrix, false)
    expect(executableViolations('matrix.ts', tokens)).toEqual([
      'matrix.ts: line 4 executable console.warn',
      'matrix.ts: line 5 executable console.warn',
      'matrix.ts: line 6 executable console[...]',
      'matrix.ts: line 7 executable console[...]'
    ])
    expect(commentViolations('matrix.ts', tokens)).toEqual([
      'matrix.ts: line 8 commented console.log',
      'matrix.ts: line 9 commented console.debug'
    ])
  })

  it('allows only console.error in executable production source and keeps no disabled non-error call in comments', () => {
    const files = collectProductionSources(SOURCE_ROOT)
    expect(files.length).toBeGreaterThan(0)

    const violations = files.flatMap(fileViolations)
    expect(violations).toEqual([])
  })
})
