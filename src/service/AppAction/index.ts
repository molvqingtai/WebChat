import type { AppAction as AppActionExternType } from '@/domain/externs/AppAction'
import { browser } from '#imports'

export class AppAction implements AppActionExternType {
  async openOptionsPage() {
    await browser.runtime.openOptionsPage()
  }
}
