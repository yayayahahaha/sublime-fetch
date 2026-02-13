export class WL {
  constructor(brandName, allWl) {
    this.brandName = brandName ?? 'btse' // 如果是 null 則預設為 btse (小寫)
    this.allWl = allWl
    this.brandInfo = this._findBrandInfo()
  }

  _findBrandInfo() {
    if (typeof this.allWl !== 'object' || this.allWl === null || Array.isArray(this.allWl)) {
      throw new Error('settings.json 中的 "brand-list" 必須是一個物件 (Object)。')
    }

    if (Object.keys(this.allWl).length === 0) {
      throw new Error(
        'settings.json 中的 "brand-list" 是空的，請先執行 node auto-login/generate-brand-info.js'
      )
    }

    const brandInfo = this.allWl[this.brandName]
    if (!brandInfo) {
      throw new Error(`在 "brand-list" 中找不到品牌 "${this.brandName}" 的資訊`)
    }
    return brandInfo
  }

  getApiUrl() {
    const apiUrl = this.brandInfo.API_URL
    if (!apiUrl) {
      throw new Error(`品牌 "${this.brandName}" 中沒有找到 API_URL 設定`)
    }
    return apiUrl
  }
}