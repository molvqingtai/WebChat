/**
 * Calculates the length of the Longest Common Subsequence (LCS) between two strings.
 * @param a - The first string.
 * @param b - The second string.
 * @returns The length of the longest common subsequence.
 * @see https://en.wikipedia.org/wiki/Longest_common_subsequence
 */
const getTextLCS = (a: string, b: string): number => {
  // Create a 2D array to store the lengths of longest common subsequences
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))

  // Fill the dp array
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      // If characters match, increment the length of the LCS found so far
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        // If characters do not match, take the maximum length from the previous computations
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // The length of the longest common subsequence is found in the bottom-right cell of the dp array
  return dp[a.length][b.length]
}

/**
 * Calculates the similarity between two strings based on their longest common subsequence.
 * @param a - The first string.
 * @param b - The second string.
 * @returns A number representing the similarity between the two strings (0 to 1).
 */
const getTextSimilarity = (a: string, b: string): number => {
  // Get the length of the longest common subsequence
  const lcsLength: number = getTextLCS(a, b)
  // Get the maximum length of the two strings
  const maxLength: number = Math.max(a.length, b.length)

  // Calculate similarity based on the length of the LCS
  return maxLength === 0 ? 0 : lcsLength / maxLength
}

export default getTextSimilarity
