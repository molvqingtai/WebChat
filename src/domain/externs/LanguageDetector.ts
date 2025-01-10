import { Remesh } from 'remesh'

export interface LanguageModelCapabilities {
  available: 'no' | 'readily' | 'after-download'
}

export interface LanguageDetector {
  detect: (text: string) => Promise<string>
  capabilities: () => Promise<LanguageModelCapabilities>
}

export const LanguageDetectorExtern = Remesh.extern<LanguageDetector>({
  default: {
    detect: () => {
      throw new Error('"detect" not implemented.')
    },
    capabilities: () => {
      throw new Error('"capabilities" not implemented.')
    }
  }
})
