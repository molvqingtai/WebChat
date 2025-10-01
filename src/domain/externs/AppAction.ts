import { Remesh } from 'remesh'

export interface AppAction {
  openOptionsPage: () => Promise<void>
}

export const AppActionExtern = Remesh.extern<AppAction>({
  default: {
    openOptionsPage: () => {
      throw new Error('"openOptionsPage" not implemented.')
    }
  }
})
