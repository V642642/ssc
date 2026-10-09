const STORAGE_KEY = 'ssc-chsl-gemini-token'

function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

function decode(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

async function keyFromToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptToken(token) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFromToken(token)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token))
  return JSON.stringify({ iv: encode(iv), data: encode(encrypted) })
}

export async function unlockToken(token) {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return token
  try {
    const { iv, data } = JSON.parse(saved)
    const key = await keyFromToken(token)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, key, decode(data))
    return new TextDecoder().decode(decrypted) === token ? token : null
  } catch {
    return null
  }
}

export async function saveEncryptedToken(token) {
  localStorage.setItem(STORAGE_KEY, await encryptToken(token))
}

export function hasSavedToken() {
  return Boolean(localStorage.getItem(STORAGE_KEY))
}

export function removeSavedToken() {
  localStorage.removeItem(STORAGE_KEY)
}
