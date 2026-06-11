// 對應 frontend repo: /Users/flyc.chung/btse/ww/src/utils/encryptEcdhAesGcm.ts
// 演算法：ECDH (P-256) → SHA-256(sharedSecret) → AES-GCM-256 key
// Body 格式：{ iv: base64, message: base64 }

import { Buffer } from 'node:buffer'
import { get } from './request-stuff.js'

const aesKeyPromiseByBrand = new Map()

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '')
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

function base64ToUint8Array(base64) {
  if (typeof base64 !== 'string') {
    throw new TypeError('base64 input must be a string')
  }
  let s = base64.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4 !== 0) s += '='
  return new Uint8Array(Buffer.from(s, 'base64'))
}

function uint8ArrayToBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function getParsedData(text) {
  if (typeof text !== 'string' || text.trim().length < 2) return text
  const t = text.trim()
  const looksJson = (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
  if (!looksJson) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toPlaintext(data) {
  if (data !== null && typeof data === 'object') return JSON.stringify(data)
  return data
}

async function importPrivateKey(pem) {
  const keyData = pemToArrayBuffer(pem)
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  )
}

async function importPublicKey(pem) {
  const keyData = pemToArrayBuffer(pem)
  return crypto.subtle.importKey(
    'spki',
    keyData,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
}

async function deriveSharedAesKey(privateKey, peerPublicKey) {
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256,
  )
  const hashedSecret = await crypto.subtle.digest('SHA-256', sharedSecret)
  return crypto.subtle.importKey(
    'raw',
    hashedSecret,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptAesGcm(key, data) {
  const plaintext = toPlaintext(data)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    ciphertext: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    iv: uint8ArrayToBase64(iv),
  }
}

export async function decryptAesGcm(key, ciphertextBase64, ivBase64) {
  const ciphertext = base64ToUint8Array(ciphertextBase64)
  const iv = base64ToUint8Array(ivBase64)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ciphertext,
  )
  return getParsedData(new TextDecoder().decode(decrypted))
}

async function generateAesKey({ apiBaseUrl, clientPem }) {
  const initRes = await get(`${apiBaseUrl}/api/init`)
  if (initRes.error) throw new Error(`/api/init failed: ${JSON.stringify(initRes.error)}`)
  const serverPublicPem = initRes.data?.data ?? initRes.data
  if (!serverPublicPem || typeof serverPublicPem !== 'string') {
    throw new Error(`/api/init 沒有拿到有效的公鑰 PEM, got: ${JSON.stringify(initRes.data)}`)
  }

  const clientPrivateKey = await importPrivateKey(clientPem)
  const serverPublicKey = await importPublicKey(serverPublicPem)
  return deriveSharedAesKey(clientPrivateKey, serverPublicKey)
}

export function getAesKeyForBrand(brandName, { apiBaseUrl, clientPem }) {
  if (!aesKeyPromiseByBrand.has(brandName)) {
    aesKeyPromiseByBrand.set(
      brandName,
      generateAesKey({ apiBaseUrl, clientPem }).catch((err) => {
        aesKeyPromiseByBrand.delete(brandName)
        throw err
      }),
    )
  }
  return aesKeyPromiseByBrand.get(brandName)
}

export async function decryptResponseInPlace(aesKey, response) {
  const iv = response?.data?.data?.iv
  const message = response?.data?.data?.message
  if (iv && message && aesKey) {
    try {
      response.data.data = await decryptAesGcm(aesKey, message, iv)
    } catch (err) {
      console.error('decryptResponseInPlace failed:', err)
    }
  }
  return response
}
