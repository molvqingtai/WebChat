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
        // Whole-file purity resolution. The Program pass records every local function and
        // variable declaration first, then each queued check runs with full scope resolution:
        // a callback may touch its parameters, its own locals, and locally defined helpers
        // proven pure by induction. External member calls, known effectful globals, mutator
        // methods on parameter objects, and unresolved named calls are rejected.
        const PURE_GLOBALS = new Set([
          'Math',
          'JSON',
          'Number',
          'String',
          'Boolean',
          'Array',
          'Object',
          'BigInt',
          'Symbol',
          'parseInt',
          'parseFloat',
          'isNaN',
          'isFinite',
          'encodeURIComponent',
          'decodeURIComponent',
          'structuredClone',
          'undefined',
          'NaN',
          'Infinity',
          'path'
        ])
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
          'performance',
          'fetch',
          'localStorage',
          'sessionStorage',
          'fs',
          'fsPromises',
          'os',
          'crypto',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'queueMicrotask'
        ])
        const STORAGE_READ_METHODS = new Set(['getItem', 'getKeys'])
        // Parameter objects may only be mutated through these true JavaScript mutators;
        // domain method names like join/close/persist stay effectful only on outer objects.
        const PARAM_MUTATORS = new Set([
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
          'setItem',
          'removeItem'
        ])
        // Cross-file imports cannot be proven pure locally, but only these names are
        // mechanically effectful by contract (I/O, timers, and similar ambient globals).
        const EFFECTFUL_FUNCTION_NAMES = new Set([
          'readFile',
          'readFileSync',
          'readdir',
          'readdirSync',
          'writeFile',
          'writeFileSync',
          'appendFile',
          'appendFileSync',
          'unlink',
          'unlinkSync',
          'mkdir',
          'mkdirSync',
          'rm',
          'rmSync',
          'rename',
          'renameSync',
          'copyFile',
          'copyFileSync',
          'existsSync',
          'stat',
          'statSync',
          'spawn',
          'exec',
          'execSync',
          'fetch',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'queueMicrotask',
          'alert',
          'confirm',
          'prompt'
        ])
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
          'setItem',
          'removeItem',
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
          'blur',
          'readFile',
          'readFileSync',
          'readdir',
          'readdirSync',
          'writeFile',
          'writeFileSync',
          'appendFile',
          'appendFileSync',
          'unlink',
          'unlinkSync',
          'mkdir',
          'mkdirSync',
          'rm',
          'rmSync',
          'rename',
          'renameSync',
          'copyFile',
          'copyFileSync',
          'existsSync',
          'stat',
          'statSync',
          'spawn',
          'exec',
          'execSync'
        ])

        let declarations = null
        let pendingChecks = []

        const collectParamNames = (param, bound) => {
          if (!param || typeof param !== 'object') return
          if (param.type === 'Identifier') {
            bound.add(param.name)
          } else if (param.type === 'RestElement') {
            collectParamNames(param.argument, bound)
          } else if (param.type === 'AssignmentPattern') {
            collectParamNames(param.left, bound)
          } else if (param.type === 'ObjectPattern') {
            // functional-loop: owner-commit — ordered per-property binding collection with no bulk primitive
            for (const prop of param.properties) collectParamNames(prop.value, bound)
          } else if (param.type === 'ArrayPattern') {
            // functional-loop: owner-commit — ordered per-element binding collection with no bulk primitive
            for (const element of param.elements) collectParamNames(element, bound)
          }
        }

        const collectDeclarations = (node, scope) => {
          if (!node || typeof node !== 'object') return
          if (Array.isArray(node)) {
            // functional-loop: owner-commit — ordered per-node declaration collection with no bulk primitive
            for (const item of node) collectDeclarations(item, scope)
            return
          }
          if (node.type === 'FunctionDeclaration') {
            if (node.id && node.id.name) scope.set(node.id.name, { node, params: node.params })
            collectDeclarations(node.body, scope)
            return
          }
          if (node.type === 'VariableDeclaration') {
            // functional-loop: owner-commit — ordered per-declarator binding collection with no bulk primitive
            for (const declarator of node.declarations) {
              if (declarator.id && declarator.id.type === 'Identifier' && declarator.init) {
                if (
                  declarator.init.type === 'ArrowFunctionExpression' ||
                  declarator.init.type === 'FunctionExpression'
                ) {
                  scope.set(declarator.id.name, { node: declarator.init, params: declarator.init.params })
                }
              }
            }
            return
          }
          // functional-loop: early-return — declaration collection walks until the tree ends
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            collectDeclarations(node[key], scope)
          }
        }

        const isEffectCall = (node, bound, scope, resolving, found) => {
          if (!node || typeof node !== 'object') return false
          if (node.type === 'CallExpression') {
            const callee = node.callee
            if (callee && callee.type === 'MemberExpression' && !callee.computed) {
              const methodName = callee.property && callee.property.name
              if (callee.object && callee.object.type === 'ThisExpression') {
                return MUTATOR_METHODS.has(methodName)
              }
              if (callee.object && callee.object.type === 'Identifier') {
                const objectName = callee.object.name
                if (PURE_GLOBALS.has(objectName)) return false
                if (bound.has(objectName)) {
                  // A callback may mutate objects it created itself; mutating a parameter
                  // object is an externally visible effect.
                  return PARAM_MUTATORS.has(methodName) && !bound.has(objectName + ':local')
                }
                if (EFFECTFUL_GLOBALS.has(objectName)) {
                  if (
                    (objectName === 'localStorage' || objectName === 'sessionStorage') &&
                    STORAGE_READ_METHODS.has(methodName)
                  ) {
                    return false
                  }
                  return true
                }
                return MUTATOR_METHODS.has(methodName)
              }
              if (callee.object && callee.object.type === 'CallExpression') {
                return isEffectCall(callee.object, bound, scope, resolving, found)
              }
            }
            if (callee && callee.type === 'Identifier') {
              if (PURE_GLOBALS.has(callee.name) || bound.has(callee.name)) return false
              const entry = scope.get(callee.name)
              if (entry && !resolving.has(callee.name)) {
                const innerBound = new Set(bound)
                // functional-loop: owner-commit — ordered per-parameter binding collection with no bulk primitive
                for (const param of entry.params) collectParamNames(param, innerBound)
                collectLocalNames(entry.node.body, innerBound)
                const innerResolving = new Set(resolving)
                innerResolving.add(callee.name)
                return containsEffect(entry.node.body, innerBound, scope, innerResolving, found)
              }
              // An import or ambient global cannot be proven pure locally; only names that
              // are effectful by contract are rejected.
              return EFFECTFUL_FUNCTION_NAMES.has(callee.name)
            }
          }
          if (node.type === 'AssignmentExpression') {
            const left = node.left
            if (left && left.type === 'Identifier' && !bound.has(left.name)) return true
            if (left && left.type === 'MemberExpression' && left.object && left.object.type === 'Identifier') {
              const objectName = left.object.name
              if (!bound.has(objectName) && !PURE_GLOBALS.has(objectName)) return true
            }
          }
          return false
        }

        const containsEffect = (node, bound, scope, resolving, found) => {
          if (!node || typeof node !== 'object') return false
          if (node.type === 'CallExpression' || node.type === 'AssignmentExpression') {
            if (isEffectCall(node, bound, scope, resolving, found)) {
              if (found && node.range) {
                found.push(node.range[0])
              }
              return true
            }
          }
          // functional-loop: early-return — a matching effect stops the object walk
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const value = node[key]
            if (Array.isArray(value)) {
              if (
                value.some(
                  (item) =>
                    typeof item === 'object' && item !== null && containsEffect(item, bound, scope, resolving, found)
                )
              ) {
                return true
              }
            } else if (typeof value === 'object' && value !== null) {
              if (containsEffect(value, bound, scope, resolving, found)) return true
            }
          }
          return false
        }

        const collectLocalNames = (body, bound) => {
          if (!body || typeof body !== 'object') return
          const walk = (node) => {
            if (!node || typeof node !== 'object') return
            if (node.type === 'VariableDeclaration') {
              // functional-loop: owner-commit — ordered per-declarator local collection with no bulk primitive
              for (const declarator of node.declarations) {
                if (declarator.id && declarator.id.type === 'Identifier') {
                  bound.add(declarator.id.name)
                  bound.add(declarator.id.name + ':local')
                }
              }
            }
            // functional-loop: early-return — local collection walks until the tree ends
            for (const key of Object.keys(node)) {
              if (key === 'parent' || key === 'loc' || key === 'range') continue
              const value = node[key]
              if (Array.isArray(value)) {
                // functional-loop: owner-commit — ordered per-child local walk with no bulk primitive
                for (const item of value) {
                  if (typeof item === 'object' && item !== null) walk(item)
                }
              } else if (typeof value === 'object' && value !== null) {
                walk(value)
              }
            }
          }
          walk(body)
        }

        const analyzeCallback = (callback, reportNode) => {
          const bound = new Set()
          // functional-loop: owner-commit — ordered per-parameter binding collection with no bulk primitive
          for (const param of callback.params) collectParamNames(param, bound)
          collectLocalNames(callback.body, bound)
          const resolving = new Set()
          if (containsEffect(callback.body, bound, declarations || new Map(), resolving)) {
            context.report({
              node: reportNode,
              message:
                'reduce callback performs an externally observable effect: derive the accumulator without side effects'
            })
          }
        }

        // Program fires before the call-expression selectors in this runtime, so the
        // declaration map is ready by the time a selector handler runs; the deferred queue
        // only guards runtimes with the opposite order.
        const queue = (checkBody) => {
          if (declarations) checkBody()
          else pendingChecks.push(checkBody)
        }

        return {
          Program(node) {
            declarations = new Map()
            try {
              // functional-loop: owner-commit — ordered per-declaration collection with no bulk primitive
              for (const statement of node.body) collectDeclarations(statement, declarations)
            } catch (error) {
              context.report({ node, message: `declaration collection failed: ${error.message}` })
            }
            // functional-loop: owner-commit — ordered per-callback check with no bulk primitive
            for (const item of pendingChecks) item()
            pendingChecks = []
          },
          "CallExpression[callee.property.name='reduce']": (node) => {
            queue(() => {
              const callback = node.arguments && node.arguments[0]
              if (
                !callback ||
                (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')
              ) {
                return
              }
              analyzeCallback(callback, node)
            })
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
        // Whole-file purity resolution. The Program pass records every local function and
        // variable declaration first, then each queued check runs with full scope resolution:
        // a callback may touch its parameters, its own locals, and locally defined helpers
        // proven pure by induction. External member calls, known effectful globals, mutator
        // methods on parameter objects, and unresolved named calls are rejected.
        const PURE_GLOBALS = new Set([
          'Math',
          'JSON',
          'Number',
          'String',
          'Boolean',
          'Array',
          'Object',
          'BigInt',
          'Symbol',
          'parseInt',
          'parseFloat',
          'isNaN',
          'isFinite',
          'encodeURIComponent',
          'decodeURIComponent',
          'structuredClone',
          'undefined',
          'NaN',
          'Infinity',
          'path'
        ])
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
          'performance',
          'fetch',
          'localStorage',
          'sessionStorage',
          'fs',
          'fsPromises',
          'os',
          'crypto',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'queueMicrotask'
        ])
        const STORAGE_READ_METHODS = new Set(['getItem', 'getKeys'])
        // Parameter objects may only be mutated through these true JavaScript mutators;
        // domain method names like join/close/persist stay effectful only on outer objects.
        const PARAM_MUTATORS = new Set([
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
          'setItem',
          'removeItem'
        ])
        // Cross-file imports cannot be proven pure locally, but only these names are
        // mechanically effectful by contract (I/O, timers, and similar ambient globals).
        const EFFECTFUL_FUNCTION_NAMES = new Set([
          'readFile',
          'readFileSync',
          'readdir',
          'readdirSync',
          'writeFile',
          'writeFileSync',
          'appendFile',
          'appendFileSync',
          'unlink',
          'unlinkSync',
          'mkdir',
          'mkdirSync',
          'rm',
          'rmSync',
          'rename',
          'renameSync',
          'copyFile',
          'copyFileSync',
          'existsSync',
          'stat',
          'statSync',
          'spawn',
          'exec',
          'execSync',
          'fetch',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'queueMicrotask',
          'alert',
          'confirm',
          'prompt'
        ])
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
          'setItem',
          'removeItem',
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
          'blur',
          'readFile',
          'readFileSync',
          'readdir',
          'readdirSync',
          'writeFile',
          'writeFileSync',
          'appendFile',
          'appendFileSync',
          'unlink',
          'unlinkSync',
          'mkdir',
          'mkdirSync',
          'rm',
          'rmSync',
          'rename',
          'renameSync',
          'copyFile',
          'copyFileSync',
          'existsSync',
          'stat',
          'statSync',
          'spawn',
          'exec',
          'execSync'
        ])

        let declarations = null
        let pendingChecks = []

        const collectParamNames = (param, bound) => {
          if (!param || typeof param !== 'object') return
          if (param.type === 'Identifier') {
            bound.add(param.name)
          } else if (param.type === 'RestElement') {
            collectParamNames(param.argument, bound)
          } else if (param.type === 'AssignmentPattern') {
            collectParamNames(param.left, bound)
          } else if (param.type === 'ObjectPattern') {
            // functional-loop: owner-commit — ordered per-property binding collection with no bulk primitive
            for (const prop of param.properties) collectParamNames(prop.value, bound)
          } else if (param.type === 'ArrayPattern') {
            // functional-loop: owner-commit — ordered per-element binding collection with no bulk primitive
            for (const element of param.elements) collectParamNames(element, bound)
          }
        }

        const collectDeclarations = (node, scope) => {
          if (!node || typeof node !== 'object') return
          if (Array.isArray(node)) {
            // functional-loop: owner-commit — ordered per-node declaration collection with no bulk primitive
            for (const item of node) collectDeclarations(item, scope)
            return
          }
          if (node.type === 'FunctionDeclaration') {
            if (node.id && node.id.name) scope.set(node.id.name, { node, params: node.params })
            collectDeclarations(node.body, scope)
            return
          }
          if (node.type === 'VariableDeclaration') {
            // functional-loop: owner-commit — ordered per-declarator binding collection with no bulk primitive
            for (const declarator of node.declarations) {
              if (declarator.id && declarator.id.type === 'Identifier' && declarator.init) {
                if (
                  declarator.init.type === 'ArrowFunctionExpression' ||
                  declarator.init.type === 'FunctionExpression'
                ) {
                  scope.set(declarator.id.name, { node: declarator.init, params: declarator.init.params })
                }
              }
            }
            return
          }
          // functional-loop: early-return — declaration collection walks until the tree ends
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            collectDeclarations(node[key], scope)
          }
        }

        const isEffectCall = (node, bound, scope, resolving, found) => {
          if (!node || typeof node !== 'object') return false
          if (node.type === 'CallExpression') {
            const callee = node.callee
            if (callee && callee.type === 'MemberExpression' && !callee.computed) {
              const methodName = callee.property && callee.property.name
              if (callee.object && callee.object.type === 'ThisExpression') {
                return MUTATOR_METHODS.has(methodName)
              }
              if (callee.object && callee.object.type === 'Identifier') {
                const objectName = callee.object.name
                if (PURE_GLOBALS.has(objectName)) return false
                if (bound.has(objectName)) {
                  // A callback may mutate objects it created itself; mutating a parameter
                  // object is an externally visible effect.
                  return PARAM_MUTATORS.has(methodName) && !bound.has(objectName + ':local')
                }
                if (EFFECTFUL_GLOBALS.has(objectName)) {
                  if (
                    (objectName === 'localStorage' || objectName === 'sessionStorage') &&
                    STORAGE_READ_METHODS.has(methodName)
                  ) {
                    return false
                  }
                  return true
                }
                return MUTATOR_METHODS.has(methodName)
              }
              if (callee.object && callee.object.type === 'CallExpression') {
                return isEffectCall(callee.object, bound, scope, resolving, found)
              }
            }
            if (callee && callee.type === 'Identifier') {
              if (PURE_GLOBALS.has(callee.name) || bound.has(callee.name)) return false
              const entry = scope.get(callee.name)
              if (entry && !resolving.has(callee.name)) {
                const innerBound = new Set(bound)
                // functional-loop: owner-commit — ordered per-parameter binding collection with no bulk primitive
                for (const param of entry.params) collectParamNames(param, innerBound)
                collectLocalNames(entry.node.body, innerBound)
                const innerResolving = new Set(resolving)
                innerResolving.add(callee.name)
                return containsEffect(entry.node.body, innerBound, scope, innerResolving, found)
              }
              // An import or ambient global cannot be proven pure locally; only names that
              // are effectful by contract are rejected.
              return EFFECTFUL_FUNCTION_NAMES.has(callee.name)
            }
          }
          if (node.type === 'AssignmentExpression') {
            const left = node.left
            if (left && left.type === 'Identifier' && !bound.has(left.name)) return true
            if (left && left.type === 'MemberExpression' && left.object && left.object.type === 'Identifier') {
              const objectName = left.object.name
              if (!bound.has(objectName) && !PURE_GLOBALS.has(objectName)) return true
            }
          }
          return false
        }

        const containsEffect = (node, bound, scope, resolving, found) => {
          if (!node || typeof node !== 'object') return false
          if (node.type === 'CallExpression' || node.type === 'AssignmentExpression') {
            if (isEffectCall(node, bound, scope, resolving, found)) {
              if (found && node.range) {
                found.push(node.range[0])
              }
              return true
            }
          }
          // functional-loop: early-return — a matching effect stops the object walk
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const value = node[key]
            if (Array.isArray(value)) {
              if (
                value.some(
                  (item) =>
                    typeof item === 'object' && item !== null && containsEffect(item, bound, scope, resolving, found)
                )
              ) {
                return true
              }
            } else if (typeof value === 'object' && value !== null) {
              if (containsEffect(value, bound, scope, resolving, found)) return true
            }
          }
          return false
        }

        const collectLocalNames = (body, bound) => {
          if (!body || typeof body !== 'object') return
          const walk = (node) => {
            if (!node || typeof node !== 'object') return
            if (node.type === 'VariableDeclaration') {
              // functional-loop: owner-commit — ordered per-declarator local collection with no bulk primitive
              for (const declarator of node.declarations) {
                if (declarator.id && declarator.id.type === 'Identifier') {
                  bound.add(declarator.id.name)
                  bound.add(declarator.id.name + ':local')
                }
              }
            }
            // functional-loop: early-return — local collection walks until the tree ends
            for (const key of Object.keys(node)) {
              if (key === 'parent' || key === 'loc' || key === 'range') continue
              const value = node[key]
              if (Array.isArray(value)) {
                // functional-loop: owner-commit — ordered per-child local walk with no bulk primitive
                for (const item of value) {
                  if (typeof item === 'object' && item !== null) walk(item)
                }
              } else if (typeof value === 'object' && value !== null) {
                walk(value)
              }
            }
          }
          walk(body)
        }

        const analyzeCallback = (callback, reportNode) => {
          const bound = new Set()
          // functional-loop: owner-commit — ordered per-parameter binding collection with no bulk primitive
          for (const param of callback.params) collectParamNames(param, bound)
          collectLocalNames(callback.body, bound)
          const resolving = new Set()
          if (containsEffect(callback.body, bound, declarations || new Map(), resolving)) {
            context.report({
              node: reportNode,
              message:
                'map/filter/flatMap callback performs an externally observable effect: compute the result without side effects'
            })
          }
        }

        // Program fires before the call-expression selectors in this runtime, so the
        // declaration map is ready by the time a selector handler runs; the deferred queue
        // only guards runtimes with the opposite order.
        const queue = (checkBody) => {
          if (declarations) checkBody()
          else pendingChecks.push(checkBody)
        }

        return {
          Program(node) {
            declarations = new Map()
            try {
              // functional-loop: owner-commit — ordered per-declaration collection with no bulk primitive
              for (const statement of node.body) collectDeclarations(statement, declarations)
            } catch (error) {
              context.report({ node, message: `declaration collection failed: ${error.message}` })
            }
            // functional-loop: owner-commit — ordered per-callback check with no bulk primitive
            for (const item of pendingChecks) item()
            pendingChecks = []
          },
          "CallExpression[callee.property.name='map']": (node) => {
            queue(() => {
              const callback = node.arguments && node.arguments[0]
              if (!callback) return
              if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
                analyzeCallback(callback, node)
                return
              }
              if (callback.type === 'Identifier') {
                if (PURE_GLOBALS.has(callback.name)) return
                const entry = declarations && declarations.get(callback.name)
                if (entry) {
                  analyzeCallback(entry.node, node)
                  return
                }
                context.report({
                  node,
                  message:
                    'map/filter/flatMap callback is an unresolved named function: compute the result without side effects'
                })
              }
            })
          },
          "CallExpression[callee.property.name='filter']": (node) => {
            queue(() => {
              const callback = node.arguments && node.arguments[0]
              if (!callback) return
              if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
                analyzeCallback(callback, node)
                return
              }
              if (callback.type === 'Identifier') {
                if (PURE_GLOBALS.has(callback.name)) return
                const entry = declarations && declarations.get(callback.name)
                if (entry) {
                  analyzeCallback(entry.node, node)
                  return
                }
                context.report({
                  node,
                  message:
                    'map/filter/flatMap callback is an unresolved named function: compute the result without side effects'
                })
              }
            })
          },
          "CallExpression[callee.property.name='flatMap']": (node) => {
            queue(() => {
              const callback = node.arguments && node.arguments[0]
              if (!callback) return
              if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
                analyzeCallback(callback, node)
                return
              }
              if (callback.type === 'Identifier') {
                if (PURE_GLOBALS.has(callback.name)) return
                const entry = declarations && declarations.get(callback.name)
                if (entry) {
                  analyzeCallback(entry.node, node)
                  return
                }
                context.report({
                  node,
                  message:
                    'map/filter/flatMap callback is an unresolved named function: compute the result without side effects'
                })
              }
            })
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
