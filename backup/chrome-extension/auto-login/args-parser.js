/**
 * 解析命令行參數 - 支援動態參數 ex: --port 8080 --profile btse
 * @returns {Object} 解析後的參數物件
 */
export function parseArgs() {
  const result = {}
  const args = process.argv.slice(2)

  // 手動解析所有 --key value 參數
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      const key = args[i].substring(2)
      const value = args[i + 1]

      // port 轉數字，其他保持字串
      if (key === 'port') {
        result[key] = parseInt(value, 10)
      } else {
        result[key] = value
      }
      i++
    }
  }

  return result
}
