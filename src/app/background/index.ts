import { browser, defineBackground } from '#imports'
import { ProvideAdapter } from '@/service/adapter/runtime'
import { defineProxy } from 'comctx'
import { AppAction } from '@/service/AppAction'
import { defineAppActionProxy, defineNotificationProxy } from '@/service/Contract'
import { Notification } from '@/service/Notification'
import { COORDINATOR_NAMESPACE } from '@/runtime/Contract'
import type { RuntimeCoordinator } from '@/runtime/Contract'
import {
  ensureHost,
  registerPage,
  relayOffscreenMessages,
  restore,
  watchTabs,
  watchOffscreenClosed
} from '@/runtime/Background'
import { registerActionClick } from '@/app/background/ActionRegistration'
import { registerBrowserSyncStoragePreparation } from '@/service/StoragePreparation'
import { runtimeLifecycleLog } from '@/runtime/Debug'

export default defineBackground({
  type: 'module',
  main() {
    runtimeLifecycleLog('background.start', { extensionId: browser.runtime.id })
    registerBrowserSyncStoragePreparation()

    const [provideNotification] = defineNotificationProxy(() => new Notification(), browser.runtime.id)
    const [provideAppAction] = defineAppActionProxy(() => new AppAction(), browser.runtime.id)

    provideNotification(new ProvideAdapter())

    const appAction = provideAppAction(new ProvideAdapter())

    // Sole host coordinator: pages request the shared Runtime host here.
    const [provideCoordinator] = defineProxy<() => RuntimeCoordinator>(() => ({ ensureHost, registerPage }), {
      namespace: `${COORDINATOR_NAMESPACE}:${browser.runtime.id}`
    })
    provideCoordinator(new ProvideAdapter())
    if (!import.meta.env.FIREFOX) relayOffscreenMessages()
    watchOffscreenClosed()
    watchTabs()
    void restore()

    registerActionClick(browser, () => appAction.openOptionsPage())
  }
})
