import { defineManifest } from '@crxjs/vite-plugin'
import packageJson from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: packageJson.displayName,
  version: packageJson.version,
  content_scripts: [
    {
      js: ['src/main.tsx'],
      matches: ['*://www.example.com/*']
    }
  ]
})
