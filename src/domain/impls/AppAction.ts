import { browser } from '#imports'
import { AppActionExtern, type AppAction } from '@/domain/externs/AppAction'
import { InjectAdapter } from '@/service/adapter/runtime'
import { defineAppActionProxy } from '@/service/Contract'

// SAFETY: the proxy factory placeholder is replaced by the injected AppAction implementation.
const [, injectAppAction] = defineAppActionProxy(() => ({}) as AppAction, browser.runtime.id)

const appAction = injectAppAction(new InjectAdapter())

export const AppActionImpl = AppActionExtern.impl(appAction)
