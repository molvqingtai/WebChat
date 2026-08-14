/**
 * Calculates the length of the Longest Common Subsequence (LCS) between two strings.
 * @param a - The first string.
 * @param b - The second string.
 * @returns The length of the longest common subsequence.
 * @see https://en.wikipedia.org/wiki/Longest_common_subsequence
 */
const getTextLCS = (a: string, b: string): number => {
  // The dp table is a fresh, exclusively owned accumulator: nested folds fill each cell in
  // place, keeping the linear row-by-column work of the original nested loop.
  const dp = Array.from({ length: a.length }, () => 0).reduce<number[][]>(
    (rows, _unused, rowIndex) => {
      const i = rowIndex + 1
      return Array.from({ length: b.length }, () => 0).reduce((table, _zero, columnIndex) => {
        const j = columnIndex + 1
        table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1])
        return table
      }, rows)
    },
    Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  )

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
