// issues: https://github.com/facebook/react/issues/17157
// issues: https://github.com/facebook/react/pull/24730
declare module 'react' {
  interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    inert?: boolean | undefined | ''
  }
}

declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      inert?: boolean | undefined | ''
    }
  }
}

export {}
