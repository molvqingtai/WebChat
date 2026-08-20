import { browser, defineBackground } from '#imports'
import { ProvideAdapter } from '@/service/adapter/runtime'
import { defineProxy } from 'comctx'
import { AppAction } from '@/service/AppAction'
import { defineAppActionProxy, defineNotificationProxy } from '@/service/Contract'
import { Notification } from '@/service/Notification'
import { COORDINATOR_NAMESPACE } from '@/runtime/Contract'
import type { RuntimeCoordinator } from '@/runtime/Contract'
import { ensureHost, registerPage, restore, watchTabs } from '@/runtime/Background'
import { registerActionClick } from '@/app/background/ActionRegistration'
import { registerBrowserSyncStoragePreparation } from '@/service/StoragePreparation'

export default defineBackground({
  type: 'module',
  main() {
    registerBrowserSyncStoragePreparation()

    const [provideNotification] = defineNotificationProxy(() => new Notification(), browser.runtime.id)
    const [provideAppAction] = defineAppActionProxy(() => new AppAction(), browser.runtime.id)

    provideNotification(new ProvideAdapter())

    const appAction = provideAppAction(new ProvideAdapter())

    // Pages enter the single Background-owned Runtime host through this control endpoint.
    const [provideCoordinator] = defineProxy<() => RuntimeCoordinator>(() => ({ ensureHost, registerPage }), {
      namespace: `${COORDINATOR_NAMESPACE}:${browser.runtime.id}`
    })
    provideCoordinator(new ProvideAdapter())
    watchTabs()
    void restore()

    registerActionClick(browser, () => appAction.openOptionsPage())
  }
})
