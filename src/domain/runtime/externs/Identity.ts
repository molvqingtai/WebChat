import { Remesh } from 'remesh'

export interface Identity {
  nextId: () => string
}

export const IdentityExtern = Remesh.extern<Identity>({
  default: {
    nextId: () => {
      throw new Error('Runtime identity not implemented.')
    }
  }
})
