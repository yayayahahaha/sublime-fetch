import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'
import rollupJson from '@rollup/plugin-json'
import del from 'rollup-plugin-delete'

export default {
  input: 'server.js',

  output: {
    dir: 'dist',
    format: 'cjs',
  },

  plugins: [
    del({ targets: 'dist/*' }),
    resolve({ preferBuiltins: true }),
    rollupJson(),
    commonjs(),
    terser(), // 選擇性壓縮
  ],
}
