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
        const KINDS = {
          ForStatement: new Set(['break', 'continue', 'early-return', 'condition-driven']),
          ForOfStatement: new Set(['break', 'continue', 'early-return', 'condition-driven', 'owner-commit']),
          ForInStatement: new Set(['break', 'continue', 'early-return']),
          WhileStatement: new Set(['condition-driven']),
          DoWhileStatement: new Set(['condition-driven'])
        }
        return {
          ForStatement(node) {
            check(node, 'ForStatement')
          },
          ForOfStatement(node) {
            check(node, 'ForOfStatement')
          },
          ForInStatement(node) {
            check(node, 'ForInStatement')
          },
          WhileStatement(node) {
            check(node, 'WhileStatement')
          },
          DoWhileStatement(node) {
            check(node, 'DoWhileStatement')
          }
        }
        function check(node, nodeType) {
          const before = node.range ? source.slice(0, node.range[0]) : ''
          const windowText = before.slice(commentWindowStart(before, node.range ? node.range[0] : 0))
          const match =
            /functional-loop:\s*(break|continue|early-return|condition-driven|owner-commit)\s*—\s*\S+/u.exec(windowText)
          if (!match) {
            context.report({ node, message: 'loop lacks a statement-local functional-loop justification annotation' })
            return
          }
          if (!KINDS[nodeType].has(match[1])) {
            context.report({
              node,
              message: `loop kind '${match[1]}' is not permitted for this loop statement`
            })
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
        const MUTATOR_METHODS = new Set([
          'set',
          'add',
          'delete',
          'clear',
          'push',
          'pop',
          'shift',
          'unshift',
          'splice',
          'sort',
          'reverse',
          'append',
          'setItem',
          'removeItem',
          'assign'
        ])
        const containsAccumulatorMutation = (node, accName) => {
          if (!node || typeof node !== 'object') return false
          if (
            node.type === 'CallExpression' &&
            node.callee &&
            node.callee.type === 'MemberExpression' &&
            node.callee.object &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === accName &&
            node.callee.property &&
            node.callee.property.type === 'Identifier' &&
            MUTATOR_METHODS.has(node.callee.property.name)
          ) {
            return true
          }
          // functional-loop: early-return — a matching mutator call stops the object walk
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const value = node[key]
            if (Array.isArray(value)) {
              if (
                value.some(
                  (item) => typeof item === 'object' && item !== null && containsAccumulatorMutation(item, accName)
                )
              )
                return true
            } else if (typeof value === 'object' && value !== null) {
              if (containsAccumulatorMutation(value, accName)) return true
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
            if (!accUsed) {
              if (containsEffectCall(callback.body)) {
                context.report({
                  node,
                  message:
                    'reduce callback performs an external effect without using the accumulator: a disguised forEach'
                })
              }
              return
            }
            if (containsAccumulatorMutation(callback.body, accParam.name)) {
              context.report({
                node,
                message: 'reduce callback mutates the accumulator through a method call: use a non-mutating fold'
              })
            }
          }
        }
      }
    },
    'effectful-callback': {
      meta: {
        type: 'problem',
        docs: { description: 'map/filter/flatMap callbacks must compute their result without external effects' }
      },
      create(context) {
        // A callback may only touch its parameters and its own locals; a call that reaches
        // outside that scope — a mutator method on an outer object, a member call on `this`,
        // or a known effectful global — is mechanically provable as an external effect.
        // Pure namespaces are excluded: their methods compute values without external effects.
        const PURE_NAMESPACES = new Set(['Math', 'JSON', 'path'])
        // Any member call on these globals is an effect (console included; storage reads below
        // are exempted because getItem only observes).
        const EFFECTFUL_GLOBALS = new Set([
          'document',
          'window',
          'self',
          'navigator',
          'chrome',
          'browser',
          'location',
          'history',
          'indexedDB',
          'console',
          'process',
          'performance'
        ])
        const STORAGE_MUTATORS = new Set(['setItem', 'removeItem', 'clear'])
        const MUTATOR_METHODS = new Set([
          'set',
          'add',
          'delete',
          'clear',
          'push',
          'pop',
          'shift',
          'unshift',
          'splice',
          'sort',
          'reverse',
          'append',
          'prepend',
          'assign',
          'defineProperty',
          'addEventListener',
          'removeEventListener',
          'dispatchEvent',
          'join',
          'leave',
          'persist',
          'listener',
          'listen',
          'send',
          'post',
          'publish',
          'write',
          'remove',
          'open',
          'close',
          'start',
          'stop',
          'connect',
          'disconnect',
          'enqueue',
          'dequeue',
          'flush',
          'commit',
          'broadcast',
          'emit',
          'notify',
          'register',
          'subscribe',
          'unsubscribe',
          'reload',
          'replace',
          'submit',
          'click',
          'focus',
          'blur'
        ])
        const collectBindings = (node, bound) => {
          if (!node || typeof node !== 'object') return
          if (node.type === 'Identifier') {
            bound.add(node.name)
            return
          }
          // functional-loop: owner-commit — ordered per-node key walk with no bulk primitive
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range' || key === 'body') continue
            const value = node[key]
            if (Array.isArray(value)) {
              // functional-loop: owner-commit — ordered per-child binding collection with no bulk primitive
              for (const item of value) {
                if (typeof item === 'object' && item !== null) collectBindings(item, bound)
              }
            } else if (typeof value === 'object' && value !== null) {
              collectBindings(value, bound)
            }
          }
        }
        const containsEffectCall = (node, bound) => {
          if (!node || typeof node !== 'object') return false
          if (node.type === 'CallExpression') {
            const callee = node.callee
            if (callee && callee.type === 'MemberExpression') {
              if (callee.object && callee.object.type === 'ThisExpression') return true
              if (callee.object && callee.object.type === 'Identifier' && !callee.computed) {
                const objectName = callee.object.name
                const methodName = callee.property && callee.property.name
                if (bound.has(objectName) || PURE_NAMESPACES.has(objectName)) return false
                if (EFFECTFUL_GLOBALS.has(objectName)) return true
                if (
                  (objectName === 'localStorage' || objectName === 'sessionStorage') &&
                  STORAGE_MUTATORS.has(methodName)
                )
                  return true
                if (MUTATOR_METHODS.has(methodName)) return true
              }
            }
            if (callee && callee.type === 'Identifier') {
              if (callee.name === 'fetch' && !bound.has(callee.name)) return true
            }
          }
          // functional-loop: early-return — a matching effect call stops the object walk
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const value = node[key]
            if (Array.isArray(value)) {
              if (value.some((item) => typeof item === 'object' && item !== null && containsEffectCall(item, bound)))
                return true
            } else if (typeof value === 'object' && value !== null) {
              if (containsEffectCall(value, bound)) return true
            }
          }
          return false
        }
        const check = (node) => {
          const callback = node.arguments && node.arguments[0]
          if (!callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression'))
            return
          const bound = new Set()
          // functional-loop: owner-commit — ordered per-parameter binding collection with no bulk primitive
          for (const param of callback.params) collectBindings(param, bound)
          if (callback.body && callback.body.type === 'BlockStatement') {
            // functional-loop: early-return — only variable declarations introduce bindings
            for (const statement of callback.body.body) {
              if (statement.type === 'VariableDeclaration') {
                // functional-loop: early-return — each declarator adds one binding and the walk ends
                for (const declarator of statement.declarations) collectBindings(declarator.id, bound)
              }
            }
          }
          if (containsEffectCall(callback.body, bound)) {
            context.report({
              node,
              message:
                'map/filter/flatMap callback performs an externally observable effect: compute the result without side effects'
            })
          }
        }
        return {
          "CallExpression[callee.property.name='map']": check,
          "CallExpression[callee.property.name='filter']": check,
          "CallExpression[callee.property.name='flatMap']": check
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
