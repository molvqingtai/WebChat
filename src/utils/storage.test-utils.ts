export const createTestLocalStorage = (): Storage => {
  // SAFETY: the test double is a null-prototype record whose methods are defined non-enumerably,
  // so stored items stay the only own enumerable keys (Object.keys == stored keys).
  const storage = Object.create(null) as Record<string, string> & Storage
  Object.defineProperties(storage, {
    length: {
      get: () => Object.keys(storage).length
    },
    clear: {
      value: () => Object.keys(storage).forEach((key) => delete storage[key])
    },
    getItem: {
      value: (key: string) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null)
    },
    key: {
      value: (index: number) => Object.keys(storage)[index] ?? null
    },
    removeItem: {
      value: (key: string) => delete storage[key]
    },
    setItem: {
      value: (key: string, value: string) => {
        storage[key] = String(value)
      }
    }
  })
  return storage
}
