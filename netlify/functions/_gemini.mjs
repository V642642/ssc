const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'

export async function callGemini(contents, config = {}, requestKey) {
  const key = requestKey
  if (!key) throw new Error('Gemini token is not configured.')
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, ...config }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Gemini request failed')
  return data
}

export function result(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
