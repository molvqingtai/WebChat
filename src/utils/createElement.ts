const createElement = <T extends Element>(template: string): T => {
  const fragment = new Range().createContextualFragment(template)
  // SAFETY: callers pass an HTML template whose first element is the requested T.
  return fragment.firstElementChild as T
}

export default createElement
