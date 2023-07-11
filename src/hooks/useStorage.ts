import { useEffect, useState } from 'react'
import type { Storage } from 'webextension-polyfill'
import { storage } from 'webextension-polyfill'

export function useStorage(key: string, initialValue: string) {
  const [value, setValue] = useState(async () => {
    const storedValue = await storage.local.get(key)
    return storedValue !== null ? storedValue : initialValue
  })

  useEffect(() => {
    const onChange = (changes: Record<string, Storage.StorageChange>) => {
      if (changes[key]) setValue(changes[key].newValue)
    }
    storage.onChanged.addListener(onChange)
    ;(async () => {
      const value = await storage.local.get(key)
      setValue(value[key])
    })()
    return () => storage.onChanged.removeListener(onChange)
  }, [])

  const setValueToStorage = async (newValue: string) => {
    setValue(newValue)
    await storage.local.set({ [key]: newValue })
  }

  return [value, setValueToStorage]
}
