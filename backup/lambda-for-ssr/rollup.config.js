import fs from 'fs'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'
import rollupJson from '@rollup/plugin-json'
import del from 'rollup-plugin-delete'
import {
  configVariableFileName,
  errorExit,
  indexHtmlContentFileName
} from './build-lambda-server-environment-utils.js'

function checkParamsPlugin() {
  return {
    name: 'RollupCheckParamsPlugin',
    buildStart() {
      if (!fs.existsSync(indexHtmlContentFileName)) {
        return errorExit(6, { fileName: indexHtmlContentFileName })
      }
      if (!fs.existsSync(configVariableFileName)) {
        return errorExit(6, { fileName: configVariableFileName })
      }
    }
  }
}

export default {
  input: 'index.js',

  output: {
    dir: 'dist',
    format: 'cjs'
  },

  plugins: [
    del({ targets: 'dist/*' }),
    checkParamsPlugin(),
    resolve({ preferBuiltins: true }),
    rollupJson(),
    commonjs(),
    terser() // 選擇性壓縮
  ]
}
