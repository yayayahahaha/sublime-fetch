/**
 * 比較兩張圖片並產生差異圖
 * @param {string} path1 - 第一張圖片的路徑
 * @param {string} path2 - 第二張圖片的路徑
 * @param {string} diffPath - 若有差異，儲存差異圖的路徑
 */
import { Jimp, diff } from 'jimp'
export async function compareImages(path1, path2) {
  const img1 = await Jimp.read(path1)
  const img2 = await Jimp.read(path2)

  if (img1.bitmap.width !== img2.bitmap.width || img1.bitmap.height !== img2.bitmap.height) {
    throw new Error('圖片尺寸不相同，無法比較')
  }

  const diffResult = diff(img1, img2)

  if (diffResult.percent >= 0.001) {
    console.log(`💥 兩張圖片不同, 差異有 ${diffResult.percent}%`)
    return { isDiff: true, diffResult }
  } else {
    console.log(`💖 兩張圖片相同, 差異有 ${diffResult.percent}%`)
    return { isDiff: false, diffResult }
  }
}
