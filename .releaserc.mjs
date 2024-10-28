/**
 * @type {import('semantic-release').GlobalConfig}
 */

import packageJson from './package.json' with { type: 'json' }

const name = packageJson.name

export default {
  branches: ['master'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    [
      '@semantic-release/npm',
      {
        npmPublish: false
      }
    ],
    [
      '@semantic-release/exec',
      {
        prepareCmd: `pnpm run pack`
      }
    ],
    /**
     * Because assets.path does not support environment variables, a copy of the file without the version number is needed.
     * @see https://github.com/semantic-release/github/issues/274
     * */
    [
      '@semantic-release/exec',
      {
        prepareCmd: `cp .output/${name}-\${nextRelease.version}-chrome.zip .output/${name}-chrome.zip`
      }
    ],
    [
      '@semantic-release/exec',
      {
        prepareCmd: `cp .output/${name}-\${nextRelease.version}-firefox.zip .output/${name}-firefox.zip`
      }
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          {
            path: `.output/${name}-chrome.zip`
          },
          {
            path: `.output/${name}-firefox.zip`
          }
        ],
        labels: ['release']
      }
    ],
    '@semantic-release/git'
  ]
}
