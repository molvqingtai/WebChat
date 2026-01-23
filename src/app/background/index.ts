import { browser, defineBackground } from '#imports'
import { ProvideAdapter } from '@/service/adapter/runtimeMessage'
import { defineProxy } from 'comctx'
import { AppAction } from '@/service/AppAction'
import { Notification } from '@/service/Notification'

export default defineBackground({
  type: 'module',
  main() {
    const [provideNotification] = defineProxy(() => new Notification(), {
      namespace: browser.runtime.id
    })
    const [provideAppAction] = defineProxy(() => new AppAction(), {
      namespace: browser.runtime.id
    })

    provideNotification(new ProvideAdapter())

    const appAction = provideAppAction(new ProvideAdapter())

    browser.action.onClicked.addListener(() => appAction.openOptionsPage())
  }
})
