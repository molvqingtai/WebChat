import { defineManifest } from '@crxjs/vite-plugin'
import pkgJson from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkgJson.displayName,
  version: pkgJson.version,
  content_scripts: [
    {
      js: ['src/content/main.tsx'],
      matches: ['*://www.example.com//*']
    }
  ]
})
