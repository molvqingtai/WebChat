import { browser, defineBackground } from '#imports'
import { ProvideAdapter } from '@/service/adapter/runtime'
import { AppAction } from '@/service/AppAction'
import { defineAppActionProxy, defineNotificationProxy } from '@/service/Contract'
import { Notification } from '@/service/Notification'
import { registerEnsureHost } from '@/runtime/ensureHost'
import { startHost } from '@/runtime/host'
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

    if (import.meta.env.FIREFOX) {
      // Firefox's background is a document, so it hosts the Runtime itself.
      startHost()
      registerEnsureHost(async () => {})
    } else {
      registerEnsureHost()
    }

    registerActionClick(browser, () => appAction.openOptionsPage())
  }
})
