export const browser = {
  runtime: { id: 'vitest' },
  storage: {}
}

export const defineContentScript = <Definition>(definition: Definition) => definition
export const defineBackground = <Definition>(definition: Definition) => definition

export const createShadowRootUi = () => {
  throw new Error('createShadowRootUi must be mocked by the test that invokes it')
}
