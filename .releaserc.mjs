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
    /**
     * Because assets.path does not support environment variables, a copy of the file without the version number is needed.
     * @see https://github.com/semantic-release/github/issues/274
     * */
    [
      '@semantic-release/exec',
      {
        prepareCmd: 'cp .output/web-chat-${nextRelease.version}-chrome.zip .output/web-chat-chrome.zip'
      }
    ],
    [
      '@semantic-release/exec',
      {
        prepareCmd: 'cp .output/web-chat-${nextRelease.version}-firefox.zip .output/web-chat-firefox.zip'
      }
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          {
            path: '.output/web-chat-chrome.zip'
          },
          {
            path: '.output/web-chat-firefox.zip'
          }
        ],
        labels: ['release']
      }
    ],
    '@semantic-release/git'
  ]
}
