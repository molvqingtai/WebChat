import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import Icons from 'unplugin-icons/vite'
import manifest from './manifest'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  plugins: [
    react(),
    // https://github.com/antfu/unplugin-icons
    Icons({ compiler: 'jsx', jsx: 'react' }),
    crx({ manifest })
  ]
})
