import { type Driver, type WatchCallback, defineDriver } from 'unstorage'
import { browser, type Storage as BrowserStorage } from 'wxt/browser'

export interface WebExtensionDriverOptions {
  storageArea: 'sync' | 'local' | 'managed' | 'session'
}

export const webExtensionDriver: (opts: WebExtensionDriverOptions) => Driver = defineDriver((opts) => {
  const checkPermission = () => {
    if (browser.storage == null) throw Error("You must request the 'storage' permission to use webExtensionDriver")
  }

  const _storageListener: (changes: BrowserStorage.StorageAreaSyncOnChangedChangesType) => void = (changes) => {
    Object.entries(changes).forEach(([key, { newValue }]) => {
      _listeners.forEach((callback) => {
        callback(newValue ? 'update' : 'remove', key)
      })
    })
  }
  const _listeners = new Set<WatchCallback>()

  return {
    name: 'web-extension:' + opts.storageArea,
    async hasItem(key) {
      checkPermission()
      const res = await browser.storage[opts.storageArea].get(key)
      return res[key] != null
    },
    async getItem(key) {
      checkPermission()
      const res = await browser.storage[opts.storageArea].get(key)
      return res[key] ?? null
    },
    async getItems(items) {
      checkPermission()
      const res = await browser.storage[opts.storageArea].get(items.map((item) => item.key))
      return items.map((item) => ({
        key: item.key,
        value: res[item.key] ?? null
      }))
    },
    async setItem(key, value) {
      checkPermission()
      await browser.storage[opts.storageArea].set({ [key]: value ?? null })
    },
    async setItems(items) {
      checkPermission()
      const map = items.reduce<Record<string, any>>((map, item) => {
        map[item.key] = item.value ?? null
        return map
      }, {})
      await browser.storage[opts.storageArea].set(map)
    },
    async removeItem(key) {
      checkPermission()
      await browser.storage[opts.storageArea].remove(key)
    },
    async getKeys() {
      checkPermission()
      const all = await browser.storage[opts.storageArea].get()
      return Object.keys(all)
    },
    async clear() {
      checkPermission()
      await browser.storage[opts.storageArea].clear()
    },
    watch(callback) {
      checkPermission()
      _listeners.add(callback)

      if (_listeners.size === 1) {
        browser.storage[opts.storageArea].onChanged.addListener(_storageListener)
      }

      return () => {
        _listeners.delete(callback)
        if (_listeners.size === 0) {
          browser.storage[opts.storageArea].onChanged.removeListener(_storageListener)
        }
      }
    }
  }
})
