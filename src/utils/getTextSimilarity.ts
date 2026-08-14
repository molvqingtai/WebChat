/**
 * Calculates the length of the Longest Common Subsequence (LCS) between two strings.
 * @param a - The first string.
 * @param b - The second string.
 * @returns The length of the longest common subsequence.
 * @see https://en.wikipedia.org/wiki/Longest_common_subsequence
 */
const getTextLCS = (a: string, b: string): number => {
  // Rows derive from the previous row only; each row is a pure reduce over the columns.
  const dp = Array.from({ length: a.length + 1 }, () => 0).reduce<number[][]>((rows, _, i) => {
    if (i === 0) return [Array(b.length + 1).fill(0)]
    const previous = rows[i - 1]
    const row = Array.from({ length: b.length + 1 }, () => 0).reduce<number[]>((current, _zero, j) => {
      if (j === 0) return [0]
      const value = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1])
      return [...current, value]
    }, [])
    return [...rows, row]
  }, [])

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
