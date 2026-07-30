import { CONFIG_STORE_VERSION } from '@/constants/storage'
import { serializePreparation } from '@/utils/serializedPreparation'

export interface ConfigurationVersionStorage {
  readVersion(): Promise<{ readonly exists: boolean; readonly value: unknown }>
  writeVersion(version: number): Promise<void>
  clear(): Promise<void>
}

export const prepareConfigurationStorage = (identity: string, storage: ConfigurationVersionStorage): Promise<void> =>
  serializePreparation(`configuration:${identity}`, async () => {
    try {
      const stored = await storage.readVersion()
      if (!stored.exists) {
        await storage.writeVersion(CONFIG_STORE_VERSION)
        return
      }
      if (stored.value === CONFIG_STORE_VERSION) return

      await storage.clear()
      await storage.writeVersion(CONFIG_STORE_VERSION)
    } catch {
      console.error('[WebChat] Configuration store preparation failed')
      throw new Error('Configuration store preparation failed')
    }
  })
