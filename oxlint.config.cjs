/** Functional-only read-only pass: local plugin + native forEach rule, no unrelated categories. */
module.exports = {
  plugins: ['unicorn'],
  jsPlugins: ['./oxlint/functional-plugin/functional-plugin.cjs'],
  categories: {
    correctness: 'off',
    nursery: 'off',
    pedantic: 'off',
    perf: 'off',
    restriction: 'off',
    style: 'off',
    suspicious: 'off'
  },
  rules: {
    'unicorn/no-array-for-each': 'error',
    'functional-plugin/loop-annotation': 'error',
    'functional-plugin/derived-mutation': 'error',
    'functional-plugin/disguised-for-each': 'error',
    'functional-plugin/effectful-callback': 'error'
  }
}
