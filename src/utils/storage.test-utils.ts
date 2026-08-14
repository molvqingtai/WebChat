export const createTestLocalStorage = () => {
  const storage = Object.create(null) as Storage
  Object.defineProperties(storage, {
    length: {
      get: () => Object.keys(storage).length
    },
    clear: {
      value: () => {
        // functional-loop: owner-commit — ordered per-key deletion with no bulk primitive
        for (const key of Object.keys(storage)) {
          delete (storage as unknown as Record<string, string>)[key]
        }
      }
    },
    getItem: {
      value: (key: string) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null)
    },
    key: {
      value: (index: number) => Object.keys(storage)[index] ?? null
    },
    removeItem: {
      value: (key: string) => delete (storage as unknown as Record<string, string>)[key]
    },
    setItem: {
      value: (key: string, value: string) => {
        ;(storage as unknown as Record<string, string>)[key] = String(value)
      }
    }
  })
  return storage
}
