import { browser } from '#imports'
import { AppActionExtern, type AppAction } from '@/domain/externs/AppAction'
import { InjectAdapter } from '@/service/adapter/runtime'
import { defineAppActionProxy } from '@/service/Contract'

const [, injectAppAction] = defineAppActionProxy(() => ({}) as AppAction, browser.runtime.id)

const appAction = injectAppAction(new InjectAdapter())

export const AppActionImpl = AppActionExtern.impl(appAction)
