import { browser } from '#imports'
import { ProviderAdapter } from '@/service/adapter/runtime/Provider'
import type { MessageApi } from '@/service/adapter/runtime/Core'
import { startHost } from '@/runtime/host'

/**
 * Chrome/Edge Offscreen Document host: lifecycle-only wrapper around the
 * shared headless Runtime. Created single-flight by the background coordinator.
 */
startHost(new ProviderAdapter(browser.runtime as unknown as MessageApi))
