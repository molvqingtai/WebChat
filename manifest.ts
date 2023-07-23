import { defineManifest } from '@crxjs/vite-plugin'
import packageJson from './package.json'

const isDev = process.env.NODE_ENV === 'development'

export default defineManifest({
  manifest_version: 3,
  name: packageJson.displayName,
  version: packageJson.version,
  content_scripts: [
    {
      js: ['src/main.tsx'],
      matches: isDev ? ['*://localhost/*', 'https://www.example.com/*'] : ['https://*/*']
    }
  ]
})
