import { browser } from '#imports'
import { AppActionExtern, type AppAction } from '@/domain/externs/AppAction'

import { InjectAdapter } from '@/service/adapter/runtimeMessage'
import { defineProxy } from 'comctx'

const [, injectAppAction] = defineProxy(() => ({}) as AppAction, {
  namespace: browser.runtime.id
})

const appAction = injectAppAction(new InjectAdapter())

export const AppActionImpl = AppActionExtern.impl(appAction)
