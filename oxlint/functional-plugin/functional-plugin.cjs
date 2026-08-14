/** Repository-local Oxlint plugin for the functional-iteration contract. */
module.exports = {
  meta: { name: 'functional-plugin', version: '0.0.0' },
  rules: {
    'loop-annotation': {
      meta: { type: 'problem', docs: { description: 'loops need a statement-local functional-loop annotation' } },
      create(context) {
        const sourceCode = context.sourceCode
        const source = sourceCode?.getText?.() ?? ''
        const commentWindowStart = (before, start) => {
          let lineBegin = before.lastIndexOf('\n', start - 1) + 1
          let windowBegin = lineBegin
          // functional-loop: condition-driven — walk the contiguous comment block upward
          while (windowBegin > 0) {
            const prevLineStart = before.lastIndexOf('\n', windowBegin - 2)
            const prevLine = before.slice(prevLineStart + 1, windowBegin - 1).trim()
            if (prevLine.startsWith('//') || prevLine.startsWith('/*') || prevLine.startsWith('*')) {
              windowBegin = prevLineStart + 1
            } else {
              break
            }
          }
          return windowBegin
        }
        return {
          ForStatement(node) {
            check(node)
          },
          ForOfStatement(node) {
            check(node)
          },
          ForInStatement(node) {
            check(node)
          },
          WhileStatement(node) {
            check(node)
          },
          DoWhileStatement(node) {
            check(node)
          }
        }
        function check(node) {
          const before = node.range ? source.slice(0, node.range[0]) : ''
          const windowText = before.slice(commentWindowStart(before, node.range ? node.range[0] : 0))
          if (
            !/functional-loop:\s*(break|continue|early-return|condition-driven|owner-commit)\s*—\s*\S+/u.test(
              windowText
            )
          ) {
            context.report({ node, message: 'loop lacks a statement-local functional-loop justification annotation' })
          }
        }
      }
    },
    'disguised-for-each': {
      meta: {
        type: 'problem',
        docs: { description: 'a reducer must derive its accumulator and must not serve as a disguised forEach' }
      },
      create(context) {
        const usesName = (node, name) => {
          if (!node || typeof node !== 'object') return false
          if (node.type === 'Identifier' && node.name === name) return true
          // functional-loop: early-return — a matching identifier stops the object walk
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const value = node[key]
            if (Array.isArray(value)) {
              if (value.some((item) => typeof item === 'object' && item !== null && usesName(item, name))) return true
            } else if (typeof value === 'object' && value !== null) {
              if (usesName(value, name)) return true
            }
          }
          return false
        }
        const containsEffectCall = (node) => {
          if (!node || typeof node !== 'object') return false
          if (node.type === 'CallExpression') {
            const callee = node.callee
            if (callee && callee.type === 'Identifier') return true
            if (callee && callee.type === 'MemberExpression' && callee.object.type === 'ThisExpression') return true
          }
          // functional-loop: early-return — a matching effect call stops the object walk
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const value = node[key]
            if (Array.isArray(value)) {
              if (value.some((item) => typeof item === 'object' && item !== null && containsEffectCall(item)))
                return true
            } else if (typeof value === 'object' && value !== null) {
              if (containsEffectCall(value)) return true
            }
          }
          return false
        }
        return {
          "CallExpression[callee.property.name='reduce']": (node) => {
            const callback = node.arguments && node.arguments[0]
            if (!callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression'))
              return
            const params = callback.params || []
            const accParam = params.length >= 1 ? params[0] : null
            if (!accParam || accParam.type !== 'Identifier') return
            const accUsed = usesName(callback.body, accParam.name)
            if (accUsed) return
            if (containsEffectCall(callback.body)) {
              context.report({
                node,
                message:
                  'reduce callback performs an external effect without using the accumulator: a disguised forEach'
              })
            }
          }
        }
      }
    },
    'derived-mutation': {
      meta: {
        type: 'problem',
        docs: { description: 'sort/reverse/splice need a functional-mutate annotation or a copying method' }
      },
      create(context) {
        const sourceCode = context.sourceCode
        const source = sourceCode?.getText?.() ?? ''
        return {
          "CallExpression[callee.property.name='sort']": check,
          "CallExpression[callee.property.name='reverse']": check,
          "CallExpression[callee.property.name='splice']": check
        }
        function check(node) {
          const before = node.range ? source.slice(0, node.range[0]) : ''
          const lineBegin = before.lastIndexOf('\n') + 1
          const prevLineBegin = before.lastIndexOf('\n', lineBegin - 2) + 1
          if (!/functional-mutate:\s*\S+/u.test(before.slice(prevLineBegin))) {
            context.report({
              node,
              message:
                'sort/reverse/splice call lacks a functional-mutate annotation (use toSorted/toReversed/toSpliced)'
            })
          }
        }
      }
    }
  }
}
