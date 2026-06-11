// 手動維護「需要加密的 brand」清單 + 從 settings.json 讀對應的 client PEM。
// 之後若有新的 brand 啟用 transport 加密，加進 BRANDS_NEED_ENCRYPTION 即可。

import { loadSettings } from './settings-loader.js'

export const BRANDS_NEED_ENCRYPTION = ['fedhabit']

export function brandNeedsEncryption(brandName) {
  return BRANDS_NEED_ENCRYPTION.includes(brandName)
}

// settings.json shape:
// {
//   "encryption": {
//     "fedhabit": {
//       "clientPem": "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEH..."
//     }
//   }
// }
export function getClientPemForBrand(brandName) {
  const settings = loadSettings()
  const pem = settings?.encryption?.[brandName]?.clientPem
  if (!pem) {
    throw new Error(
      `[encryption-config] 找不到 brand "${brandName}" 的 clientPem，` +
        `請在 settings.json 補上 encryption.${brandName}.clientPem ` +
        `（值同 frontend .env.${brandName} 裡的 VUE_APP_CLIENT_PEM）`,
    )
  }
  return pem
}
