import * as validators from './generated-validators.mjs'

// "/nodes/3/label" reads much better as "/nodes/3 (id: "router") /label" for the
// LLM fixing the JSON; resolve the nearest enclosing element's id or label.
function annotatePath(instancePath, data) {
  if (!instancePath) return '/'
  let node = data
  let hint = null
  // functional-loop: break — the loop must stop exactly at the guarded item
  for (const seg of instancePath.split('/').slice(1)) {
    if (node == null || typeof node !== 'object') break
    node = node[/^\d+$/.test(seg) ? Number(seg) : seg]
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const tag = node.id ?? node.label
      if (tag != null) hint = String(tag)
    }
  }
  return hint != null ? `${instancePath} (id/label: ${JSON.stringify(hint)})` : instancePath
}

function formatErrors(errors, data) {
  return errors
    .map((e) => {
      const where = annotatePath(e.instancePath, data)
      const detail = e.params && Object.keys(e.params).length ? ' ' + JSON.stringify(e.params) : ''
      return `  ${where} ${e.message}${detail}`
    })
    .join('\n')
}

export function validateSchema(diagramType, data) {
  const validate = validators[diagramType]
  if (!validate) {
    throw new Error(`validateSchema: unknown diagram type "${diagramType}"`)
  }
  if (!validate(data)) {
    throw new Error(`${diagramType} schema validation failed:\n${formatErrors(validate.errors, data)}`)
  }
}
