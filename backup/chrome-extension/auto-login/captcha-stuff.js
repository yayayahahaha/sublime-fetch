import { Buffer } from 'node:buffer'
import terminalImage from 'terminal-image'

export async function showBase64Image(oriBase64String) {
  const base64String = /data:image\/png;base64,/.test(oriBase64String)
    ? oriBase64String
    : `data:image\/png;base64,${oriBase64String}`

  // 移除 data URL 的開頭
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '')

  // 將 base64 轉成 Buffer
  const imageBuffer = Buffer.from(base64Data, 'base64')

  // 顯示圖片
  console.log(await terminalImage.buffer(imageBuffer, { width: '300px', height: '100px', preserveAspectRatio: false }))
}
