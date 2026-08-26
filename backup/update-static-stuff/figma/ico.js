// 以前 favicon.ico 要設計另外用 Figma 的 ICO exporter plugin 轉好、丟 PRD 附件、再手動放進來,
// 下游還得用 requiredType: 'ico' 防「拿 png 改名」。ICO 從 Vista 起就允許直接內嵌 PNG payload,
// 自己組 header 就能徹底省掉那個人工步驟。
//
// 格式:
//   ICONDIR       6 bytes   reserved(2)=0 | type(2)=1 | count(2)=N
//   ICONDIRENTRY  16 bytes  width(1) | height(1) | colorCount(1)=0 | reserved(1)=0
//                           planes(2)=1 | bitCount(2)=32 | bytesInRes(4) | imageOffset(4)
//   payload       N 張 PNG 原始 bytes 依序接在後面

const ICONDIR_SIZE = 6
const ICONDIRENTRY_SIZE = 16

// width / height 欄位只有 1 byte, 256 要寫成 0
function toDimensionByte(value) {
  if (value === 256) return 0
  if (value < 1 || value > 256) {
    throw new Error(`ICO 的尺寸只支援 1~256, 收到 ${value}`)
  }
  return value
}

/**
 * @param {Array<{ width: number, height: number, buffer: Buffer }>} images 每張都要是 PNG bytes
 * @returns {Buffer}
 */
export function encodeIco(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('encodeIco: 至少要一張圖')
  }

  const header = Buffer.alloc(ICONDIR_SIZE)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(ICONDIRENTRY_SIZE * images.length)
  let payloadOffset = ICONDIR_SIZE + directory.length

  images.forEach((image, index) => {
    const at = ICONDIRENTRY_SIZE * index
    directory.writeUInt8(toDimensionByte(image.width), at)
    directory.writeUInt8(toDimensionByte(image.height), at + 1)
    directory.writeUInt8(0, at + 2)
    directory.writeUInt8(0, at + 3)
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(image.buffer.length, at + 8)
    directory.writeUInt32LE(payloadOffset, at + 12)
    payloadOffset += image.buffer.length
  })

  return Buffer.concat([header, directory, ...images.map((image) => image.buffer)])
}
