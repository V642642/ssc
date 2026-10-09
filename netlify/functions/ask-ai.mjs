import { callGemini, result } from './_gemini.mjs'

export async function handler(event) {
  if (event.httpMethod !== 'POST') return result(405, { error: 'POST required' })
  try {
    const { messages = [], apiKey } = JSON.parse(event.body || '{}')
    const data = await callGemini(messages.slice(-12).map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })), { systemInstruction: { parts: [{ text: 'You are a concise SSC CHSL study coach. Explain answers step by step, use simple language, and never claim to predict future exam questions.' }] }, generationConfig: { temperature: 0.2 } }, apiKey)
    return result(200, { answer: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || 'Gemini returned no text.' })
  } catch (error) {
    return result(500, { error: error.message })
  }
}
