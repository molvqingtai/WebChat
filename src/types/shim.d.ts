declare module '*.svg' {
  import type * as React from 'react'

  const ReactComponent: React.FunctionComponent<React.ComponentProps<'svg'> & { title?: string }>

  export default ReactComponent
}

declare module '*.md?raw' {
  const content: string
  export default content
}
