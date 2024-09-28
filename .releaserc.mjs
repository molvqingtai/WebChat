/**
 * @type {import('semantic-release').GlobalConfig}
 */

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
        prepareCmd: 'pnpm run pack'
      }
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          {
            // eslint-disable-next-line no-undef
            path: `.output/web-chat-${nextRelease.version}-chrome.zip`,
            label: 'Chrome Extension Installation Package'
          }
        ],
        labels: ['release']
      }
    ],
    '@semantic-release/git'
  ]
}
