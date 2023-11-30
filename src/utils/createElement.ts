const createElement = <T extends Element>(template: string) => {
  return new Range().createContextualFragment(template).firstElementChild as unknown as T
}

export default createElement
