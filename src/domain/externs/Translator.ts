import { Remesh } from 'remesh'

export interface Translator {
  translate: (text: string, options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>
}

export const TranslatorExtern = Remesh.extern<Translator>({
  default: {
    translate: () => {
      throw new Error('"create" not implemented.')
    }
  }
})
