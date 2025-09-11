import { STATIC_IMAGES } from './static-files-utils.js'
import { high } from './utils.js'

export function 修改白牌會動到的東西() {
  consoleTitle('總共需要處理的東西')

  // public images
  consoleSub(`public 的圖片共 ${STATIC_IMAGES.length} 張`)
  STATIC_IMAGES.forEach((img, index) => console.log(`${index + 1}. ${img.filename}`))

  // bundle config
  console.log()
  consoleSub('src/brand-TARGET/bundle/config.js 裡的各種屬性')
  console.log('1. appTitle')
  console.log('2. appDescription')
  console.log('3. websiteUrl')
  console.log('4. structuredData 裡的 name')
  console.log('5. pwaConfig 裡的 name 和 themeColorf')
  console.log('6. pwaConfig 裡的 manifestOptions 裡的 short_name (如果有)')
  console.log('7. pwaConfig 裡的 iconPaths')
  console.log('8. metaConfig 裡各個 social media 的 title 和 site')

  // color scheme
  console.log()
  consoleSub('src/brand-TARGET/color.scheme.js 裡的顏色屬性')
  console.log('在 figma 不點擊任何物件時，理應會出現在右側')
  console.log(
    `格式會像是如 ${high('primary')}, ${high('primary-light')}, ${high('primary-dark')}, ${high('blue-grey-dark')} 等等`
  )
  console.log(
    `對應到的地方是 color.scheme.js 裡的 ${high('--app--color--primary')}, ${high('--app--color--primary-light')} 等等`
  )

  // Logo
  console.log()
  consoleSub('Light Logo 和 Dark Logo 的添加位置')
  console.log(
    `有 Dark 和 Light 之分，請檢查 ${high('src/brand-TARGET/component/HeaderLogo.vue')} 裡的 computed 屬性 "${high('isDarkShow')}" 是否是新版(有 ${high('hasCustomTheme')} 相關的東西)`
  )
  console.log('接著添加 Light 和 Dark 到對應的位置如下')
  console.log(`LogoLight: ${high('src/brand-TARGET/component/LogoLight.vue')}`)
  console.log(`LogoDark: ${high('src/brand-TARGET/component/LogoDark.vue')}`)
  console.log(`添加完畢後記得直接在 LogoLight 和 LogoDark 裡調整 ${high('width')} 和 ${high('height')}`)
  console.log('雖然多疊了一層，但在 generalConfig 裡也要調整 headerLogoHeight 這個屬性')
  console.log(
    `添加與調整完畢後， ${high('src/brand-TARGET/component/FooterLogo.vue')} 和 ${high('src/brand-TARGET/component/HeaderLogo.vue')} 就會有對應的 Logo 了`
  )
  console.log()
  consoleSub('Light Logo 和 Dark Logo 的內容')
  console.log(`從 figma 取得 ${high('svg')} 格式的 logo 後，將 svg 的 ${high('內容')} 取出、`)
  console.log(
    `放到 ${high('@/components/icons/Icon')} 裡的 ${high('default-slot')}, 並傳入 ${high(':width="width"')}, ${high(':height="height"')}, ${high(':viewBox="`0 0 ${width} ${height}`"')} 和 ${high('fill="none"')} 等 4 個 props`
  )

  // support config
  console.log()
  consoleSub('src/brand-TARGET/supportConfig.js 裡的各種屬性')
  console.log(
    `1. articleIdMap 是一個物件，通常會先解構 ${high('@/baseConfig/supportConfig')} 裡的 ${high('...baseSupportConfig.articleIdMap')},`
  )
  console.log('2. emailDomain 通常是 @TARGET.com')
  console.log('3. supportEmail 基本上會是 support@emaildomain 相關')
  console.log('4. referralContactEmail 基本上就會是 supportEmail')

  // Legal
  console.log()
  consoleSub('Legal')
  console.log('Legal 頁面基本上會要全部重新盤點一次')

  // S3
  console.log()
  consoleSub('S3')
  console.log('S3 那邊會需要上傳 png 和 svg 的 Logo, 還會有一些像是 referral 的 banner(login/not-login)')
  console.log('task-and-reward, copy-trading 等等')
}

function consoleTitle(msg) {
  console.log(`\x1b[1m\x1b[36m${msg}\x1b[0m`)
}
function consoleSub(msg) {
  console.log(`\x1b[34m${msg}\x1b[0m`)
}
