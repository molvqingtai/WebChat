import { browser, defineBackground } from '#imports'
import { ProvideAdapter } from '@/service/adapter/runtime'
import { defineProxy } from 'comctx'
import { AppAction } from '@/service/AppAction'
import { defineAppActionProxy, defineNotificationProxy } from '@/service/Contract'
import { Notification } from '@/service/Notification'
import { installRuntimeRouter } from '@/runtime/Router'
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

    // The Background owns no Runtime state: it routes browser events to the long-lived host and
    // the host's content-free invalidations back to the exact tabs.
    installRuntimeRouter()

    registerActionClick(browser, () => appAction.openOptionsPage())
  }
})
